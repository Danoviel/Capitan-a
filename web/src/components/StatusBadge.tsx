import type { ProjectStatus } from '@capitania/shared';

const PRESET: Record<ProjectStatus, { label: string; dot: string; text: string; ring: string }> = {
  running: {
    label: 'Encendido',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    ring: 'ring-emerald-500/30',
  },
  starting: {
    label: 'Arrancando',
    dot: 'bg-sky-400 animate-pulse',
    text: 'text-sky-300',
    ring: 'ring-sky-500/30',
  },
  stopping: {
    label: 'Apagando',
    dot: 'bg-amber-400 animate-pulse',
    text: 'text-amber-300',
    ring: 'ring-amber-500/30',
  },
  stopped: {
    label: 'Apagado',
    dot: 'bg-slate-600',
    text: 'text-slate-400',
    ring: 'ring-slate-700/50',
  },
  crashed: {
    label: 'Cayó',
    dot: 'bg-rose-500',
    text: 'text-rose-300',
    ring: 'ring-rose-500/30',
  },
  external: {
    label: 'Puerto ajeno',
    dot: 'bg-violet-400',
    text: 'text-violet-300',
    ring: 'ring-violet-500/30',
  },
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const preset = PRESET[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${preset.text} ${preset.ring}`}
    >
      <span className={`size-1.5 rounded-full ${preset.dot}`} aria-hidden />
      {preset.label}
    </span>
  );
}
