import { useMemo } from 'react';
import { isUp, type PortCategory, type PortOwner, type ProjectEntry, type Snapshot } from '@capitania/shared';

interface Props {
  snapshot: Snapshot;
  onKill: (port: number) => void;
}

interface Section {
  category: PortCategory;
  title: string;
  hint: string;
  /** Solo se ofrece "Liberar" donde matar el proceso es seguro y esperable. */
  canKill: boolean;
}

const SECTIONS: Section[] = [
  {
    category: 'project',
    title: 'Tus proyectos',
    hint: 'Proyectos registrados, identificados por su carpeta.',
    canKill: true,
  },
  {
    category: 'dev',
    title: 'Desarrollo sin registrar',
    hint: 'Servidores en tus carpetas que Capitanía todavía no conoce.',
    canKill: true,
  },
  {
    category: 'protected',
    title: 'Protegidos',
    hint: 'Infraestructura (BD, Redis, Docker, adb, Capitanía). Se gestionan en Servicios.',
    canKill: false,
  },
  {
    category: 'app',
    title: 'Apps y sistema',
    hint: 'Apps de escritorio y procesos de macOS. Se cierran desde la propia app, no desde aquí.',
    canKill: false,
  },
];

/** `/Users/ana/Documents/x` → `~/Documents/x`, para que la ruta entre en la tabla. */
const shortPath = (path: string) => path.replace(/^\/Users\/[^/]+/, '~');

/**
 * Todos los puertos en LISTEN de la Mac, divididos por para qué se usan. El
 * proyecto sale de la carpeta del proceso, no del número de puerto: uno prendido
 * por fuera puede estar ocupando el puerto que Capitanía reservó para otro.
 */
export function PortsPanel({ snapshot, onKill }: Props) {
  const projectsById = useMemo(
    () => new Map(snapshot.projects.map((entry) => [entry.config.id, entry])),
    [snapshot.projects],
  );

  const grouped = useMemo(() => {
    const map = new Map<PortCategory, PortOwner[]>();
    for (const owner of snapshot.ports) {
      const list = map.get(owner.category) ?? [];
      list.push(owner);
      map.set(owner.category, list);
    }
    return map;
  }, [snapshot.ports]);

  if (snapshot.ports.length === 0) {
    return <p className="py-16 text-center text-sm text-slate-600">Ningún puerto en escucha.</p>;
  }

  return (
    <div className="space-y-6">
      {SECTIONS.map((section) => {
        const rows = grouped.get(section.category) ?? [];
        if (rows.length === 0) return null;
        return (
          <section key={section.category}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {section.title} <span className="font-normal text-slate-600">({rows.length})</span>
              </h2>
              <p className="text-[11px] text-slate-600">{section.hint}</p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full min-w-[40rem] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-20" />
                  <col className="w-48" />
                  <col className="w-20" />
                  <col />
                  <col className="w-28" />
                </colgroup>
                <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Puerto</th>
                    <th className="px-4 py-2 font-medium">Proceso</th>
                    <th className="px-4 py-2 font-medium">PID</th>
                    <th className="px-4 py-2 font-medium">
                      {section.category === 'project' ? 'Proyecto' : 'Carpeta'}
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {rows.map((owner) => (
                    <tr key={`${owner.pid}-${owner.port}`} className="hover:bg-slate-900/50">
                      <td className="px-4 py-2 font-mono text-slate-200">{owner.port}</td>
                      <td className="truncate px-4 py-2 text-slate-300" title={owner.command}>
                        {owner.command}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">{owner.pid}</td>
                      <td className="truncate px-4 py-2 text-xs">
                        {owner.projectId ? (
                          <ProjectCell owner={owner} entry={projectsById.get(owner.projectId)} />
                        ) : owner.cwd ? (
                          <span className="font-mono text-slate-500" title={owner.cwd}>
                            {shortPath(owner.cwd)}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {section.canKill ? (
                          <button
                            type="button"
                            onClick={() => onKill(owner.port)}
                            className="rounded-lg bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-500/25"
                          >
                            Liberar
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-600">
                            {section.category === 'protected' ? 'protegido' : 'no tocar'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Nombre del proyecto y cómo está corriendo: por Capitanía, por fuera o fuera de su puerto. */
function ProjectCell({ owner, entry }: { owner: PortOwner; entry: ProjectEntry | undefined }) {
  if (!entry) return <span className="text-slate-500">{owner.projectId}</span>;
  const managed = isUp(entry.state.status);
  const wrongPort = entry.config.port !== null && entry.config.port !== owner.port;

  return (
    <span className="text-slate-300">
      {entry.config.name}
      {wrongPort ? (
        <span className="ml-1.5 text-amber-300">• fuera de su puerto (espera :{entry.config.port})</span>
      ) : managed ? (
        <span className="ml-1.5 text-emerald-400">• Capitanía</span>
      ) : (
        <span className="ml-1.5 text-slate-500">• por fuera</span>
      )}
    </span>
  );
}
