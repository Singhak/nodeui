import type { ConfigData, ConfirmIssued, Envelope, HeapSnapshotData } from './types';

/**
 * API base derived from the document location. The console is served at
 * `{path}/`, so the API lives at `{path}/api`.
 */
export function apiBase(): string {
  const path = window.location.pathname;
  const dir = path.endsWith('/') ? path.slice(0, -1) : path;
  return `${dir}/api`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase() + path, init);
  let envelope: Envelope<T>;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(`Invalid response from ${path} (HTTP ${res.status})`, 'invalid-response');
  }
  if (!envelope.ok) {
    throw new ApiError(envelope.error.message, envelope.error.code);
  }
  return envelope.data;
}

export function getConfig(): Promise<ConfigData> {
  return request<ConfigData>('/config');
}

export function getPanel<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function issueConfirmation(): Promise<ConfirmIssued> {
  return request<ConfirmIssued>('/confirmations', { method: 'POST' });
}

export function takeHeapSnapshot(nonce: string): Promise<HeapSnapshotData> {
  return request<HeapSnapshotData>('/heap-snapshot', {
    method: 'POST',
    headers: { 'x-nodeui-confirm': nonce },
  });
}
