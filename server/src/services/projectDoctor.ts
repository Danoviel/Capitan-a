import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { realPath } from '../shared/paths.ts';
import {
  BACKEND_KINDS,
  FRONTEND_KINDS,
  type DiagnosisCheck,
  type DiagnosisLevel,
  type PortOwner,
  type ProjectConfig,
  type ProjectDiagnosis,
  type ProjectState,
} from '@puertosview/shared';

/** Orden de carga de Vite y Next: cada archivo pisa las claves del anterior. */
const ENV_FILES = ['.env', '.env.development', '.env.local', '.env.development.local'];
const BUNDLER_CONFIGS = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.mts',
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
];
/** Variables que el navegador lee: si apuntan al BE, el FE lo llama directo y el CORS importa. */
const BROWSER_ENV_PREFIXES = ['VITE_', 'NEXT_PUBLIC_'];
const LOCAL_URL = /(?:localhost|127\.0\.0\.1):(\d{2,5})/g;
const PACKAGE_SCRIPT = /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?([\w:.-]+)/;
const PACKAGE_BUILTINS = new Set(['install', 'i', 'ci', 'exec', 'add', 'dlx', 'x']);

const SEVERITY: Record<DiagnosisLevel, number> = { ok: 0, warn: 1, error: 2 };

export interface DoctorInput {
  configs: ProjectConfig[];
  states: ProjectState[];
  ports: PortOwner[];
  protectedPorts: number[];
}

/** Referencias a puertos locales encontradas en los archivos de un FE. */
interface FrontendRefs {
  /** puerto → archivos donde aparece */
  ports: Map<number, Set<string>>;
  /** true si alguna variable del navegador (VITE_*, NEXT_PUBLIC_*) apunta a localhost */
  callsBackendFromBrowser: boolean;
}

/**
 * Revisa si cada proyecto está realmente enganchado con PuertosView: que el
 * comando fije el puerto, que el FE apunte al puerto de su BE, que el CORS lo
 * acepte, y que nadie más esté usando su puerto.
 *
 * Solo lee archivos: nunca modifica los proyectos.
 */
export class ProjectDoctor {
  diagnose(input: DoctorInput): ProjectDiagnosis[] {
    const { configs } = input;
    const byPort = new Map(
      configs.filter((c) => c.port !== null).map((c) => [c.port as number, c] as const),
    );
    const byId = new Map(configs.map((c) => [c.id, c] as const));
    // Qué proyecto registrado está escuchando cada puerto ahora mismo.
    const liveByPort = new Map<number, ProjectConfig>();
    for (const owner of input.ports) {
      const project = owner.projectId ? byId.get(owner.projectId) : undefined;
      if (project) liveByPort.set(owner.port, project);
    }
    const refsById = new Map(
      configs
        .filter((c) => FRONTEND_KINDS.includes(c.kind))
        .map((c) => [c.id, readFrontendRefs(realPath(c.cwd), c.port, input.protectedPorts)] as const),
    );

    return configs.map((config) => {
      const cwd = realPath(config.cwd);
      if (!existsSync(cwd)) {
        return summarize(config.id, [
          { level: 'error', message: `La carpeta no existe: ${config.cwd}` },
        ]);
      }

      const checks = [
        ...checkLaunch(config, cwd),
        ...checkFrontendTarget(config, configs, byPort, liveByPort, refsById.get(config.id)),
        ...checkCors(config, configs, cwd, refsById),
        ...checkRuntime(config, input, byId),
      ];
      return summarize(config.id, checks);
    });
  }
}

// --- Arranque: ¿el comando existe y fija el puerto? --------------------------

