import type {
  BenchRun,
  ConfigData,
  ConfirmIssued,
  Envelope,
  AlertInput,
  LoadTestConfig,
  LoadTestStatus,
  CpuProfileData,
  Annotation,
  HeapSnapshotData,
  ReplayInput,
  ReplayResult,
  RunsData,
} from './types';

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

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getRuns(): Promise<RunsData> {
  return request<RunsData>('/runs');
}

export function startRun(name: string): Promise<{ id: number; name: string; startMs: number }> {
  return postJson('/runs/start', { name });
}

export function stopRun(): Promise<BenchRun> {
  return postJson('/runs/stop', {});
}

export function saveRun(name: string, fromMs: number, toMs: number): Promise<BenchRun> {
  return postJson('/runs/save', { name, fromMs, toMs });
}

export function deleteRun(id: number): Promise<{ deleted: boolean }> {
  return postJson('/runs/delete', { id });
}

export function resetRouteMetrics(): Promise<{ reset: boolean }> {
  return postJson('/runs/reset-routes', {});
}

/** Re-sends a request to the app; needs a fresh confirmation nonce. */
export function replayRequest(input: ReplayInput, nonce: string): Promise<ReplayResult> {
  return request<ReplayResult>('/replay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nodeui-confirm': nonce },
    body: JSON.stringify(input),
  });
}

export function setBaseline(id: number | null): Promise<{ baselineId: number | null }> {
  return postJson('/runs/baseline', { id });
}

export function importRuns(file: unknown): Promise<{ imported: number }> {
  return postJson('/runs/import', file);
}

/** Raw JSON text of all saved runs (for a download). */
export async function exportRuns(): Promise<string> {
  const res = await fetch(`${apiBase()}/runs/export`, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(`Export failed (HTTP ${res.status})`, 'export-failed');
  return res.text();
}

export function addAlert(input: AlertInput): Promise<{ id: number }> {
  return postJson('/alerts/add', input);
}

export function removeAlert(id: number): Promise<{ removed: boolean }> {
  return postJson('/alerts/remove', { id });
}

export function addAnnotation(label: string, atMs?: number): Promise<Annotation> {
  return postJson('/annotations/add', { label, atMs });
}

export function startCpuProfile(seconds: number, nonce: string): Promise<CpuProfileData> {
  return request<CpuProfileData>('/cpu-profile/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nodeui-confirm': nonce },
    body: JSON.stringify({ seconds }),
  });
}

export function stopCpuProfile(): Promise<CpuProfileData> {
  return postJson('/cpu-profile/stop', {});
}

export function startLoadTest(
  config: Partial<LoadTestConfig>,
  nonce: string,
): Promise<LoadTestStatus> {
  return request<LoadTestStatus>('/loadtest/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nodeui-confirm': nonce },
    body: JSON.stringify(config),
  });
}

export function stopLoadTest(): Promise<LoadTestStatus> {
  return postJson('/loadtest/stop', {});
}
