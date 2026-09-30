import { homedir } from 'node:os';
import { realPath } from '../shared/paths.ts';
import type {
  BatchResult,
  BrewServiceInfo,
  DockerContainerInfo,
  FolderInfo,
  ListeningProcess,
  PortCategory,
  PortOwner,
  ProjectConfig,
  ProjectDiagnosis,
  ProjectState,
  ServerEvent,
  ServiceAction,
  Snapshot,
} from '@capitania/shared';
import type { ProjectRepository } from '../config/projectRepository.ts';
import type { LogBuffer } from '../services/logBuffer.ts';
import type { PortScanner } from '../services/portScanner.ts';
import type { ProcessManager } from '../services/processManager.ts';
import type { ProjectDoctor } from '../services/projectDoctor.ts';
import { inspectFolder } from '../services/folderInspector.ts';
import type { BrewServices, DockerServices } from '../services/systemServices.ts';

/** Cada cuánto se relee el estado real de los puertos. */
const SCAN_INTERVAL_MS = 2500;

/**
 * Une configuración, procesos y puertos en una sola fachada.
 *
 * Las rutas HTTP hablan únicamente con esta clase: así la lógica de negocio no
 * queda desperdigada entre handlers de Express.
 */
export class Supervisor {
  #repo: ProjectRepository;
  #processes: ProcessManager;
  #scanner: PortScanner;
  #logs: LogBuffer;
  #brew: BrewServices;
  #docker: DockerServices;
  #doctor: ProjectDoctor;
  #publish: (event: ServerEvent) => void = () => {};
  #ports: PortOwner[] = [];
  #timer: NodeJS.Timeout | null = null;

  constructor(deps: {
    repo: ProjectRepository;
    processes: ProcessManager;
    scanner: PortScanner;
    logs: LogBuffer;
    brew: BrewServices;
    docker: DockerServices;
    doctor: ProjectDoctor;
  }) {
    this.#repo = deps.repo;
    this.#processes = deps.processes;
    this.#scanner = deps.scanner;
    this.#logs = deps.logs;
    this.#brew = deps.brew;
    this.#docker = deps.docker;
    this.#doctor = deps.doctor;
  }

  /** Conecta la salida de eventos (WebSocket) una vez creado el servidor HTTP. */
  connect(publish: (event: ServerEvent) => void): void {
    this.#publish = publish;
    this.#processes.on('state', (state) => publish({ type: 'project-state', state }));
    this.#processes.on('log', (line) => publish({ type: 'log', line }));
  }

