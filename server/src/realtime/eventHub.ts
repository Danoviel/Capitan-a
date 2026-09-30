import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ServerEvent } from '@capitania/shared';

/**
 * Empuja los cambios al dashboard por WebSocket, para que el estado y los logs
 * lleguen solos y el navegador no tenga que preguntar cada segundo.
 */
export class EventHub {
  #wss: WebSocketServer;
  #onConnect: () => ServerEvent;

  /**
   * `isAllowed` es obligatorio: el navegador no aplica CORS a los WebSockets, así
   * que sin él cualquier página abierta podría leer los logs en vivo.
   */
  constructor(
    server: Server,
    onConnect: () => ServerEvent,
    isAllowed: (req: IncomingMessage) => boolean,
  ) {
    this.#onConnect = onConnect;
    this.#wss = new WebSocketServer({
      server,
      path: '/ws',
      verifyClient: ({ req }: { req: IncomingMessage }) => isAllowed(req),
    });

    this.#wss.on('connection', (socket) => {
      socket.send(JSON.stringify(this.#onConnect()));
    });
  }

  broadcast(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.#wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  close(): void {
    for (const client of this.#wss.clients) client.terminate();
    this.#wss.close();
  }
}
