import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { BrewServiceInfo, DockerContainerInfo, ServiceAction } from '@capitania/shared';

type Manager = 'brew' | 'docker';

/** Postgres, Redis y contenedores Docker: la infraestructura que usan los proyectos. */
export function ServicesPanel({ onError }: { onError: (message: string) => void }) {
  const [brew, setBrew] = useState<BrewServiceInfo[]>([]);
  const [docker, setDocker] = useState<DockerContainerInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.services();
      setBrew(data.brew);
      setDocker(data.docker);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
    // brew y docker son lentos de consultar: se refrescan cada 10 s, no en cada tick.
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const control = async (manager: Manager, name: string, action: ServiceAction) => {
    setBusy(`${manager}:${name}`);
    try {
      const data = await api.controlService(manager, name, action);
      setBrew(data.brew);
      setDocker(data.docker);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="py-10 text-center text-sm text-slate-600">Consultando...</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Homebrew
        </h2>
        <div className="space-y-2">
          {brew.map((service) => (
            <Row
              key={service.name}
              title={service.name}
              subtitle={service.status}
              running={service.running}
              busy={busy === `brew:${service.name}`}
              onToggle={() => control('brew', service.name, service.running ? 'stop' : 'start')}
              onRestart={
                service.running ? () => control('brew', service.name, 'restart') : undefined
              }
            />
          ))}
          {brew.length === 0 && <Empty>Homebrew no reporta servicios.</Empty>}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Docker</h2>
        <div className="space-y-2">
          {docker.map((container) => (
            <Row
              key={container.id}
              title={container.name}
              subtitle={`${container.status}${container.ports ? ` · ${container.ports}` : ''}`}
              running={container.running}
              busy={busy === `docker:${container.name}`}
              onToggle={() =>
                control('docker', container.name, container.running ? 'stop' : 'start')
              }
              onRestart={
                container.running ? () => control('docker', container.name, 'restart') : undefined
              }
            />
          ))}
          {docker.length === 0 && <Empty>Docker no está corriendo o no hay contenedores.</Empty>}
        </div>
      </section>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-xs text-slate-600">
      {children}
    </p>
  );
}

interface RowProps {
  title: string;
  subtitle: string;
  running: boolean;
  busy: boolean;
  onToggle: () => void;
  onRestart?: (() => void) | undefined;
}

function Row({ title, subtitle, running, busy, onToggle, onRestart }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`size-1.5 shrink-0 rounded-full ${running ? 'bg-emerald-400' : 'bg-slate-600'}`}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-200">{title}</p>
          <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {onRestart && (
          <button
            type="button"
            onClick={onRestart}
            disabled={busy}
            className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          >
            Reiniciar
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
            running
              ? 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
              : 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
          }`}
        >
          {running ? 'Detener' : 'Iniciar'}
        </button>
      </div>
    </div>
  );
}
