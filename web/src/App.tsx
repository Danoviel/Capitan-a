import { useCallback, useMemo, useState } from 'react';
import { api } from './api/client.ts';
import { useSupervisor } from './hooks/useSupervisor.ts';
import { useDiagnostics } from './hooks/useDiagnostics.ts';
import { useResizableWidth } from './hooks/useResizableWidth.ts';
import { ProjectCard } from './components/ProjectCard.tsx';
import { LogPanel } from './components/LogPanel.tsx';
import { PortsPanel } from './components/PortsPanel.tsx';
import { ServicesPanel } from './components/ServicesPanel.tsx';
import { ProjectFormDialog } from './components/ProjectFormDialog.tsx';
import { SegmentedControl } from './components/SegmentedControl.tsx';
import { hasLiveProcess, isUp, type ProjectConfig, type ProjectEntry } from '@capitania/shared';

type Tab = 'projects' | 'ports' | 'services';

/** Filtro por diagnóstico: todos, solo los bien enganchados o solo los que hay que revisar. */
type HealthFilter = 'all' | 'ok' | 'problems';

/**
 * Qué proyecto está abierto en el formulario:
 * `null` = cerrado, `'new'` = alta, o el id del que se está editando.
 */
type Editing = null | 'new' | string;

export function App() {
  const { snapshot, projects, logs, connection, error, setError, load, loadLogs, run } =
    useSupervisor();
  const [tab, setTab] = useState<Tab>('projects');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [openLogs, setOpenLogs] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [health, setHealth] = useState<HealthFilter>('all');
  const diagnoses = useDiagnostics(snapshot);
  const logWidth = useResizableWidth('capitania.logPanelWidth', 544);

  /** Marca un proyecto como ocupado mientras dura su acción, para bloquear el doble click. */
  const withBusy = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setBusy((current) => new Set(current).add(id));
      await run(action);
      setBusy((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    },
    [run],
  );

  const healthCount = useMemo(() => {
    let ok = 0;
    for (const diagnosis of diagnoses.values()) if (diagnosis.level === 'ok') ok += 1;
    return { ok, problems: diagnoses.size - ok };
  }, [diagnoses]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((entry) => {
      const level = diagnoses.get(entry.config.id)?.level;
      if (health === 'ok' && level !== 'ok') return false;
      if (health === 'problems' && (level === undefined || level === 'ok')) return false;
      if (!needle) return true;
      const haystack = `${entry.config.name} ${entry.config.group} ${entry.config.port ?? ''} ${entry.config.kind}`;
      return haystack.toLowerCase().includes(needle);
    });
  }, [projects, query, health, diagnoses]);

  const groups = useMemo(() => {
    const map = new Map<string, ProjectEntry[]>();
    for (const entry of filtered) {
      const list = map.get(entry.config.group) ?? [];
      list.push(entry);
      map.set(entry.config.group, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));
  }, [filtered]);

  const runningIds = projects
    .filter((entry) => isUp(entry.state.status))
    .map((entry) => entry.config.id);

  const selected = openLogs ? projects.find((entry) => entry.config.id === openLogs) : undefined;

  const editingEntry =
    editing && editing !== 'new'
      ? projects.find((entry) => entry.config.id === editing)
      : undefined;

  const showLogs = async (id: string) => {
    setOpenLogs(id);
    await run(() => loadLogs(id));
  };

  /** Crea o actualiza según si el formulario está en modo alta. El diálogo se
   *  cierra solo si el servidor aceptó: si falla, queda abierto con el error. */
  const saveProject = async (config: ProjectConfig) => {
    const creating = editing === 'new';
    await run(async () => {
      await (creating ? api.createProject(config) : api.updateProject(config));
      await load();
      setEditing(null);
    });
  };

  const deleteProject = async (id: string) => {
    await run(async () => {
      await api.deleteProject(id);
      await load();
      setEditing(null);
      if (openLogs === id) setOpenLogs(null);
    });
  };

  const killPort = async (port: number) => {
    if (!window.confirm(`¿Liberar el puerto ${port}? Se enviará SIGTERM al proceso que lo ocupa.`))
      return;
    await run(() => api.killPort(port));
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900/50 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔌</span>
          <h1 className="text-sm font-semibold tracking-tight text-slate-100">Capitanía</h1>
          <ConnectionDot connection={connection} />
        </div>

        <SegmentedControl
          label="Secciones"
          value={tab}
          onChange={setTab}
          options={[
            ['projects', `Proyectos (${runningIds.length}/${projects.length})`],
            ['ports', `Puertos (${snapshot?.ports.length ?? 0})`],
            ['services', 'Servicios'],
          ]}
        />

        {tab === 'projects' && diagnoses.size > 0 && (
          <SegmentedControl
            label="Filtrar por integración"
            size="sm"
            value={health}
            onChange={setHealth}
            options={[
              ['all', 'Todos'],
              ['ok', `✓ Integrados (${healthCount.ok})`],
              ['problems', `! Por revisar (${healthCount.problems})`],
            ]}
          />
        )}

        <div className="ml-auto flex items-center gap-2">
          {tab === 'projects' && (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar proyecto o puerto..."
              className="w-52 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none"
            />
          )}
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25"
          >
            + Nuevo proyecto
          </button>
          <button
            type="button"
            onClick={() => void run(() => api.reloadConfig().then(load))}
            className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            title="Releer projects.json"
          >
            Recargar config
          </button>
          <button
            type="button"
            disabled={runningIds.length === 0}
            onClick={() => {
              if (!window.confirm(`¿Apagar ${runningIds.length} proyecto(s) encendido(s)?`)) return;
              void run(() => api.stopMany(runningIds));
            }}
            className="rounded-lg bg-rose-500/15 px-2.5 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/25 disabled:opacity-40"
          >
            Apagar todo
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-3 border-b border-rose-900/50 bg-rose-950/40 px-5 py-2 text-xs text-rose-200">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0 text-rose-400">
            cerrar
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="thin-scroll flex-1 overflow-auto p-5">
          {tab === 'projects' && (
            <div className="space-y-7">
              {groups.map(([group, entries]) => (
                <section key={group}>
                  <div className="mb-3 flex items-center gap-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {group}
                    </h2>
                    <div className="h-px flex-1 bg-slate-800" />
                    <button
                      type="button"
                      onClick={() =>
                        void run(() => api.startMany(entries.map((entry) => entry.config.id)))
                      }
                      className="text-[11px] text-slate-500 hover:text-emerald-300"
                    >
                      encender grupo
                    </button>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-3">
                    {entries.map((entry) => (
                      <ProjectCard
                        key={entry.config.id}
                        entry={entry}
                        diagnosis={diagnoses.get(entry.config.id)}
                        busy={busy.has(entry.config.id)}
                        selected={openLogs === entry.config.id}
                        onStart={() => void withBusy(entry.config.id, () => api.start(entry.config.id))}
                        onStop={() => void withBusy(entry.config.id, () => api.stop(entry.config.id))}
                        onRestart={() =>
                          void withBusy(entry.config.id, () => api.restart(entry.config.id))
                        }
                        onLogs={() => void showLogs(entry.config.id)}
                        onEdit={() => setEditing(entry.config.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {groups.length === 0 && (
                <p className="py-16 text-center text-sm text-slate-600">
                  {snapshot
                    ? 'Ningún proyecto coincide con la búsqueda o el filtro.'
                    : 'Cargando proyectos…'}
                </p>
              )}
            </div>
          )}

          {tab === 'ports' && snapshot && <PortsPanel snapshot={snapshot} onKill={killPort} />}
          {tab === 'services' && <ServicesPanel onError={setError} />}
        </main>

        {selected && (
          <div className="relative hidden shrink-0 lg:block" style={{ width: logWidth.width }}>
            {/* Borde arrastrable: arrastrar cambia el ancho, doble clic lo devuelve al normal. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Cambiar el ancho del panel de logs"
              title="Arrastra para cambiar el ancho · doble clic para restablecer"
              onPointerDown={(event) => {
                event.preventDefault();
                logWidth.startDrag();
              }}
              onDoubleClick={logWidth.reset}
              className={`absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-sky-500/40 ${
                logWidth.dragging ? 'bg-sky-500/60' : ''
              }`}
            />
            <LogPanel
              entry={selected}
              lines={logs[selected.config.id] ?? []}
              expanded={logWidth.expanded}
              onToggleExpanded={logWidth.toggleExpanded}
              onClose={() => setOpenLogs(null)}
            />
          </div>
        )}
      </div>

      <footer className="border-t border-slate-800 px-5 py-1.5 text-[11px] text-slate-600">
        {snapshot?.configPath ?? 'Cargando configuración...'}
      </footer>

      {editing && (
        <ProjectFormDialog
          project={editingEntry?.config ?? null}
          existingIds={projects.map((entry) => entry.config.id)}
          existingGroups={[...new Set(projects.map((entry) => entry.config.group))].sort((a, b) =>
            a.localeCompare(b, 'es'),
          )}
          canDelete={editingEntry ? !hasLiveProcess(editingEntry.state.status) : false}
          allProjects={projects.map((entry) => entry.config)}
          ports={snapshot?.ports ?? []}
          protectedPorts={snapshot?.protectedPorts ?? []}
          onSave={saveProject}
          onDelete={() => deleteProject(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ConnectionDot({ connection }: { connection: 'connecting' | 'online' | 'offline' }) {
  const style =
    connection === 'online'
      ? 'bg-emerald-400'
      : connection === 'connecting'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-rose-500';
  const label =
    connection === 'online' ? 'en vivo' : connection === 'connecting' ? 'conectando' : 'sin conexión';
  return (
    <span className="ml-1 flex items-center gap-1.5 text-[11px] text-slate-500">
      <span className={`size-1.5 rounded-full ${style}`} aria-hidden />
      {label}
    </span>
  );
}
