import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.ts';
import type { ProjectDiagnosis, Snapshot } from '@puertosview/shared';

/**
 * Diagnóstico de cada proyecto (¿está bien enganchado con PuertosView?).
 *
 * El servidor lee archivos de cada repo para calcularlo, así que no se pide en
 * cada tick del WebSocket: solo cuando cambia algo que puede alterar el resultado
 * (la config, quién ocupa cada puerto o el estado de un proyecto).
 */
export function useDiagnostics(snapshot: Snapshot | null) {
  const [diagnoses, setDiagnoses] = useState<Map<string, ProjectDiagnosis>>(new Map());

  const trigger = useMemo(() => {
    if (!snapshot) return null;
    const configs = snapshot.projects.map((entry) => JSON.stringify(entry.config)).join('|');
    const states = snapshot.projects.map((entry) => `${entry.config.id}:${entry.state.status}`).join(',');
    const ports = snapshot.ports.map((owner) => `${owner.port}/${owner.pid}`).join(',');
    return `${configs}#${states}#${ports}`;
  }, [snapshot]);

  useEffect(() => {
    if (trigger === null) return;
    let cancelled = false;
    // Pequeña espera: al encender un grupo llegan varios cambios seguidos.
    const timer = window.setTimeout(() => {
      api
        .diagnostics()
        .then(({ projects }) => {
          if (!cancelled) setDiagnoses(new Map(projects.map((item) => [item.id, item])));
        })
        .catch(() => {
          /* el diagnóstico es informativo: si falla, el panel sigue funcionando */
        });
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trigger]);

  return diagnoses;
}
