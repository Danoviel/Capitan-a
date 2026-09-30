import { useEffect, useId, useMemo, useState } from 'react';
import { api } from '../api/client.ts';
import { useEscape } from '../hooks/useEscape.ts';
import { portStatus, suggestPorts, syncCommandPort, type PortContext } from '../lib/portAdvisor.ts';
import {
  MAX_PORT,
  MIN_PORT,
  PROJECT_ID_PATTERN,
  PROJECT_KINDS,
  isValidPort,
  type FolderInfo,
  type PortOwner,
  type ProjectConfig,
  type ProjectKind,
  type ProjectLink,
} from '@capitania/shared';

/**
 * Estado del formulario. Todo se maneja como texto porque los `<input>` lo son:
 * la conversión a `ProjectConfig` (puerto numérico, env como objeto) ocurre solo
 * al guardar, en `toConfig`.
 */
interface FormValues {
  id: string;
  name: string;
  group: string;
  kind: ProjectKind;
  cwd: string;
  command: string;
  port: string;
  url: string;
  links: string;
  notes: string;
  env: string;
}

const EMPTY: FormValues = {
  id: '',
  name: '',
  group: '',
  kind: 'django',
  cwd: '',
  command: '',
  port: '',
  url: '',
  links: '',
  notes: '',
  env: '',
};

function toForm(config: ProjectConfig): FormValues {
  return {
    id: config.id,
    name: config.name,
    group: config.group,
    kind: config.kind,
    cwd: config.cwd,
    command: config.command,
    port: config.port === null ? '' : String(config.port),
    url: config.url ?? '',
    links: (config.links ?? []).map((link) => `${link.label} ${link.path}`).join('\n'),
    notes: config.notes ?? '',
    env: Object.entries(config.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  };
}

/** Texto del campo puerto → número, o null si está vacío o no es un puerto válido. */
function parsePort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const port = Number(trimmed);
  return isValidPort(port) ? port : null;
}

/** `KEY=valor` por línea → objeto. Ignora líneas vacías y comentarios. */
function parseEnv(raw: string): Record<string, string> | undefined {
  const entries: [string, string][] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    entries.push([trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim()]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** `Admin /admin/` por línea → enlace. La ruta es la última palabra de la línea. */
function parseLinks(raw: string): ProjectLink[] | undefined {
  const links: ProjectLink[] = [];
  for (const line of raw.split('\n')) {
    const match = line.trim().match(/^(.+?)\s+(\/\S*)$/);
    if (match) links.push({ label: match[1] as string, path: match[2] as string });
  }
  return links.length > 0 ? links : undefined;
}

function validate(values: FormValues, takenIds: Set<string>): Partial<Record<keyof FormValues, string>> {
  const errors: Partial<Record<keyof FormValues, string>> = {};

  if (!PROJECT_ID_PATTERN.test(values.id)) {
    errors.id = 'Solo minúsculas, números y guiones. Debe empezar con letra o número.';
  } else if (takenIds.has(values.id)) {
    errors.id = 'Ya existe un proyecto con este id.';
  }
  if (!values.name.trim()) errors.name = 'Requerido.';
  if (!values.group.trim()) errors.group = 'Requerido.';
  if (!values.cwd.trim()) errors.cwd = 'Requerido.';
  if (!values.command.trim()) errors.command = 'Requerido.';

  if (values.port.trim() && parsePort(values.port) === null) {
    errors.port = `Debe ser un entero entre ${MIN_PORT} y ${MAX_PORT}, o vacío si no expone puerto.`;
  }

  for (const line of values.env.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.indexOf('=') <= 0) {
      errors.env = `Línea inválida: "${trimmed}". Se espera CLAVE=valor.`;
      break;
    }
  }

  for (const line of values.links.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !/^.+?\s+\/\S*$/.test(trimmed)) {
      errors.links = `Línea inválida: "${trimmed}". Se espera: Nombre /ruta`;
      break;
    }
  }

  return errors;
}

function toConfig(values: FormValues): ProjectConfig {
  return {
    id: values.id.trim(),
    name: values.name.trim(),
    group: values.group.trim(),
    kind: values.kind,
    cwd: values.cwd.trim(),
    command: values.command.trim(),
    port: parsePort(values.port),
    ...(values.url.trim() ? { url: values.url.trim() } : {}),
    ...(parseLinks(values.links) ? { links: parseLinks(values.links) } : {}),
    ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
    ...(parseEnv(values.env) ? { env: parseEnv(values.env) } : {}),
  };
}