function checkLaunch(config: ProjectConfig, cwd: string): DiagnosisCheck[] {
  const checks: DiagnosisCheck[] = [];
  const scriptName = config.command.match(PACKAGE_SCRIPT)?.[1];
  let scriptBody = '';

  if (scriptName && !PACKAGE_BUILTINS.has(scriptName)) {
    const scripts = readPackageScripts(cwd);
    if (scripts && !(scriptName in scripts)) {
      const available = Object.keys(scripts).join(', ') || 'ninguno';
      checks.push({
        level: 'error',
        message: `No arranca: package.json no tiene el script "${scriptName}" (tiene: ${available})`,
      });
      return checks;
    }
    scriptBody = scripts?.[scriptName] ?? '';
  }

  if (config.port === null) return checks;
  const portPattern = new RegExp(`\\b${config.port}\\b`);

  if (portPattern.test(config.command)) {
    checks.push({ level: 'ok', message: `El comando fija el puerto :${config.port}` });
  } else if (portPattern.test(scriptBody)) {
    checks.push({
      level: 'ok',
      message: `El puerto :${config.port} lo fija el script "${scriptName}" del package.json`,
    });
  } else {
    checks.push({
      level: 'warn',
      message: `El comando no fija el puerto :${config.port}: el proyecto usará el de su propia config`,
    });
  }

  // Sin --strictPort, Vite salta en silencio al siguiente puerto si el suyo está ocupado.
  const launch = `${config.command} ${scriptBody}`;
  if (config.kind === 'vite' && !launch.includes('--strictPort')) {
    checks.push({
      level: 'warn',
      message: 'Falta --strictPort: si el puerto está ocupado, Vite se irá a otro sin avisar',
    });
  }
  return checks;
}

// --- FE → BE: ¿el front busca al back en el puerto correcto? ----------------

function checkFrontendTarget(
  config: ProjectConfig,
  configs: ProjectConfig[],
  byPort: Map<number, ProjectConfig>,
  liveByPort: Map<number, ProjectConfig>,
  refs: FrontendRefs | undefined,
): DiagnosisCheck[] {
  const backend = backendOf(config, configs);
  if (!refs || !backend || backend.port === null || refs.ports.size === 0) return [];

  const checks: DiagnosisCheck[] = [];
  for (const [port, files] of refs.ports) {
    const where = [...files].join(', ');
    if (port === backend.port) {
      checks.push({ level: 'ok', message: `Apunta a ${backend.name} en :${port} (${where})` });
      continue;
    }
    // Peor que apuntar a un puerto vacío es apuntar a uno donde responde otro
    // proyecto: el FE funciona "a medias" con datos ajenos y no hay error visible.
    const reserved = byPort.get(port);
    const live = liveByPort.get(port);
    if (reserved && reserved.id !== config.id) {
      checks.push({
        level: 'error',
        message: `Apunta a :${port} (${where}), que es de ${reserved.name}, no de ${backend.name} (:${backend.port})`,
      });
    } else if (live && live.id !== backend.id) {
      checks.push({
        level: 'error',
        message: `Apunta a :${port} (${where}), donde ahora corre ${live.name}, no ${backend.name} (:${backend.port})`,
      });
    } else {
      checks.push({
        level: 'warn',
        message: `Apunta a :${port} (${where}), pero ${backend.name} está en :${backend.port}`,
      });
    }
  }
  return checks;
}

// --- CORS: ¿el BE acepta a los FE que lo llaman directo? ---------------------

function checkCors(
  config: ProjectConfig,
  configs: ProjectConfig[],
  cwd: string,
  refsById: Map<string, FrontendRefs>,
): DiagnosisCheck[] {
  if (!BACKEND_KINDS.includes(config.kind)) return [];
  const allowed = readEnv(cwd).get('CORS_ALLOWED_ORIGINS')?.value;
  // Sin la variable en .env el CORS vive en settings.py: no se adivina.
  if (allowed === undefined) return [];

  const directFrontends = configs.filter(
    (fe) =>
      fe.port !== null &&
      backendOf(fe, configs)?.id === config.id &&
      refsById.get(fe.id)?.callsBackendFromBrowser,
  );
  return directFrontends.map((fe) =>
    new RegExp(`:${fe.port}\\b`).test(allowed)
      ? { level: 'ok', message: `El CORS acepta a ${fe.name} (:${fe.port})` }
      : {
          level: 'warn',
          message: `CORS_ALLOWED_ORIGINS no incluye :${fe.port}: el navegador bloqueará a ${fe.name}`,
        },
  );
}

// --- Realidad: ¿quién está usando el puerto ahora mismo? --------------------

