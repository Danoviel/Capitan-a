import type {
  BatchResult,
  BrewServiceInfo,
  DockerContainerInfo,
  FolderInfo,
  LogLine,
  ProjectConfig,
  ProjectDiagnosis,
  ProjectState,
  ServiceAction,
  Snapshot,
} from '@puertosview/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Error ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

const post = <T>(path: string, payload?: unknown) =>
  request<T>(path, { method: 'POST', body: payload ? JSON.stringify(payload) : undefined });

const put = <T>(path: string, payload: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(payload) });

const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export const api = {
  state: () => request<Snapshot>('/state'),
  reloadConfig: () => post<Snapshot>('/config/reload'),
  inspectFolder: (path: string) =>
    request<FolderInfo>(`/folder?path=${encodeURIComponent(path)}`),
  diagnostics: () => request<{ projects: ProjectDiagnosis[] }>('/diagnostics'),

  start: (id: string) => post<ProjectState>(`/projects/${id}/start`),
  stop: (id: string) => post<ProjectState>(`/projects/${id}/stop`),
  restart: (id: string) => post<ProjectState>(`/projects/${id}/restart`),
  logs: (id: string) => request<{ lines: LogLine[] }>(`/projects/${id}/logs`),

  startMany: (ids: string[]) => post<{ results: BatchResult[] }>('/projects/batch/start', { ids }),
  stopMany: (ids: string[]) => post<{ results: BatchResult[] }>('/projects/batch/stop', { ids }),

  // El servidor persiste en projects.json y avisa por WebSocket con
  // `config-changed`, así que la UI no necesita recargar a mano.
  createProject: (config: ProjectConfig) => post<Snapshot>('/projects', config),
  updateProject: (config: ProjectConfig) => put<Snapshot>(`/projects/${config.id}`, config),
  deleteProject: (id: string) => del<Snapshot>(`/projects/${id}`),

  killPort: (port: number, force = false) =>
    post<{ killed: number[] }>(`/ports/${port}/kill`, { force }),

  services: () => request<{ brew: BrewServiceInfo[]; docker: DockerContainerInfo[] }>('/services'),
  controlService: (manager: 'brew' | 'docker', name: string, action: ServiceAction) =>
    post<{ brew: BrewServiceInfo[]; docker: DockerContainerInfo[] }>(
      `/services/${manager}/${encodeURIComponent(name)}/${action}`,
    ),
};
