import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FolderInfo, ProjectKind } from '@capitania/shared';
import { realPath } from '../shared/paths.ts';

/** El primer archivo que aparece decide el tipo: el orden importa (un Next también tiene package.json). */
const MARKERS: Array<[ProjectKind, string[]]> = [
  ['django', ['manage.py']],
  ['angular', ['angular.json']],
  ['next', ['next.config.ts', 'next.config.js', 'next.config.mjs']],
  ['vite', ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts']],
  ['node', ['package.json']],
];

/**
 * Revisa la carpeta de un proyecto mientras se edita el formulario: que exista
 * y qué tipo de proyecto parece. Solo comprueba si existen unos pocos archivos
 * conocidos; no lee ni modifica nada.
 */
export function inspectFolder(path: string): FolderInfo {
  const dir = realPath(path);
  let exists = false;
  try {
    exists = statSync(dir).isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) return { exists: false, detectedKind: null };

  const match = MARKERS.find(([, files]) => files.some((file) => existsSync(join(dir, file))));
  return { exists: true, detectedKind: match?.[0] ?? null };
}
