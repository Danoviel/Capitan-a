import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BrewServiceInfo, DockerContainerInfo, ServiceAction } from '@capitania/shared';

const run = promisify(execFile);

/** Servicios de fondo de Homebrew: postgresql, redis, etc. */
export class BrewServices {
  async list(): Promise<BrewServiceInfo[]> {
    try {
      const { stdout } = await run('brew', ['services', 'list', '--json'], { timeout: 15_000 });
      const parsed = JSON.parse(stdout) as Array<{
        name: string;
        status: string;
        user: string | null;
      }>;
      return parsed.map((service) => ({
        name: service.name,
        status: service.status,
        running: service.status === 'started',
        user: service.user ?? null,
      }));
    } catch {
      // Homebrew puede no estar instalado: el panel simplemente no muestra la sección.
      return [];
    }
  }

  async control(name: string, action: ServiceAction): Promise<void> {
    assertSafeName(name);
    await run('brew', ['services', action, name], { timeout: 60_000 });
  }
}

/** Contenedores Docker, incluidos los detenidos. */
export class DockerServices {
  async list(): Promise<DockerContainerInfo[]> {
    try {
      const { stdout } = await run('docker', ['ps', '-a', '--format', '{{json .}}'], {
        timeout: 15_000,
      });
      return stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, string>)
        .map((entry) => ({
          id: entry.ID ?? '',
          name: entry.Names ?? '',
          image: entry.Image ?? '',
          status: entry.Status ?? '',
          running: (entry.State ?? '').toLowerCase() === 'running',
          ports: entry.Ports ?? '',
        }));
    } catch {
      // Docker Desktop apagado o no instalado.
      return [];
    }
  }

  async control(name: string, action: ServiceAction): Promise<void> {
    assertSafeName(name);
    await run('docker', [action, name], { timeout: 60_000 });
  }
}

/**
 * El nombre viene de la URL. Aunque `execFile` no usa shell (no hay riesgo de
 * inyección de comandos), se valida igual para no pasar flags disfrazados de
 * nombre, tipo `--all`.
 */
function assertSafeName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(name)) {
    throw new Error(`Nombre de servicio inválido: ${name}`);
  }
}
