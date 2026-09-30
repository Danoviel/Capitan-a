import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { expandHome } from '../shared/paths.ts';
import type {
  LogLine,
  PortOwner,
  ProjectConfig,
  ProjectState,
  ProjectStatus,
} from '@puertosview/shared';
import type { LogBuffer } from './logBuffer.ts';
import type { PortScanner } from './portScanner.ts';

/** Segundos entre SIGTERM y SIGKILL al apagar un proyecto. */
const GRACE_MS = 6000;

interface ManagedProcess {
  child: ChildProcess;
  /** PID del líder del grupo. Se guarda aparte porque `child.pid` se limpia al morir. */
  pgid: number;
}

interface ProcessManagerEvents {
  state: [ProjectState];
  log: [LogLine];
}

/**
 * Lanza y detiene los proyectos.
 *
 * Detalle clave: cada proyecto se lanza con `detached: true`, lo que crea un
 * *process group* propio. Django con autoreload y `npm run dev` lanzan procesos
 * hijos; matar solo al padre dejaría el puerto ocupado por un huérfano. Al
 * apagar se manda la señal a `-pgid`, es decir a todo el grupo.
 */
export class ProcessManager extends EventEmitter<ProcessManagerEvents> {
  #processes = new Map<string, ManagedProcess>();
  #states = new Map<string, ProjectState>();
  #stopping = new Set<string>();
  /** Arranques en curso: cubre la espera del escaneo, antes de que exista el proceso. */
  #launching = new Set<string>();
  #logs: LogBuffer;
  #scanner: PortScanner;
  #shell: string;

  constructor(logs: LogBuffer, scanner: PortScanner, shell = process.env.SHELL || '/bin/zsh') {
    super();
    this.#logs = logs;
    this.#scanner = scanner;
    this.#shell = shell;
  }

