import type { DiagnosisLevel, ProjectDiagnosis } from '@capitania/shared';

const PRESET: Record<DiagnosisLevel, { label: string; icon: string; pill: string; text: string }> = {
  ok: {
    label: 'Integrado',
    icon: '✓',
    pill: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20',
    text: 'text-slate-500',
  },
  warn: {
    label: 'Desalineado',
    icon: '!',
    pill: 'bg-amber-500/10 text-amber-300 ring-amber-500/25',
    text: 'text-amber-200/90',
  },
  error: {
    label: 'Con errores',
    icon: '✕',
    pill: 'bg-rose-500/10 text-rose-300 ring-rose-500/25',
    text: 'text-rose-200/90',
  },
};

const ORDER: Record<DiagnosisLevel, number> = { error: 0, warn: 1, ok: 2 };

/** Insignia desplegable: qué tan bien está enganchado el proyecto y por qué. */
export function DiagnosisPanel({ diagnosis }: { diagnosis: ProjectDiagnosis }) {
  const preset = PRESET[diagnosis.level];
  const problems = diagnosis.checks.filter((check) => check.level !== 'ok').length;
  const checks = [...diagnosis.checks].sort((a, b) => ORDER[a.level] - ORDER[b.level]);

  return (
    <details className="group mt-3" open={diagnosis.level === 'error'}>
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 select-none ${preset.pill}`}
      >
        <span aria-hidden>{preset.icon}</span>
        {preset.label}
        {problems > 0 && <span className="opacity-70">· {problems}</span>}
        <span aria-hidden className="opacity-60 transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <ul className="mt-2 space-y-1">
        {checks.map((check) => (
          <li
            key={check.message}
            className={`flex gap-1.5 text-[11px] leading-snug ${PRESET[check.level].text}`}
          >
            <span aria-hidden className="shrink-0">
              {PRESET[check.level].icon}
            </span>
            <span>{check.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
