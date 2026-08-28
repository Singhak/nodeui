export type PanelId =
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
  | 'metrics';

export type Envelope<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

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
}

export type HealthStatus = 'ok' | 'degraded' | 'critical' | 'unknown';

export interface HealthData {
  status: HealthStatus;
  statusReason: string;
  uptimeSeconds: number;
  pid: number;
  nodeVersion: string;
  platform: string;
  eventLoopLagMs: number | null;
  memoryUsedPercent: number | null;
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

export interface EventLoopData {
  currentMs: number;
  maxMs: number;
  avgMs: number;
  count: number;
  sampleAtMs: number;
}

export interface StartupMark {
  name: string;
  atMs: number;
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
}

export interface RequestsData {
  total: number;
  entries: RequestEntry[];
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