  /** Estado de un proyecto, con valores neutros si nunca se lanzó. */
  stateOf(id: string): ProjectState {
    return (
      this.#states.get(id) ?? {
        id,
        status: 'stopped',
        pid: null,
        startedAt: null,
        stoppedAt: null,
        exitCode: null,
        exitSignal: null,
        portOwner: null,
        lastError: null,
      }
    );
  }

  isManaged(id: string): boolean {
    return this.#processes.has(id);
  }

  async start(config: ProjectConfig): Promise<ProjectState> {
    // Dos pedidos casi simultáneos (doble clic, web + barra de menú) lanzarían dos
    // procesos y el primero quedaría sin control. Se reserva el id antes de esperar.
    if (this.#processes.has(config.id) || this.#launching.has(config.id)) {
      throw new Error(`${config.name} ya está corriendo o arrancando`);
    }
    this.#launching.add(config.id);
    try {
      return await this.#launch(config);
    } finally {
      this.#launching.delete(config.id);
    }
  }

  async #launch(config: ProjectConfig): Promise<ProjectState> {
    // El `~` se guarda literal en projects.json y se resuelve recién aquí.
    const cwd = expandHome(config.cwd);
    if (!existsSync(cwd)) {
      const state = this.#patch(config.id, {
        status: 'stopped',
        lastError: `La carpeta no existe: ${config.cwd}`,
      });
      throw new Error(state.lastError ?? 'Carpeta inexistente');
    }

    // Si otro proceso ya tiene el puerto, arrancar solo produciría un
    // "address already in use" enterrado en los logs. Mejor avisar antes.
    if (config.port !== null) {
      const owner = (await this.#scanner.scan()).find((candidate) => candidate.port === config.port);
      if (owner) {
        throw new Error(
          `El puerto ${config.port} ya está ocupado por ${owner.command} (PID ${owner.pid}). ` +
            'Libéralo desde el panel de puertos o cambia el puerto del proyecto.',
        );
      }
    }

    // `-l` carga el perfil del shell (nvm, pyenv, PATH de Homebrew); sin eso
    // comandos como `npm` o `python` no se encuentran al lanzar desde un daemon.
    // NODE_ENV se quita del entorno heredado: el daemon corre con production y los
    // `vite`/`next dev` lo heredarían, arrancando React en modo producción. Si un
    // proyecto lo necesita, se define en su `env` y ese valor sí se respeta.
    const { NODE_ENV: _daemonNodeEnv, ...inheritedEnv } = process.env;
    const child = spawn(this.#shell, ['-l', '-c', config.command], {
      cwd,
      env: { ...inheritedEnv, ...config.env, FORCE_COLOR: '1', PYTHONUNBUFFERED: '1' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (typeof child.pid !== 'number') {
      throw new Error(`No se pudo lanzar ${config.name}`);
    }

    this.#processes.set(config.id, { child, pgid: child.pid });
    this.#logs.clear(config.id);
    this.#emitLogs(config.id, 'system', `$ ${config.command}  (cwd: ${config.cwd})`);

    child.stdout?.on('data', (chunk: Buffer) =>
      this.#emitLogs(config.id, 'stdout', chunk.toString('utf8')),
    );
    child.stderr?.on('data', (chunk: Buffer) =>
      this.#emitLogs(config.id, 'stderr', chunk.toString('utf8')),
    );

    // Solo se borra la entrada si sigue siendo de este proceso: tras un reinicio
    // puede pertenecer ya al proceso nuevo.
    const forget = () => {
      if (this.#processes.get(config.id)?.child === child) this.#processes.delete(config.id);
    };

    child.on('error', (error: Error) => {
      forget();
      this.#emitLogs(config.id, 'system', `Error al lanzar: ${error.message}`);
      this.#patch(config.id, { status: 'crashed', pid: null, lastError: error.message });
    });

    child.on('exit', (code, signal) => {
      forget();
      const wasStopping = this.#stopping.delete(config.id);
      const clean = wasStopping || code === 0 || signal === 'SIGTERM';
      this.#emitLogs(
        config.id,
        'system',
        `Proceso terminado (código ${code ?? '-'}, señal ${signal ?? '-'})`,
      );
      this.#patch(config.id, {
        status: clean ? 'stopped' : 'crashed',
        pid: null,
        stoppedAt: new Date().toISOString(),
        exitCode: code,
        exitSignal: signal,
      });
    });

    return this.#patch(config.id, {
      status: 'starting',
      pid: child.pid,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      exitCode: null,
      exitSignal: null,
      lastError: null,
    });
  }

  /** SIGTERM al grupo completo; SIGKILL si sigue vivo tras el margen de gracia. */
  async stop(id: string): Promise<ProjectState> {
    const managed = this.#processes.get(id);
    if (!managed) return this.stateOf(id);

    this.#stopping.add(id);
    this.#patch(id, { status: 'stopping' });
    this.#signalGroup(managed.pgid, 'SIGTERM');

    const died = await this.#waitForExit(id, GRACE_MS);
    if (!died) {
      this.#emitLogs(id, 'system', 'No respondió a SIGTERM, enviando SIGKILL');
      this.#signalGroup(managed.pgid, 'SIGKILL');
      await this.#waitForExit(id, 2000);
    }

    return this.stateOf(id);
  }

  async restart(config: ProjectConfig): Promise<ProjectState> {
    await this.stop(config.id);
    return this.start(config);
  }

  /** Apagado ordenado de todo al cerrar PuertosView. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.#processes.keys()].map((id) => this.stop(id)));
  }

  /**
   * Cruza el estado interno con lo que realmente escucha en los puertos.
   * De ahí sale el estado `external`: puerto ocupado por alguien que no lanzamos.
   */
  reconcile(configs: ProjectConfig[], owners: PortOwner[]): ProjectState[] {
    const byPort = new Map<number, PortOwner>();
    for (const owner of owners) {
      if (!byPort.has(owner.port)) byPort.set(owner.port, owner);
    }

    return configs.map((config) => {
      const current = this.stateOf(config.id);
      const owner = config.port !== null ? (byPort.get(config.port) ?? null) : null;
      const managed = this.#processes.has(config.id);

      let status: ProjectStatus = current.status;
      if (managed) {
        // `starting` pasa a `running` en cuanto el puerto empieza a escuchar.
        if (current.status === 'starting' && (owner || config.port === null)) status = 'running';
        else if (current.status !== 'stopping' && current.status !== 'starting') status = 'running';
      } else if (owner) {
        status = 'external';
      } else if (current.status === 'running' || current.status === 'external') {
        status = 'stopped';
      }

      const next: ProjectState = { ...current, status, portOwner: owner };
      this.#states.set(config.id, next);
      return next;
    });
  }

  #signalGroup(pgid: number, signal: NodeJS.Signals): void {
    try {
      // El negativo apunta al grupo entero, no solo al líder.
      process.kill(-pgid, signal);
    } catch {
      try {
        process.kill(pgid, signal);
      } catch {
        /* el proceso ya no existe */
      }
    }
  }

  #waitForExit(id: string, timeoutMs: number): Promise<boolean> {
    const managed = this.#processes.get(id);
    if (!managed) return Promise.resolve(true);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        managed.child.off('exit', onExit);
        resolve(false);
      }, timeoutMs);

      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      managed.child.once('exit', onExit);
    });
  }

  #emitLogs(projectId: string, stream: LogLine['stream'], chunk: string): void {
    for (const line of this.#logs.append(projectId, stream, chunk)) {
      this.emit('log', line);
    }
  }

  #patch(id: string, patch: Partial<ProjectState>): ProjectState {
    const next: ProjectState = { ...this.stateOf(id), ...patch, id };
    this.#states.set(id, next);
    this.emit('state', next);
    return next;
  }
}
