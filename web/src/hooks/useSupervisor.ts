import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { LogLine, ProjectEntry, ServerEvent, Snapshot } from '@capitania/shared';

/** Máximo de líneas de log que el navegador guarda por proyecto. */
const LOG_LIMIT = 2000;

export type Connection = 'connecting' | 'online' | 'offline';

/**
 * Único punto de contacto con el servidor: carga el estado inicial por HTTP y
 * después se mantiene al día por WebSocket, con reconexión automática.
 */
export function useSupervisor() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const load = useCallback(async () => {
    try {
      setSnapshot(await api.state());
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let disposed = false;
    let retry: number | undefined;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => setConnection('online');
      socket.onclose = () => {
        setConnection('offline');
        if (!disposed) retry = window.setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();

      socket.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as ServerEvent;

        if (message.type === 'snapshot') {
          // El evento trae solo estados; la config sale del snapshot HTTP.
          setSnapshot((current) => {
            if (!current) return current;
            const states = new Map(message.projects.map((state) => [state.id, state]));
            return {
              ...current,
              ports: message.ports,
              projects: current.projects.map((entry) => ({
                ...entry,
                state: states.get(entry.config.id) ?? entry.state,
              })),
            };
          });
        } else if (message.type === 'project-state') {
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  projects: current.projects.map((entry) =>
                    entry.config.id === message.state.id
                      ? { ...entry, state: message.state }
                      : entry,
                  ),
                }
              : current,
          );
        } else if (message.type === 'log') {
          const line = message.line;
          setLogs((current) => {
            const previous = current[line.projectId] ?? [];
            const next = [...previous, line];
            if (next.length > LOG_LIMIT) next.splice(0, next.length - LOG_LIMIT);
            return { ...current, [line.projectId]: next };
          });
        } else if (message.type === 'config-changed') {
          void load();
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retry);
      socketRef.current?.close();
    };
  }, [load]);

  /** Trae del servidor el histórico de logs de un proyecto (al abrir el panel). */
  const loadLogs = useCallback(async (id: string) => {
    const { lines } = await api.logs(id);
    setLogs((current) => ({ ...current, [id]: lines }));
  }, []);

  /** Ejecuta una acción y deja el mensaje de error a la vista si falla. */
  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);

  const projects: ProjectEntry[] = snapshot?.projects ?? [];

  return { snapshot, projects, logs, connection, error, setError, load, loadLogs, run };
}
