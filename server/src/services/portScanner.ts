import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ListeningProcess } from '@capitania/shared';

const run = promisify(execFile);

/**
 * Lee los puertos TCP en LISTEN vía `lsof`.
 *
 * Se usa el modo `-F pcn` (salida por campos) en vez de la tabla humana: cada
 * línea trae un prefijo de una letra (p=pid, c=comando, n=dirección), así el
 * parseo no depende del ancho de columnas ni del idioma del sistema.
 */
export class PortScanner {
  #protectedPorts: Set<number>;

  constructor(protectedPorts: number[] = []) {
    this.#protectedPorts = new Set(protectedPorts);
  }

  setProtectedPorts(ports: number[]): void {
    this.#protectedPorts = new Set(ports);
  }

  async scan(): Promise<ListeningProcess[]> {
    let stdout: string;
    try {
      const result = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'], {
        maxBuffer: 4 * 1024 * 1024,
      });
      stdout = result.stdout;
    } catch (error) {
      // lsof sale con código 1 cuando no encuentra nada: no es un fallo real.
      const failure = error as { code?: number; stdout?: string };
      if (failure.code === 1 && !failure.stdout) return [];
      if (typeof failure.stdout === 'string') stdout = failure.stdout;
      else throw error;
    }

    const owners: Array<Omit<ListeningProcess, 'cwd'>> = [];
    const seen = new Set<string>();
    let pid = 0;
    let command = '';

    for (const line of stdout.split('\n')) {
      const field = line[0];
      const value = line.slice(1);
      if (field === 'p') {
        pid = Number.parseInt(value, 10);
        command = '';
      } else if (field === 'c') {
        command = value;
      } else if (field === 'n') {
        const parsed = parseAddress(value);
        if (!parsed) continue;
        // Un proceso puede escuchar el mismo puerto en IPv4 e IPv6: se colapsa.
        const key = `${pid}:${parsed.port}`;
        if (seen.has(key)) continue;
        seen.add(key);
        owners.push({ port: parsed.port, pid, command, address: parsed.address });
      }
    }

    const cwdByPid = await this.cwdOf([...new Set(owners.map((owner) => owner.pid))]);
    return owners
      .map((owner) => ({ ...owner, cwd: cwdByPid.get(owner.pid) ?? null }))
      .sort((a, b) => a.port - b.port);
  }

  /**
   * Carpeta de trabajo de cada PID. Sirve para saber a qué proyecto pertenece un
   * proceso que Capitanía no lanzó (el comando solo dice "node" o "Python").
   */
  async cwdOf(pids: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (pids.length === 0) return result;
    let stdout = '';
    try {
      ({ stdout } = await run('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-F', 'pn']));
    } catch (error) {
      // Si algún PID murió entre el escaneo y esta llamada, lsof sale con 1 pero
      // igual imprime los que encontró.
      stdout = (error as { stdout?: string }).stdout ?? '';
    }
    let pid = 0;
    for (const line of stdout.split('\n')) {
      if (line[0] === 'p') pid = Number.parseInt(line.slice(1), 10);
      else if (line[0] === 'n') result.set(pid, line.slice(1));
    }
    return result;
  }

  /**
   * Mata todos los procesos que escuchan en un puerto. SIGTERM primero y
   * SIGKILL solo si siguen vivos, para dar chance a un apagado limpio.
   */
  async killPort(port: number, force = false): Promise<{ killed: number[] }> {
    if (this.#protectedPorts.has(port)) {
      throw new Error(`El puerto ${port} está protegido en la configuración`);
    }

    const owners = (await this.scan()).filter((owner) => owner.port === port);
    if (owners.length === 0) return { killed: [] };

    const pids = [...new Set(owners.map((owner) => owner.pid))];
    for (const pid of pids) {
      try {
        process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        // Ya no existe: se ignora.
      }
    }

    if (!force) {
      await delay(1500);
      const survivors = (await this.scan())
        .filter((owner) => owner.port === port)
        .map((owner) => owner.pid);
      for (const pid of survivors) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* ya murió */
        }
      }
    }

    return { killed: pids };
  }
}

function parseAddress(value: string): { port: number; address: string } | null {
  // Formatos posibles: "*:3010", "127.0.0.1:5432", "[::1]:6379".
  const separator = value.lastIndexOf(':');
  if (separator < 0) return null;
  const port = Number.parseInt(value.slice(separator + 1), 10);
  if (!Number.isInteger(port)) return null;
  return { port, address: value.slice(0, separator) || '*' };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
