import { isUp, type ProjectDiagnosis, type ProjectEntry, type ProjectKind } from '@puertosview/shared';
import { DiagnosisPanel } from './DiagnosisPanel.tsx';
import { ProjectLinks } from './ProjectLinks.tsx';
import { StatusBadge } from './StatusBadge.tsx';

const KIND_STYLE: Record<ProjectKind, string> = {
  django: 'bg-green-500/10 text-green-300 ring-green-500/20',
  vite: 'bg-purple-500/10 text-purple-300 ring-purple-500/20',
  next: 'bg-slate-500/10 text-slate-300 ring-slate-500/20',
  angular: 'bg-red-500/10 text-red-300 ring-red-500/20',
  node: 'bg-lime-500/10 text-lime-300 ring-lime-500/20',
  custom: 'bg-cyan-500/10 text-cyan-300 ring-cyan-500/20',
};

interface Props {
  entry: ProjectEntry;
  diagnosis: ProjectDiagnosis | undefined;
  busy: boolean;
  selected: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onLogs: () => void;
  onEdit: () => void;
}

export function ProjectCard({
  entry,
  diagnosis,
  busy,
  selected,
  onStart,
  onStop,
  onRestart,
  onLogs,
  onEdit,
}: Props) {
  const { config, state } = entry;
  const up = isUp(state.status);
  const isExternal = state.status === 'external';

  return (
    <article
      className={`rounded-xl border bg-slate-900/60 p-4 transition-colors ${
        selected ? 'border-sky-500/60 bg-slate-900' : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-slate-100">{config.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span
              className={`rounded px-1.5 py-px text-[10px] font-medium uppercase ring-1 ${KIND_STYLE[config.kind]}`}
            >
              {config.kind}
            </span>
            {config.port !== null && (
              <span className="font-mono whitespace-nowrap">:{config.port}</span>
            )}
            {state.pid !== null && (
              <span className="font-mono whitespace-nowrap">PID {state.pid}</span>
            )}
          </div>
        </div>
        <StatusBadge status={state.status} />
      </header>

      <ProjectLinks config={config} reachable={up || isExternal} />

      {diagnosis && <DiagnosisPanel diagnosis={diagnosis} />}

      {isExternal && state.portOwner && (
        <p className="mt-3 rounded-lg bg-violet-500/10 px-2.5 py-1.5 text-[11px] text-violet-200">
          Ocupado por <span className="font-mono">{state.portOwner.command}</span> (PID{' '}
          {state.portOwner.pid}) — no lo lanzó PuertosView.
        </p>
      )}

      {state.lastError && (
        <p className="mt-3 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
          {state.lastError}
        </p>
      )}

      {state.status === 'crashed' && !state.lastError && (
        <p className="mt-3 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
          Terminó con código {state.exitCode ?? '-'}. Revisa los logs.
        </p>
      )}

      {config.notes && <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{config.notes}</p>}

      <footer className="mt-4 flex flex-wrap items-center gap-1.5">
        {up ? (
          <button
            type="button"
            onClick={onStop}
            disabled={busy}
            className="rounded-lg bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-500/25 disabled:opacity-40"
          >
            Apagar
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={busy || isExternal}
            title={isExternal ? 'Libera el puerto antes de encenderlo' : undefined}
            className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:opacity-40"
          >
            Encender
          </button>
        )}

        <button
          type="button"
          onClick={onRestart}
          disabled={busy || !up}
          className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-40"
        >
          Reiniciar
        </button>

        <button
          type="button"
          onClick={onLogs}
          className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-700"
        >
          Logs
        </button>

        <button
          type="button"
          onClick={onEdit}
          title="Editar la configuración de este proyecto"
          className="ml-auto rounded-lg px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
        >
          Editar
        </button>
      </footer>
    </article>
  );
}