  startWatching(): void {
    if (this.#timer) return;
    const tick = () => this.#refreshInBackground();
    tick();
    this.#timer = setInterval(tick, SCAN_INTERVAL_MS);
  }

  stopWatching(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Reescanea puertos, reconcilia estados y avisa al dashboard. */
  async refresh(): Promise<Snapshot> {
    this.#ports = this.#classify(await this.#scanner.scan());
    const states = this.#processes.reconcile(this.#repo.all(), this.#ports);
    this.#publish({ type: 'snapshot', projects: states, ports: this.#ports });
    return this.snapshot();
  }

  /** Refresco sin esperar el resultado: un fallo de lsof se registra, no tumba el daemon. */
  #refreshInBackground(): void {
    this.refresh().catch((error: unknown) => {
      console.error('No se pudo escanear los puertos:', error);
    });
  }

  /**
   * A cada puerto le pone su proyecto real (por carpeta, nunca por el número:
   * un proyecto prendido por fuera puede estar en un puerto que no es el suyo)
   * y una categoría para el panel de puertos.
   */
  #classify(processes: ListeningProcess[]): PortOwner[] {
    const projectByCwd = new Map(this.#repo.all().map((c) => [realPath(c.cwd), c.id] as const));
    const protectedPorts = new Set(this.#repo.protectedPorts());
    const home = homedir();
    const isDevFolder = (cwd: string | null) =>
      cwd !== null &&
      cwd.startsWith(`${home}/`) &&
      !cwd.startsWith(`${home}/Library/`) &&
      !cwd.startsWith(`${home}/Applications/`);

    return processes.map((process) => {
      const projectId = (process.cwd && projectByCwd.get(process.cwd)) || null;
      let category: PortCategory = 'app';
      if (protectedPorts.has(process.port)) category = 'protected';
      else if (projectId) category = 'project';
      else if (isDevFolder(process.cwd)) category = 'dev';
      return { ...process, projectId, category };
    });
  }

  snapshot(): Snapshot {
    return {
      configPath: this.#repo.path,
      projects: this.#repo.all().map((config) => ({
        config,
        state: this.#processes.stateOf(config.id),
      })),
      ports: this.#ports,
      protectedPorts: this.#repo.protectedPorts(),
    };
  }

  #require(id: string): ProjectConfig {
    const config = this.#repo.find(id);
    if (!config) throw new NotFoundError(`No existe el proyecto "${id}"`);
    return config;
  }

  async start(id: string): Promise<ProjectState> {
    const state = await this.#processes.start(this.#require(id));
    this.#refreshInBackground();
    return state;
  }

  async stop(id: string): Promise<ProjectState> {
    this.#require(id);
    const state = await this.#processes.stop(id);
    await this.refresh();
    return state;
  }

  async restart(id: string): Promise<ProjectState> {
    const state = await this.#processes.restart(this.#require(id));
    this.#refreshInBackground();
    return state;
  }

  /** Enciende varios proyectos en serie para no pelear por CPU al arrancar. */
  async startMany(ids: string[]): Promise<BatchResult[]> {
    const results: BatchResult[] = [];
    for (const id of ids) {
      try {
        await this.start(id);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: (error as Error).message });
      }
    }
    return results;
  }

  async stopMany(ids: string[]): Promise<BatchResult[]> {
    return Promise.all(
      ids.map(async (id) => {
        try {
          await this.stop(id);
          return { id, ok: true };
        } catch (error) {
          return { id, ok: false, error: (error as Error).message };
        }
      }),
    );
  }

  logs(id: string) {
    this.#require(id);
    return this.#logs.get(id);
  }

  /** Revisa config y realidad de cada proyecto. Se pide aparte: lee archivos de los repos. */
  async diagnostics(): Promise<ProjectDiagnosis[]> {
    const snapshot = await this.refresh();
    return this.#doctor.diagnose({
      configs: snapshot.projects.map((entry) => entry.config),
      states: snapshot.projects.map((entry) => entry.state),
      ports: snapshot.ports,
      protectedPorts: snapshot.protectedPorts,
    });
  }

  /** Para el formulario: ¿existe la carpeta y qué tipo de proyecto parece? */
  inspectFolder(path: string): FolderInfo {
    return inspectFolder(path);
  }

  async killPort(port: number, force: boolean): Promise<{ killed: number[] }> {
    const result = await this.#scanner.killPort(port, force);
    await this.refresh();
    return result;
  }

  async services(): Promise<{ brew: BrewServiceInfo[]; docker: DockerContainerInfo[] }> {
    const [brew, docker] = await Promise.all([this.#brew.list(), this.#docker.list()]);
    return { brew, docker };
  }

  async controlBrew(name: string, action: ServiceAction): Promise<void> {
    await this.#brew.control(name, action);
    await this.refresh();
  }

  async controlDocker(name: string, action: ServiceAction): Promise<void> {
    await this.#docker.control(name, action);
    await this.refresh();
  }

  async reloadConfig(): Promise<Snapshot> {
    await this.#repo.load();
    this.#scanner.setProtectedPorts(this.#repo.protectedPorts());
    this.#publish({ type: 'config-changed' });
    return this.refresh();
  }

  async saveProject(config: ProjectConfig): Promise<Snapshot> {
    await this.#repo.upsert(config);
    this.#publish({ type: 'config-changed' });
    return this.refresh();
  }

  async deleteProject(id: string): Promise<Snapshot> {
    if (this.#processes.isManaged(id)) {
      throw new ConflictError('Apaga el proyecto antes de eliminarlo de la configuración');
    }
    await this.#repo.remove(id);
    this.#publish({ type: 'config-changed' });
    return this.refresh();
  }

  async shutdown(): Promise<void> {
    this.stopWatching();
    await this.#processes.stopAll();
  }
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
