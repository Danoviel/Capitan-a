import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  MAX_PORT,
  MIN_PORT,
  PROJECT_ID_PATTERN,
  PROJECT_KINDS,
  type ProjectConfig,
} from '@puertosview/shared';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(here, '../../..');

/**
 * `projects.local.json` gana si existe (config personal, ignorada por git);
 * si no, se usa `projects.json`.
 */
export function resolveConfigPath(): string {
  const local = resolve(ROOT_DIR, 'projects.local.json');
  return existsSync(local) ? local : resolve(ROOT_DIR, 'projects.json');
}

const linkSchema = z.object({
  label: z.string().min(1),
  path: z.string().regex(/^\//, 'La ruta del enlace debe empezar con /'),
});

/** Esquema único de un proyecto: lo usan la carga del archivo y la API. */
export const projectSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(PROJECT_ID_PATTERN, 'El id solo admite minúsculas, números y guiones'),
  name: z.string().min(1),
  group: z.string().min(1),
  kind: z.enum(PROJECT_KINDS),
  cwd: z.string().min(1),
  command: z.string().min(1),
  port: z.number().int().min(MIN_PORT).max(MAX_PORT).nullable(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().nullable().optional(),
  links: z.array(linkSchema).optional(),
  notes: z.string().optional(),
});

const fileSchema = z.object({
  /** Puertos que el botón "liberar puerto" se niega a tocar. */
  protectedPorts: z.array(z.number().int()).default([]),
  projects: z.array(projectSchema),
});

export type ProjectsFile = z.infer<typeof fileSchema>;

/**
 * Valida invariantes que zod no cubre. Deliberadamente NO expande `~` en `cwd`:
 * la config en memoria debe ser un espejo exacto del archivo, porque `save()`
 * la vuelca de vuelta a disco. La expansión ocurre al lanzar el proceso.
 */
function normalize(file: ProjectsFile): ProjectsFile {
  const seen = new Set<string>();
  for (const project of file.projects) {
    if (seen.has(project.id)) {
      throw new Error(`El id "${project.id}" está repetido en la configuración`);
    }
    seen.add(project.id);
  }
  return file;
}

/**
 * Fuente única de verdad de la configuración. Mantiene la última versión válida
 * en memoria para que el dashboard no dependa del disco en cada request.
 */
export class ProjectRepository {
  #path: string;
  #cache: ProjectsFile = { protectedPorts: [], projects: [] };

  constructor(path = resolveConfigPath()) {
    this.#path = path;
  }

  get path(): string {
    return this.#path;
  }

  async load(): Promise<ProjectsFile> {
    const raw = await readFile(this.#path, 'utf8');
    const parsed = fileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(`Configuración inválida en ${this.#path} -> ${detail}`);
    }
    this.#cache = normalize(parsed.data);
    return this.#cache;
  }

  all(): ProjectConfig[] {
    return this.#cache.projects;
  }

  protectedPorts(): number[] {
    return this.#cache.protectedPorts;
  }

  find(id: string): ProjectConfig | undefined {
    return this.#cache.projects.find((project) => project.id === id);
  }

  /** Escritura atómica: se escribe un temporal y se renombra encima. */
  async save(file: ProjectsFile): Promise<ProjectsFile> {
    const validated = fileSchema.parse(file);
    const tmp = `${this.#path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    await rename(tmp, this.#path);
    this.#cache = normalize(validated);
    return this.#cache;
  }

  async upsert(project: ProjectConfig): Promise<ProjectsFile> {
    const projects = [...this.#cache.projects];
    const index = projects.findIndex((candidate) => candidate.id === project.id);
    if (index >= 0) projects[index] = project;
    else projects.push(project);
    return this.save({ ...this.#cache, projects });
  }

  async remove(id: string): Promise<ProjectsFile> {
    const projects = this.#cache.projects.filter((project) => project.id !== id);
    return this.save({ ...this.#cache, projects });
  }
}
