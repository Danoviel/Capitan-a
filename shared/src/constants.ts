/**
 * Valores que el servidor y el dashboard deben compartir. Esta capa no importa
 * nada de Node ni del navegador: la usan los dos lados tal cual.
 */

/** Tecnologías soportadas. De aquí salen el tipo `ProjectKind` y el enum de zod. */
export const PROJECT_KINDS = ['django', 'vite', 'next', 'angular', 'node', 'custom'] as const;

export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const BACKEND_KINDS: readonly ProjectKind[] = ['django', 'node'];
export const FRONTEND_KINDS: readonly ProjectKind[] = ['vite', 'next', 'angular'];

/** Id de un proyecto: va en URLs, así que solo minúsculas, números y guiones. */
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Puerto del servidor de Capitanía (API + dashboard compilado). */
export const DEFAULT_SERVER_PORT = 7788;
/** Puerto del dashboard en `npm run dev`, que proxea al servidor. */
export const DEV_DASHBOARD_PORT = 5190;

export const SERVICE_ACTIONS = ['start', 'stop', 'restart'] as const;

export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

export function isServiceAction(value: string): value is ServiceAction {
  return (SERVICE_ACTIONS as readonly string[]).includes(value);
}
