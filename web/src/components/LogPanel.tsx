import { useEffect, useMemo, useRef, useState } from 'react';
import { useEscape } from '../hooks/useEscape.ts';
import { SegmentedControl } from './SegmentedControl.tsx';
import type { LogLine, ProjectEntry } from '@capitania/shared';
import { groupRepeats, parseLog, type LogGroup, type Severity } from '../lib/logParser.ts';

type View = 'all' | 'requests' | 'problems';

const VIEWS: ReadonlyArray<readonly [View, string]> = [
  ['all', 'Todo'],
  ['requests', 'Peticiones'],
  ['problems', 'Problemas'],
];

const SEVERITY_TEXT: Record<Severity, string> = {
  debug: 'text-slate-600',
  info: 'text-slate-300',
  success: 'text-slate-300',
  warn: 'text-amber-300',
  error: 'text-rose-300',
  system: 'text-sky-400',
};

const STATUS_STYLE = (status: number) =>
  status >= 500
    ? 'bg-rose-500/20 text-rose-200'
    : status >= 400
      ? 'bg-amber-500/20 text-amber-200'
      : status >= 300
        ? 'bg-sky-500/15 text-sky-200'
        : 'bg-emerald-500/15 text-emerald-300';

const METHOD_STYLE: Record<string, string> = {
  GET: 'text-sky-300',
  POST: 'text-emerald-300',
  PUT: 'text-amber-300',
  PATCH: 'text-amber-300',
  DELETE: 'text-rose-300',
};

/** Más de esto ya se nota al navegar: se resalta el tiempo. */
const SLOW_MS = 800;

interface Props {
  entry: ProjectEntry;
  lines: LogLine[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
}

export function LogPanel({ entry, lines, expanded, onToggleExpanded, onClose }: Props) {
  const [follow, setFollow] = useState(true);
  const [view, setView] = useState<View>('all');
  const [showNoise, setShowNoise] = useState(false);
  const [query, setQuery] = useState('');
  /** "Limpiar vista": solo oculta lo anterior en pantalla, el servidor conserva todo. */
  const [clearedAt, setClearedAt] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  // Al cambiar de proyecto se vuelve a mostrar todo su historial.
  useEffect(() => setClearedAt(0), [entry.config.id]);

  const parsed = useMemo(
    () => lines.filter((line) => line.seq > clearedAt).map(parseLog),
    [lines, clearedAt],
  );

  const { groups, hiddenNoise } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let hidden = 0;
    const visible = parsed.filter((log) => {
      if (view === 'requests' && log.kind !== 'http') return false;
      if (view === 'problems' && log.severity !== 'warn' && log.severity !== 'error') return false;
      if (needle && !log.message.toLowerCase().includes(needle)) return false;
      if (log.noise && !showNoise) {
        hidden += 1;
        return false;
      }
      return true;
    });
    return { groups: groupRepeats(visible), hiddenNoise: hidden };
  }, [parsed, view, query, showNoise]);

  const problems = parsed.filter((log) => log.severity === 'error').length;

  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ block: 'end' });
  }, [groups, follow]);

  useEscape(onClose);

  return (
    <aside className="flex h-full flex-col border-l border-slate-800 bg-slate-950">
      <header className="space-y-2.5 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-slate-100">
              {entry.config.name}
              {problems > 0 && (
                <span className="ml-2 rounded-full bg-rose-500/15 px-1.5 py-px text-[10px] text-rose-300">
                  {problems} error{problems > 1 ? 'es' : ''}
                </span>
              )}
            </h2>
            <p className="truncate font-mono text-[11px] text-slate-500">{entry.config.command}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={follow}
                onChange={(event) => setFollow(event.target.checked)}
                className="accent-sky-500"
              />
              Seguir
            </label>
            <button
              type="button"
              onClick={onToggleExpanded}
              title={expanded ? 'Volver al ancho normal' : 'Ver el panel más grande'}
              className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              {expanded ? 'Reducir' : 'Ampliar'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="Filtrar logs" size="sm" value={view} onChange={setView} options={VIEWS} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar en logs…"
            className="min-w-0 flex-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setClearedAt(lines[lines.length - 1]?.seq ?? 0)}
            title="Oculta lo anterior para empezar una prueba desde cero"
            className="rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            Limpiar vista
          </button>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500">
          <input
            type="checkbox"
            checked={showNoise}
            onChange={(event) => setShowNoise(event.target.checked)}
            className="accent-sky-500"
          />
          Mostrar ruido (OPTIONS, estáticos, DEBUG, duplicados)
          {!showNoise && hiddenNoise > 0 && <span className="text-slate-600">· {hiddenNoise} ocultas</span>}
        </label>
      </header>

      <div
        className="thin-scroll flex-1 overflow-auto px-2 py-2 font-mono text-[11.5px] leading-relaxed"
        onScroll={(event) => {
          const el = event.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (atBottom !== follow) setFollow(atBottom);
        }}
      >
        {groups.length === 0 ? (
          <p className="p-4 text-center font-sans text-xs text-slate-600">
            {lines.length === 0
              ? 'Sin logs todavía. Enciende el proyecto para ver su salida en vivo.'
              : 'Nada que mostrar con estos filtros.'}
          </p>
        ) : (
          groups.map((group) => <LogRow key={group.log.seq} group={group} />)
        )}
        <div ref={endRef} />
      </div>
    </aside>
  );
}

function LogRow({ group: { log, count } }: { group: LogGroup }) {
  const repeat = count > 1 && (
    <span className="ml-1.5 rounded bg-slate-800 px-1 text-[10px] text-slate-400">×{count}</span>
  );

  return (
    <div className="flex gap-2 rounded px-1.5 py-px hover:bg-slate-900/70">
      <span className="shrink-0 text-slate-600 tabular-nums">{log.time}</span>
      {log.http ? (
        <>
          <span className={`w-14 shrink-0 font-semibold ${METHOD_STYLE[log.http.method] ?? 'text-slate-400'}`}>
            {log.http.method}
          </span>
          <span className="min-w-0 flex-1 truncate text-slate-200" title={log.http.path}>
            {log.http.path}
            {repeat}
          </span>
          <span className={`shrink-0 rounded px-1.5 font-semibold ${STATUS_STYLE(log.http.status)}`}>
            {log.http.status}
          </span>
          <span
            className={`w-14 shrink-0 text-right tabular-nums ${log.http.ms >= SLOW_MS ? 'text-amber-300' : 'text-slate-500'}`}
          >
            {log.http.ms} ms
          </span>
        </>
      ) : (
        <>
          {log.kind === 'ws' && <span className="w-14 shrink-0 font-semibold text-violet-300">WS</span>}
          <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${SEVERITY_TEXT[log.severity]}`}>
            {log.source && <span className="text-slate-600">{log.source} · </span>}
            {log.message}
            {repeat}
          </span>
        </>
      )}
    </div>
  );
}
