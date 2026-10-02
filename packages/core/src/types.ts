/**
 * Shared typed contract for the NodeUI developer console.
 *
 * The core engine, both adapters, and the browser console all speak this
 * contract. Every provider returns a {@link ProviderResult}; every REST
 * endpoint returns an {@link ApiEnvelope} which is the same shape.
 */

export type BuiltInPanelId =
  | 'health'
  | 'memory'
  | 'cpu'
  | 'event-loop'
  | 'heap-snapshot'
  | 'startup'
  | 'requests'
  | 'env'
  | 'routes'
  | 'logs'
  | 'metrics'
  | 'outgoing';

/**
 * Panel identifier. Built-in panels are listed in {@link BuiltInPanelId};
 * plugins may register any other string id (lowercase letters, digits, `-`).
 */
export type PanelId = BuiltInPanelId | (string & {});

/** Resolved, validated console configuration. */
export interface NodeUIConfig {
  /** URL path prefix where the console and its API are served. Default `/nodeui`. */
  path: string;
  /** Interface the console considers its own. Default `127.0.0.1`. */
  host: string;
  /** Informational port of the host application. */
  port: number;
  /** Ring buffer capacity for the HTTP request log. Default 500. */
  requestLogSize: number;
  /** Ring buffer capacity for the log viewer. Default 500. */
  logSize: number;
  /** Sampling/polling interval in ms. Default 2000. */
  pollIntervalMs: number;
  /** Whether the console is active (see {@link resolveActivation}). */
  enabled: boolean;
  /** Human-readable explanation of the activation decision. */
  activationReason: string;
  /** Whether secret masking is applied to panel output. Default true. */
  maskSecrets: boolean;
  /** Idle time after which background samplers stop. Default 60000. */
  inactivityTimeoutMs: number;
  /** TTL for mutation confirmation nonces. Default 60000. */
  confirmTtlMs: number;
  /** Directory where heap snapshot files are written. */
  heapSnapshotDir: string;
  /** Extra `Host` header hostnames accepted besides loopback names. */
  allowedHosts: string[];
  /** Extra `Origin` values accepted for cross-origin calls. */
  allowedOrigins: string[];
  /** Extra remote IPs / IPv4 CIDRs accepted (e.g. Docker bridge `172.17.0.0/16`). */
  allowedRemoteAddresses: string[];
  /** Accept requests carrying `X-Forwarded-*` headers. */
  trustProxy: boolean;
  /** Whether a shared access token is required. */
  authRequired: boolean;
  /** Maximum concurrent live (SSE) streams. */
  maxSseClients: number;
}

/** Context handed to every provider call. */
export interface ProviderContext {
  config: NodeUIConfig;
  /** Environment snapshot (injectable for tests; defaults to `process.env`). */
  env: Record<string, string | undefined>;
  /** Shared scratch pad providers can read/write. */
  store: Record<string, unknown>;
  /** Query parameters of the current API request (e.g. `?level=`). */
  query?: Record<string, string>;
}

export interface ProviderError {
  /** Stable machine-readable code, e.g. `confirmation-required`. */
  code: string;
  /** Human-readable message. */
  message: string;
}

/**
 * Typed provider result. Success carries `data`; failure carries a
 * `ProviderError`. Providers never throw to the caller.
 */
export type ProviderResult<T> = { ok: true; data: T } | { ok: false; error: ProviderError };

/** The envelope returned by every REST endpoint. */
export type ApiEnvelope<T> = ProviderResult<T>;

/**
 * One provider per panel. Providers that sample in the background implement
 * `start`/`stop`; the server starts them lazily on first view and stops them
 * after a period of inactivity.
 */
export interface NodeUIProvider<T = unknown> {
  readonly id: PanelId;
  /** Display label for plugin panels; defaults to the id. */
  readonly title?: string;
  start?(ctx: ProviderContext): void;
  stop?(ctx: ProviderContext): void;
  get(ctx: ProviderContext): ProviderResult<T> | Promise<ProviderResult<T>>;
}

/** Event-loop lag sample. */
export interface EventLoopSample {
  currentMs: number;
  maxMs: number;
  avgMs: number;
  count: number;
  sampleAtMs: number;
}

export interface MemoryData {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  totalMem: number;
  freeMem: number;
  sampleAtMs: number;
}

export interface CpuData {
  userPercent: number;
  systemPercent: number;
  totalPercent: number;
  sampleAtMs: number;
}

export interface HealthCheckResult {
  name: string;
  status: 'up' | 'down';
  durationMs: number;
  error?: string;
}

export interface HealthData {
  status: 'ok' | 'degraded' | 'critical' | 'unknown';
  statusReason: string;
  uptimeSeconds: number;
  pid: number;
  nodeVersion: string;
  platform: string;
  eventLoopLagMs: number | null;
  memoryUsedPercent: number | null;
  /** Results of user-registered dependency checks; empty when none. */
  checks: HealthCheckResult[];
}

export interface StartupMark {
  name: string;
  atMs: number;
  /** Milliseconds since the first recorded mark. */
  sinceFirstMs: number;
}

export interface StartupData {
  startedAtMs: number;
  marks: StartupMark[];
}

export interface RequestEntry {
  id: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  timestampMs: number;
  ip: string;
  /** Matched route pattern (e.g. `/users/:id`) when the framework exposes it. */
  route?: string;
}

export interface RouteStat {
  method: string;
  path: string;
  count: number;
  avgMs: number;
  p95Ms: number;
  errors: number;
}

export interface RequestsSummary {
  /** Requests currently held in the ring buffer. */
  count: number;
  errors: number;
  /** `errors / count` in 0..1 (5xx only). */
  errorRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  byStatus: { '2xx': number; '3xx': number; '4xx': number; '5xx': number };
  /** Busiest/slowest routes, slowest p95 first (at most 8). */
  routes: RouteStat[];
}

export interface RequestsData {
  total: number;
  entries: RequestEntry[];
  summary: RequestsSummary;
}

export interface EnvEntry {
  key: string;
  value: string;
}

export interface EnvData {
  environment: EnvEntry[];
  config: EnvEntry[] | null;
}

export interface RouteEntry {
  method: string;
  path: string;
  handler: string;
}

export interface RoutesData {
  routes: RouteEntry[];
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
}

export interface LogsData {
  entries: LogEntry[];
}

export interface MetricsBucket {
  ts: number;
  requests: number;
  errors: number;
}

export interface MetricsData {
  buckets: MetricsBucket[];
}

export interface OutgoingRequestEntry {
  id: number;
  method: string;
  /** Target as `host/path` (query string removed). */
  url: string;
  status: number | null;
  durationMs: number;
  timestampMs: number;
  error?: string;
}

export interface OutgoingData {
  total: number;
  failed: number;
  entries: OutgoingRequestEntry[];
}

export interface HeapSnapshotData {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAtMs: number;
}

export interface HeapSnapshotPanelData {
  supported: boolean;
  lastSnapshot: HeapSnapshotData | null;
}

export interface ConfirmIssued {
  nonce: string;
  expiresAtMs: number;
  ttlMs: number;
}

export interface ConfigData {
  enabled: boolean;
  activationReason: string;
  path: string;
  host: string;
  port: number;
  requestLogSize: number;
  logSize: number;
  pollIntervalMs: number;
  panels: PanelId[];
  masking: { enabled: boolean; pattern: string };
  locked: boolean;
  /** Plugin panel ids and titles, in registration order. */
  plugins: Array<{ id: PanelId; title: string }>;
}
