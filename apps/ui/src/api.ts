import type { ConfigData, ConfirmIssued, Envelope, HeapSnapshotData } from './types';

/**
 * API base derived from the document location. The console is served at
 * `{path}/`, so the API lives at `{path}/api`.
 */
export function apiBase(): string {
  const path = window.location.pathname.replace(/\/index\.html$/, '');
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

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
let unauthorized = false;

export function isUnauthorized(): boolean {
  return unauthorized;
}

/** Subscribes to the first 401 `unauthorized` response seen by any API call. */
export function onUnauthorized(cb: Listener): () => void {
  unauthorizedListeners.add(cb);
  return () => {
    unauthorizedListeners.delete(cb);
  };
}

export function resetUnauthorized(): void {
  unauthorized = false;
}

function markUnauthorized(): void {
  if (unauthorized) return;
  unauthorized = true;
  for (const cb of unauthorizedListeners) cb();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase() + path, { ...init, credentials: 'same-origin' });
  let envelope: Envelope<T>;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(`Invalid response from ${path} (HTTP ${res.status})`, 'invalid-response');
  }
  if (!envelope.ok) {
    if (envelope.error.code === 'unauthorized') markUnauthorized();
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
