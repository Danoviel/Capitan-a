/**
 * Tipos del dominio y forma de las respuestas de la API. Esta capa no conoce
 * Express, WebSockets ni el sistema de archivos: solo describe qué es un
 * proyecto y en qué estado puede estar.
 */

import type { ProjectKind } from './constants.ts';

export interface ProjectConfig {
  /** Identificador estable y único. Se usa en URLs y en el WebSocket. */
  id: string;
  name: string;
  /** Agrupador visual: normalmente el producto (Altoke, Domo, Ginebra...). */
  group: string;
  kind: ProjectKind;
  /** Ruta absoluta desde donde se ejecuta el comando. */
  cwd: string;
  /** Comando de arranque, tal cual lo escribirías en la terminal. */
  command: string;
  /** Puerto que este proyecto debería ocupar. null = no expone puerto. */
  port: number | null;
  /** Variables extra para el proceso hijo. */
  env?: Record<string, string>;
  /** URL que abre el botón "Abrir". Si se omite se infiere del puerto. */
  url?: string | null;
  /**
   * Accesos directos (admin, health, login...). Se guarda la ruta, no la URL
   * completa, para que sigan funcionando si cambia el puerto.
   */
  links?: ProjectLink[];
  /** Nota libre visible en la UI (avisos, dependencias, credenciales de seed). */
  notes?: string;
}

export interface ProjectLink {
  label: string;
  /** Ruta relativa a la URL del proyecto, empieza con `/`: `/admin/`. */
  path: string;
}

export type ProjectStatus =
  /** Apagado y sin nadie ocupando su puerto. */
  | 'stopped'
  /** Lanzado por PuertosView, esperando a que el puerto responda. */
  | 'starting'
  /** Lanzado por PuertosView y vivo. */
  | 'running'
  /** Se pidió apagarlo, esperando que muera el árbol de procesos. */
  | 'stopping'
  /** Lanzado por PuertosView pero terminó con código != 0. */
  | 'crashed'
  /** El puerto está ocupado por un proceso que PuertosView no lanzó. */
  | 'external';

/** Proceso que tiene un puerto en LISTEN, según lsof. */
export interface ListeningProcess {
  port: number;
  pid: number;
  command: string;
  address: string;
  /** Carpeta de trabajo del proceso: dice a qué proyecto pertenece de verdad. */
  cwd: string | null;
}

/**
 * Para qué se usa un puerto ocupado:
 * - `project`: un proyecto registrado (identificado por su carpeta, no por el número).
 * - `dev`: algo de desarrollo en tu carpeta personal que no está registrado.
 * - `protected`: infraestructura listada en `protectedPorts` (BD, Redis, Docker...).
 * - `app`: apps de escritorio y procesos del sistema. No se liberan desde el panel.
 */
export type PortCategory = 'project' | 'dev' | 'protected' | 'app';

export interface PortOwner extends ListeningProcess {
  projectId: string | null;
  category: PortCategory;
}

export interface ProjectState {
  id: string;
  status: ProjectStatus;
  /** PID del líder del grupo de procesos, o null si no lo lanzamos nosotros. */
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  exitCode: number | null;
  exitSignal: string | null;
  /** Quién ocupa el puerto ahora mismo (nuestro o ajeno). */
  portOwner: PortOwner | null;
  /** Último error de arranque legible (comando inválido, cwd inexistente...). */
  lastError: string | null;
}

export type LogStream = 'stdout' | 'stderr' | 'system';

export interface LogLine {
  seq: number;
  projectId: string;
  stream: LogStream;
  text: string;
  at: string;
}

/** Servicio de fondo gestionado por Homebrew (postgres, redis...). */
export interface BrewServiceInfo {
  name: string;
  status: string;
  running: boolean;
  user: string | null;
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  running: boolean;
  ports: string;
}

/** Gravedad de una revisión. El nivel de un proyecto es el peor de sus revisiones. */
export type DiagnosisLevel = 'ok' | 'warn' | 'error';

export interface DiagnosisCheck {
  level: DiagnosisLevel;
  message: string;
}

/** Qué tan bien está enganchado un proyecto con PuertosView (config + realidad). */
export interface ProjectDiagnosis {
  id: string;
  level: DiagnosisLevel;
  checks: DiagnosisCheck[];
}

/** Eventos que el servidor empuja al dashboard por WebSocket. */
export type ServerEvent =
  | { type: 'snapshot'; projects: ProjectState[]; ports: PortOwner[] }
  | { type: 'project-state'; state: ProjectState }
  | { type: 'log'; line: LogLine }
  | { type: 'config-changed' };

export interface ProjectEntry {
  config: ProjectConfig;
  state: ProjectState;
}

/** Respuesta de `GET /api/state`: la config y el estado de todo, de una vez. */
export interface Snapshot {
  configPath: string;
  projects: ProjectEntry[];
  ports: PortOwner[];
  protectedPorts: number[];
}

/** Respuesta de `GET /api/folder`: si la carpeta existe y qué tipo de proyecto parece. */
export interface FolderInfo {
  exists: boolean;
  /** Tipo deducido de sus archivos, o null si no se reconoce. */
  detectedKind: ProjectKind | null;
}

/** Resultado por proyecto al encender o apagar varios a la vez. */
export interface BatchResult {
  id: string;
  ok: boolean;
  error?: string;
}
