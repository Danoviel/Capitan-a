import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { DEV_DASHBOARD_PORT } from '@puertosview/shared';

/**
 * Candado contra páginas web ajenas.
 *
 * Escuchar solo en 127.0.0.1 evita conexiones desde otra máquina, pero no desde
 * el navegador de esta Mac: cualquier página que abras puede mandar peticiones a
 * localhost. Por eso se validan dos cabeceras que el JavaScript de una página no
 * puede falsificar:
 *
 * - `Host`: debe ser exactamente localhost/127.0.0.1 en nuestros puertos. Frena el
 *   DNS rebinding, donde un dominio del atacante pasa a resolver a 127.0.0.1 y el
 *   navegador lo trata como "mismo origen" (llegaría con `Host: atacante.com`).
 * - `Origin`: si viene, debe ser el propio dashboard. Frena el CSRF (formularios o
 *   fetch desde otra web) y el secuestro del WebSocket, que no tiene CORS.
 *
 * Sin `Origin` se deja pasar: así llegan curl, la app de barra de menú y las
 * navegaciones normales, y ninguno de ellos es una página ajena.
 */
export function createLocalOriginGuard(port: number) {
  const hosts = new Set(
    [port, DEV_DASHBOARD_PORT].flatMap((p) => [`localhost:${p}`, `127.0.0.1:${p}`]),
  );
  const origins = new Set([...hosts].map((host) => `http://${host}`));

  const isAllowed = (req: IncomingMessage): boolean => {
    const { host, origin } = req.headers;
    if (!host || !hosts.has(host)) return false;
    return origin === undefined || origins.has(origin);
  };

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    if (isAllowed(req)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Petición rechazada: solo se acepta desde el panel local' });
  };

  return { isAllowed, middleware };
}
