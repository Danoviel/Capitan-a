import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * `~/foo` -> `/Users/<usuario>/foo`.
 *
 * Se aplica en el punto de uso (al lanzar el proceso), nunca sobre la config en
 * memoria: si se expandiera al cargar, cualquier escritura de `projects.json`
 * reescribiría los paths de todos los proyectos con rutas absolutas y el archivo
 * dejaría de ser legible y portable.
 */
export function expandHome(path: string): string {
  return path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path;
}

/** Ruta real (con `~` expandido y sin symlinks), comparable con la que reporta lsof. */
export function realPath(path: string): string {
  const expanded = expandHome(path);
  try {
    return realpathSync(expanded);
  } catch {
    return expanded;
  }
}