interface Props {
  /** `null` = alta de un proyecto nuevo. */
  project: ProjectConfig | null;
  /** Ids ya usados, para no chocar al crear. */
  existingIds: string[];
  /** Grupos ya existentes, ofrecidos como autocompletado. */
  existingGroups: string[];
  /** Si el proyecto está corriendo el servidor rechaza el borrado (409). */
  canDelete: boolean;
  /** Para sugerir puertos libres y avisar de choques. */
  allProjects: ProjectConfig[];
  ports: PortOwner[];
  protectedPorts: number[];
  onSave: (config: ProjectConfig) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

export function ProjectFormDialog({
  project,
  existingIds,
  existingGroups,
  canDelete,
  allProjects,
  ports,
  protectedPorts,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const isEdit = project !== null;
  const [values, setValues] = useState<FormValues>(() => (project ? toForm(project) : EMPTY));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const formId = useId();

  // Al editar, el id viaja en la URL y el servidor lo impone: no se puede
  // renombrar, así que tampoco se valida contra la lista de ids ocupados.
  const takenIds = useMemo(
    () => new Set(isEdit ? [] : existingIds),
    [isEdit, existingIds],
  );
  const errors = validate(values, takenIds);
  const hasErrors = Object.keys(errors).length > 0;

  useEscape(onClose);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  // --- Puerto: sugerencias, choques y comando sincronizado -------------------
  const portContext: PortContext = {
    selfId: project?.id ?? null,
    projects: allProjects,
    ports,
    protectedPorts,
  };
  const portNumber = parsePort(values.port);
  const suggestions = suggestPorts(values.kind, portContext, portNumber);
  const conflict = portNumber !== null ? portStatus(portNumber, portContext) : null;
  /** El puerto que el comando tiene escrito ahora mismo. */
  const [commandPort, setCommandPort] = useState<number | null>(project?.port ?? null);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  /** Al confirmar un puerto nuevo, el comando lo sigue si tenía el anterior escrito. */
  const commitPort = (raw: string) => {
    const next = parsePort(raw);
    if (next === null || next === commandPort) return;
    if (commandPort !== null) {
      const synced = syncCommandPort(values.command, commandPort, next);
      if (synced) {
        set('command', synced);
        setSyncNote(`El comando también se actualizó de :${commandPort} a :${next}.`);
      } else {
        setSyncNote(`Ojo: el comando no tiene el puerto escrito. Revisa que arranque en :${next}.`);
      }
    }
    setCommandPort(next);
  };

  // --- Carpeta: ¿existe y qué tipo de proyecto parece? -----------------------
  const [folder, setFolder] = useState<FolderInfo | null>(null);
  useEffect(() => {
    const path = values.cwd.trim();
    if (!path) {
      setFolder(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .inspectFolder(path)
        .then((info) => {
          if (!cancelled) setFolder(info);
        })
        .catch(() => {
          if (!cancelled) setFolder(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [values.cwd]);

  const submit = async () => {
    setSubmitted(true);
    if (hasErrors) return;
    setSaving(true);
    try {
      await onSave(toConfig(values));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!project) return;
    if (!window.confirm(`¿Eliminar "${project.name}" de projects.json? El proyecto en disco no se toca.`))
      return;
    setSaving(true);
    try {
      await onDelete();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-950/70 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${formId}-title`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 id={`${formId}-title`} className="text-sm font-semibold text-slate-100">
            {isEdit ? `Editar: ${project.name}` : 'Nuevo proyecto'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          >
            Cerrar
          </button>
        </header>

        <form
          className="space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Id"
              hint={isEdit ? 'No se puede cambiar' : 'tienda-be, blog-fe...'}
              error={submitted ? errors.id : undefined}
            >
              <input
                value={values.id}
                onChange={(event) => set('id', event.target.value)}
                readOnly={isEdit}
                placeholder="mi-proyecto-be"
                className={`${INPUT} ${isEdit ? 'cursor-not-allowed text-slate-500' : ''}`}
              />
            </Field>

            <Field label="Nombre" error={submitted ? errors.name : undefined}>
              <input
                value={values.name}
                onChange={(event) => set('name', event.target.value)}
                placeholder="Mi Proyecto BE"
                className={INPUT}
              />
            </Field>

            <Field
              label="Grupo"
              hint="Agrupa las tarjetas en el panel"
              error={submitted ? errors.group : undefined}
            >
              <input
                value={values.group}
                onChange={(event) => set('group', event.target.value)}
                placeholder="Mi Tienda"
                list={`${formId}-groups`}
                className={INPUT}
              />
            </Field>

            <Field label="Tipo">
              <select
                value={values.kind}
                onChange={(event) => set('kind', event.target.value as ProjectKind)}
                className={INPUT}
              >
                {PROJECT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Carpeta (cwd)"
            hint="Dónde se ejecuta el comando. Cambiarla aquí no mueve nada en disco"
            error={submitted ? errors.cwd : undefined}
          >
            <input
              value={values.cwd}
              onChange={(event) => set('cwd', event.target.value)}
              placeholder="~/Proyectos/mi-tienda/backend"
              className={`${INPUT} font-mono text-[11px]`}
            />
          </Field>
          {folder && (
            <p className={`-mt-2 text-[11px] ${folder.exists ? 'text-emerald-400' : 'text-rose-300'}`}>
              {folder.exists ? '✓ La carpeta existe' : '✕ No existe esa carpeta en tu Mac'}
              {folder.detectedKind && (
                <span className="text-slate-400">
                  {' '}· parece un proyecto <b className="text-slate-200">{folder.detectedKind}</b>
                  {folder.detectedKind !== values.kind && (
                    <button
                      type="button"
                      onClick={() => set('kind', folder.detectedKind as ProjectKind)}
                      className="ml-2 rounded bg-slate-800 px-1.5 py-px text-sky-300 hover:bg-slate-700"
                    >
                      usar {folder.detectedKind} como tipo
                    </button>
                  )}
                </span>
              )}
            </p>
          )}

          <Field
            label="Comando"
            hint="Se ejecuta en un shell de login, igual que en la terminal"
            error={submitted ? errors.command : undefined}
          >
            <textarea
              value={values.command}
              onChange={(event) => set('command', event.target.value)}
              rows={2}
              placeholder="source .venv/bin/activate && python manage.py runserver 127.0.0.1:8002"
              className={`${INPUT} resize-y font-mono text-[11px]`}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Puerto"
              hint="Vacío si no expone puerto"
              error={submitted ? errors.port : undefined}
            >
              <input
                value={values.port}
                onChange={(event) => set('port', event.target.value)}
                onBlur={(event) => commitPort(event.target.value)}
                inputMode="numeric"
                placeholder="8002"
                className={`${INPUT} font-mono`}
              />
              {conflict && conflict.kind !== 'free' && (
                <span className="mt-1 block text-[11px] text-amber-300">
                  {conflict.kind === 'reserved' && `Ya está reservado para ${conflict.by}.`}
                  {conflict.kind === 'in-use' && `Ahora mismo lo está usando ${conflict.by}.`}
                  {conflict.kind === 'protected' && 'Es un puerto protegido (BD, Redis, Capitanía...).'}
                </span>
              )}
              {conflict?.kind === 'free' && (
                <span className="mt-1 block text-[11px] text-emerald-400">✓ Libre</span>
              )}
              {suggestions.length > 0 && (
                <span className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                  Libres para {values.kind}:
                  {suggestions.map((port) => (
                    <button
                      key={port}
                      type="button"
                      onClick={() => {
                        set('port', String(port));
                        commitPort(String(port));
                      }}
                      className="rounded bg-slate-800 px-1.5 py-px font-mono text-slate-300 hover:bg-slate-700"
                    >
                      {port}
                    </button>
                  ))}
                </span>
              )}
              {syncNote && <span className="mt-1 block text-[11px] text-sky-300">{syncNote}</span>}
            </Field>

            <Field label="URL" hint="Opcional; por defecto localhost:puerto">
              <input
                value={values.url}
                onChange={(event) => set('url', event.target.value)}
                placeholder="http://localhost:8002/admin"
                className={`${INPUT} font-mono text-[11px]`}
              />
            </Field>
          </div>

          <Field
            label="Enlaces"
            hint="Uno por línea: Nombre /ruta"
            error={submitted ? errors.links : undefined}
          >
            <textarea
              value={values.links}
              onChange={(event) => set('links', event.target.value)}
              rows={2}
              placeholder={'Admin /admin/\nHealth /health/'}
              className={`${INPUT} resize-y font-mono text-[11px]`}
            />
          </Field>

          <Field label="Notas" hint="Aviso visible en la tarjeta">
            <textarea
              value={values.notes}
              onChange={(event) => set('notes', event.target.value)}
              rows={2}
              placeholder="Necesita Postgres corriendo (:5432)."
              className={`${INPUT} resize-y`}
            />
          </Field>

          <Field
            label="Variables de entorno"
            hint="Una por línea: CLAVE=valor"
            error={submitted ? errors.env : undefined}
          >
            <textarea
              value={values.env}
              onChange={(event) => set('env', event.target.value)}
              rows={3}
              placeholder={'DJANGO_SETTINGS_MODULE=config.settings.local\nDEBUG=1'}
              className={`${INPUT} resize-y font-mono text-[11px]`}
            />
          </Field>

          {submitted && hasErrors && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              Revisa los campos marcados antes de guardar.
            </p>
          )}

          <footer className="flex items-center gap-2 border-t border-slate-800 pt-4">
            {isEdit && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={saving || !canDelete}
                title={canDelete ? undefined : 'Apaga el proyecto antes de eliminarlo'}
                className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/25 disabled:opacity-40"
              >
                Eliminar
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40"
              >
                {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear proyecto'}
              </button>
            </div>
          </footer>
        </form>

        <datalist id={`${formId}-groups`}>
          {existingGroups.map((group) => (
            <option key={group} value={group} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

const INPUT =
  'w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none';

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-2">
        <span className="text-[11px] font-medium text-slate-300">{label}</span>
        {hint && <span className="text-[10px] text-slate-600">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-[10px] text-rose-300">{error}</span>}
    </label>
  );
}
