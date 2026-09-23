import type { AuthUser, ServerDetail, ServerSummary } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// credentials:'include' — the ops_session cookie is httpOnly and set by
// the API; the dev proxy (vite.config.ts) and the production nginx
// reverse-proxy (nginx.conf) both keep /api same-origin, so this is a
// same-site cookie, not a cross-origin one.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // Non-JSON error body — keep the generic HTTP-status message.
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export function login(username: string, password: string): Promise<AuthUser> {
  return request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}

export function logout(): Promise<void> {
  return request('/api/v1/auth/logout', { method: 'POST' });
}

export function me(): Promise<AuthUser> {
  return request('/api/v1/auth/me');
}

export interface ServersOverviewResponse {
  servers: ServerSummary[];
  heartbeatExpectedIntervalMinutes: number;
  heartbeatMissedThreshold: number;
}

export function listServers(): Promise<ServersOverviewResponse> {
  return request('/api/v1/admin/servers');
}

export function getServer(id: string): Promise<ServerDetail> {
  return request(`/api/v1/admin/servers/${id}`);
}

export function approveServer(id: string): Promise<{ status: string }> {
  return request(`/api/v1/admin/servers/${id}/approve`, { method: 'POST' });
}