function checkRuntime(
  config: ProjectConfig,
  { states, ports }: DoctorInput,
  byId: Map<string, ProjectConfig>,
): DiagnosisCheck[] {
  const checks: DiagnosisCheck[] = [];
  const state = states.find((candidate) => candidate.id === config.id);

  if (state?.status === 'external' && state.portOwner) {
    const { projectId, cwd: ownerCwd } = state.portOwner;
    const ownerProject = projectId ? byId.get(projectId) : undefined;
    if (projectId === config.id) {
      checks.push({
        level: 'warn',
        message:
          'Está corriendo por fuera (terminal o VSCode): PuertosView no ve sus logs ni puede reiniciarlo limpio',
      });
    } else if (ownerProject) {
      checks.push({
        level: 'error',
        message: `Su puerto :${config.port} lo está usando ${ownerProject.name}: dos proyectos chocan en el mismo puerto`,
      });
    } else {
      checks.push({
        level: 'warn',
        message: `Su puerto :${config.port} lo usa otro programa (${state.portOwner.command}${ownerCwd ? ` en ${tildify(ownerCwd)}` : ''})`,
      });
    }
  }

  // El caso de "dos verdades": el proyecto está vivo, pero en otro puerto.
  const elsewhere = ports.filter(
    (owner) => owner.projectId === config.id && owner.port !== config.port,
  );
  for (const owner of elsewhere) {
    checks.push({
      level: 'warn',
      message: `Está corriendo por fuera en :${owner.port}, pero PuertosView lo espera en :${config.port ?? '(sin puerto)'}`,
    });
  }
  return checks;
}

// --- Utilidades ---------------------------------------------------------------

/** El BE de un FE: el único proyecto backend de su mismo grupo. */
function backendOf(config: ProjectConfig, configs: ProjectConfig[]): ProjectConfig | undefined {
  if (!FRONTEND_KINDS.includes(config.kind)) return undefined;
  const backends = configs.filter(
    (candidate) => candidate.group === config.group && BACKEND_KINDS.includes(candidate.kind),
  );
  return backends.length === 1 ? backends[0] : undefined;
}

function readFrontendRefs(cwd: string, ownPort: number | null, ignored: number[]): FrontendRefs {
  const skip = new Set([...ignored, ...(ownPort === null ? [] : [ownPort])]);
  const ports = new Map<number, Set<string>>();
  const add = (port: number, file: string) => {
    if (skip.has(port)) return;
    const files = ports.get(port) ?? new Set<string>();
    files.add(file);
    ports.set(port, files);
  };

  let callsBackendFromBrowser = false;
  for (const [key, { value, file }] of readEnv(cwd)) {
    const found = [...value.matchAll(LOCAL_URL)].map((match) => Number(match[1]));
    for (const port of found) add(port, file);
    if (found.length > 0 && BROWSER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      callsBackendFromBrowser = true;
    }
  }

  // Proxies y rewrites del bundler (vite.config / next.config), sin comentarios.
  for (const file of BUNDLER_CONFIGS) {
    const content = readText(join(cwd, file));
    if (content === null) continue;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      for (const match of line.matchAll(LOCAL_URL)) add(Number(match[1]), file);
    }
  }

  return { ports, callsBackendFromBrowser };
}

/**
 * Variables de todos los `.env` de la carpeta: gana la del archivo más
 * específico, como en Vite/Next. Se recuerda el archivo para poder citarlo.
 */
function readEnv(cwd: string): Map<string, { value: string; file: string }> {
  const merged = new Map<string, { value: string; file: string }>();
  for (const file of ENV_FILES) {
    for (const [key, value] of readEnvFile(join(cwd, file))) merged.set(key, { value, file });
  }
  return merged;
}

function readEnvFile(path: string): Map<string, string> {
  const vars = new Map<string, string>();
  const content = readText(path);
  if (content === null) return vars;
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)$/);
    if (match) vars.set(match[1] as string, (match[2] as string).trim().replace(/^['"]|['"]$/g, ''));
  }
  return vars;
}

function readPackageScripts(cwd: string): Record<string, string> | null {
  const content = readText(join(cwd, 'package.json'));
  if (content === null) return null;
  try {
    return (JSON.parse(content) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function tildify(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function summarize(id: string, checks: DiagnosisCheck[]): ProjectDiagnosis {
  const level = checks.reduce<DiagnosisLevel>(
    (worst, check) => (SEVERITY[check.level] > SEVERITY[worst] ? check.level : worst),
    'ok',
  );
  return { id, level, checks };
}
