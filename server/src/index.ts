import { createServer } from 'node:http';
import { DEFAULT_SERVER_PORT } from '@puertosview/shared';
import { ProjectRepository } from './config/projectRepository.ts';
import { LogBuffer } from './services/logBuffer.ts';
import { PortScanner } from './services/portScanner.ts';
import { ProcessManager } from './services/processManager.ts';
import { BrewServices, DockerServices } from './services/systemServices.ts';
import { ProjectDoctor } from './services/projectDoctor.ts';
import { Supervisor } from './app/supervisor.ts';
import { EventHub } from './realtime/eventHub.ts';
import { createApp } from './http/createApp.ts';
import { createLocalOriginGuard } from './http/localOriginGuard.ts';

const PORT = Number.parseInt(process.env.PUERTOSVIEW_PORT ?? String(DEFAULT_SERVER_PORT), 10);
/** Solo loopback: este servidor puede lanzar procesos, no debe salir de la Mac. */
const HOST = '127.0.0.1';

async function main() {
  const repo = new ProjectRepository();
  try {
    await repo.load();
  } catch (error) {
    console.error(`\n✖ ${(error as Error).message}\n`);
    process.exit(1);
  }

  const logs = new LogBuffer();
  const scanner = new PortScanner(repo.protectedPorts());
  const processes = new ProcessManager(logs, scanner);
  const supervisor = new Supervisor({
    repo,
    processes,
    scanner,
    logs,
    brew: new BrewServices(),
    docker: new DockerServices(),
    doctor: new ProjectDoctor(),
  });

  const guard = createLocalOriginGuard(PORT);
  const server = createServer(createApp(supervisor, guard.middleware));
  const hub = new EventHub(
    server,
    () => {
      const snapshot = supervisor.snapshot();
      return {
        type: 'snapshot',
        projects: snapshot.projects.map((entry) => entry.state),
        ports: snapshot.ports,
      };
    },
    guard.isAllowed,
  );

  supervisor.connect((event) => hub.broadcast(event));
  supervisor.startWatching();

  server.listen(PORT, HOST, () => {
    console.log(`\n  PuertosView  →  http://${HOST}:${PORT}`);
    console.log(`  Config       →  ${repo.path}`);
    console.log(`  Proyectos    →  ${repo.all().length}\n`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `✖ El puerto ${PORT} ya está ocupado. Usa PUERTOSVIEW_PORT=otro para cambiarlo.`,
      );
      process.exit(1);
    }
    throw error;
  });

  // Al cerrar PuertosView se apagan también los proyectos que lanzó: dejarlos
  // huérfanos significaría puertos ocupados sin panel que los controle.
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`\n${signal} recibido, apagando proyectos...`);
    await supervisor.shutdown();
    hub.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };

  // Red de seguridad: si una promesa falla sin catch, Node mata el proceso por
  // defecto. launchd lo levantaría, pero ya sin saber qué proyectos lanzó, que
  // quedarían huérfanos como "external". Mejor registrar el error y seguir.
  process.on('unhandledRejection', (reason) => {
    console.error('Promesa rechazada sin manejar:', reason);
  });

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
