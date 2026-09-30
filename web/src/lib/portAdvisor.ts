import {
  DEFAULT_SERVER_PORT,
  DEV_DASHBOARD_PORT,
  type PortOwner,
  type ProjectConfig,
  type ProjectKind,
} from '@capitania/shared';

/** Rango habitual de cada tipo: así los BE quedan en 80xx, los Vite en 51xx, etc. */
const RANGES: Record<ProjectKind, [number, number]> = {
  django: [8001, 8099],
  node: [8001, 8099],
  vite: [5173, 5199],
  next: [3000, 3099],
  angular: [4200, 4299],
  custom: [9000, 9099],
};

/** Puertos del propio Capitanía (API y dashboard en modo dev). */
const RESERVED_BY_CAPITANIA = [DEFAULT_SERVER_PORT, DEV_DASHBOARD_PORT];

export interface PortContext {
  /** Proyecto que se está editando (sus propios puertos no cuentan como ocupados). */
  selfId: string | null;
  projects: ProjectConfig[];
  ports: PortOwner[];
  protectedPorts: number[];
}

export type PortStatus =
  | { kind: 'free' }
  | { kind: 'reserved'; by: string }
  | { kind: 'in-use'; by: string }
  | { kind: 'protected' };

/** ¿Está libre este puerto? Si no, quién lo tiene. */
export function portStatus(port: number, ctx: PortContext): PortStatus {
  if (ctx.protectedPorts.includes(port) || RESERVED_BY_CAPITANIA.includes(port)) {
    return { kind: 'protected' };
  }
  const reserved = ctx.projects.find((p) => p.port === port && p.id !== ctx.selfId);
  if (reserved) return { kind: 'reserved', by: reserved.name };

  const live = ctx.ports.find((owner) => owner.port === port && owner.projectId !== ctx.selfId);
  if (live) {
    const project = ctx.projects.find((p) => p.id === live.projectId);
    return { kind: 'in-use', by: project?.name ?? live.command };
  }
  return { kind: 'free' };
}

/** Los primeros puertos libres del rango de ese tipo, sin repetir el que ya tiene. */
export function suggestPorts(
  kind: ProjectKind,
  ctx: PortContext,
  current: number | null,
  count = 4,
): number[] {
  const [from, to] = RANGES[kind];
  const free: number[] = [];
  for (let port = from; port <= to && free.length < count; port += 1) {
    if (port !== current && portStatus(port, ctx).kind === 'free') free.push(port);
  }
  return free;
}

/**
 * Si el comando tiene el puerto viejo escrito, lo cambia por el nuevo. Evita
 * el error de cambiar el puerto en el formulario y que el proyecto siga
 * arrancando en el anterior.
 */
export function syncCommandPort(command: string, oldPort: number, newPort: number): string | null {
  const pattern = new RegExp(`\\b${oldPort}\\b`, 'g');
  return pattern.test(command) ? command.replace(pattern, String(newPort)) : null;
}
