import type {
  CatalogTree,
  ErrorResponse,
  ProjectResponse,
  ScanDetailResponse,
  ScanResultResponse,
  WorkspaceResponse,
} from '../http/contract.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
  } catch {
    throw new ApiError('Network error: the server could not be reached.', 0);
  }
  // Non-JSON bodies (proxy error pages, empty 5xx) must not crash the UI.
  const text = await response.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const error = data as Partial<ErrorResponse> | undefined;
    throw new ApiError(error?.error ?? `Request failed (${response.status}).`, response.status, error?.details ?? []);
  }
  return data as T;
}

export const api = {
  workspace: () => request<WorkspaceResponse>('/api/workspace'),
  project: (id: number) => request<ProjectResponse>(`/api/projects/${id}`),
  scanDetail: (id: number, scanId: number) => request<ScanDetailResponse>(`/api/projects/${id}/scans/${scanId}`),
  scan: (id: number) => request<ScanResultResponse>(`/api/projects/${id}/scan`, { method: 'POST' }),
  saveCatalog: (id: number, locale: string, strings: CatalogTree) =>
    request<ScanResultResponse>(`/api/projects/${id}/catalogs/${encodeURIComponent(locale)}`, {
      method: 'PUT',
      body: JSON.stringify({ strings }),
    }),
};
