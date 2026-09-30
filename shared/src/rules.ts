/**
 * Reglas pequeñas que el servidor y el dashboard deben interpretar igual.
 */

import type { ProjectStatus } from './types.ts';

export const MIN_PORT = 1;
export const MAX_PORT = 65535;

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/** Encendido por Capitanía o en camino de estarlo. */
export function isUp(status: ProjectStatus): boolean {
  return status === 'running' || status === 'starting';
}

/** Tiene un proceso lanzado por Capitanía, aunque se esté apagando: no se puede eliminar. */
export function hasLiveProcess(status: ProjectStatus): boolean {
  return isUp(status) || status === 'stopping';
}
