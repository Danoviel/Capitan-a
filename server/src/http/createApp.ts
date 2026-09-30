import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { z } from 'zod';
import { isServiceAction, isValidPort } from '@puertosview/shared';
import { ROOT_DIR, projectSchema } from '../config/projectRepository.ts';
import { ConflictError, NotFoundError, type Supervisor } from '../app/supervisor.ts';

const idsSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });

/** Envuelve un handler async para que los rechazos lleguen al middleware de error. */
function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

/** Express 5 tipa los params como `string | string[] | undefined`; aquí se estrecha a string. */
function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Falta el parámetro "${name}" en la URL`);
  }
  return value;
}

export function createApp(supervisor: Supervisor, guard: RequestHandler) {
  const app = express();
  // Primero el candado: nada de lo que sigue debe correr para una página ajena.
  app.use(guard);
  app.use(express.json({ limit: '256kb' }));

  const api = express.Router();

  api.get(
    '/state',
    wrap(async (_req, res) => {
      res.json(await supervisor.refresh());
    }),
  );

  api.post(
    '/config/reload',
    wrap(async (_req, res) => {
      res.json(await supervisor.reloadConfig());
    }),
  );

  api.get(
    '/diagnostics',
    wrap(async (_req, res) => {
      res.json({ projects: await supervisor.diagnostics() });
    }),
  );

  api.get(
    '/folder',
    wrap(async (req, res) => {
      const path = z.string().min(1).parse(req.query.path);
      res.json(supervisor.inspectFolder(path));
    }),
  );

  // --- Proyectos -----------------------------------------------------------

  api.post(
    '/projects/batch/start',
    wrap(async (req, res) => {
      const { ids } = idsSchema.parse(req.body);
      res.json({ results: await supervisor.startMany(ids) });
    }),
  );

  api.post(
    '/projects/batch/stop',
    wrap(async (req, res) => {
      const { ids } = idsSchema.parse(req.body);
      res.json({ results: await supervisor.stopMany(ids) });
    }),
  );

  api.post(
    '/projects/:id/start',
    wrap(async (req, res) => {
      res.json(await supervisor.start(param(req, 'id')));
    }),
  );

  api.post(
    '/projects/:id/stop',
    wrap(async (req, res) => {
      res.json(await supervisor.stop(param(req, 'id')));
    }),
  );

  api.post(
    '/projects/:id/restart',
    wrap(async (req, res) => {
      res.json(await supervisor.restart(param(req, 'id')));
    }),
  );

  api.get(
    '/projects/:id/logs',
    wrap(async (req, res) => {
      res.json({ lines: supervisor.logs(param(req, 'id')) });
    }),
  );

  api.put(
    '/projects/:id',
    wrap(async (req, res) => {
      const config = projectSchema.parse({ ...req.body, id: param(req, 'id') });
      res.json(await supervisor.saveProject(config));
    }),
  );

  api.post(
    '/projects',
    wrap(async (req, res) => {
      res.status(201).json(await supervisor.saveProject(projectSchema.parse(req.body)));
    }),
  );

  api.delete(
    '/projects/:id',
    wrap(async (req, res) => {
      res.json(await supervisor.deleteProject(param(req, 'id')));
    }),
  );

  // --- Puertos -------------------------------------------------------------

  api.post(
    '/ports/:port/kill',
    wrap(async (req, res) => {
      const port = Number.parseInt(param(req, 'port'), 10);
      if (!isValidPort(port)) {
        res.status(400).json({ error: 'Puerto inválido' });
        return;
      }
      res.json(await supervisor.killPort(port, req.body?.force === true));
    }),
  );

  // --- Servicios del sistema ----------------------------------------------

  api.get(
    '/services',
    wrap(async (_req, res) => {
      res.json(await supervisor.services());
    }),
  );

  api.post(
    '/services/:manager/:name/:action',
    wrap(async (req, res) => {
      const manager = param(req, 'manager');
      const name = param(req, 'name');
      const action = param(req, 'action');
      if (!isServiceAction(action)) {
        res.status(400).json({ error: `Acción inválida: ${action}` });
        return;
      }
      if (manager === 'brew') await supervisor.controlBrew(name, action);
      else if (manager === 'docker') await supervisor.controlDocker(name, action);
      else {
        res.status(400).json({ error: `Gestor desconocido: ${manager}` });
        return;
      }
      res.json(await supervisor.services());
    }),
  );

  app.use('/api', api);

  // En producción el mismo servidor sirve el dashboard compilado: una sola URL.
  const webDist = resolve(ROOT_DIR, 'web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
      res.sendFile(resolve(webDist, 'index.html'));
    });
  }

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof ConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Datos inválidos', issues: error.issues });
      return;
    }
    res.status(400).json({ error: error.message || 'Error inesperado' });
  });

  return app;
}
