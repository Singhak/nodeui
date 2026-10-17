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
  | 'metrics'
  | 'outgoing'
  | 'errors'
  | 'queries'
  | (string & {});

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
  locked?: boolean;
  plugins?: Array<{ id: PanelId; title: string }>;
}

export type HealthStatus = 'ok' | 'degraded' | 'critical' | 'unknown';

export interface HealthCheckResult {
  name: string;
  status: 'up' | 'down';
  durationMs: number;
  error?: string;
}

export interface HealthData {
  status: HealthStatus;
  statusReason: string;
  uptimeSeconds: number;
  pid: number;
  nodeVersion: string;
  platform: string;
  eventLoopLagMs: number | null;
  memoryUsedPercent: number | null;
  checks?: HealthCheckResult[];
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
  route?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  requestBody?: string;
  requestBodyTruncated?: boolean;
  responseBody?: string;
  responseBodyTruncated?: boolean;
}

export interface RequestsData {
  summary?: RequestsSummary;
  /** Entries held in the ring buffer. */
  total: number;
  capacity?: number;
  offset?: number;
  entries: RequestEntry[];
  /** Counters since process start, unaffected by buffer eviction. */
  lifetime?: { requests: number; errors: number };
}

export interface TimeSeriesPoint {
  t: number;
  requests: number;
  rps: number;
  errors: number;
  errors4xx: number;
  errorRate: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  maxMs: number;
  avgMs: number;
  inflight: number;
  bytesInPerSec: number;
  bytesOutPerSec: number;
  loopP50: number;
  loopP99: number;
  loopMax: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  cpu: number;
  gcCount: number;
  gcMs: number;
  gcMaxMs?: number;
  handles?: number;
  timers?: number;
}

export interface TimeSeriesData {
  fromMs: number;
  toMs: number;
  stepMs: number;
  startedAtMs: number;
  retentionMs: number;
  points: TimeSeriesPoint[];
  summary: BenchRunSummary;
  totals: { requests: number; errors5xx: number; errors4xx: number };
  recording: { id: number; name: string; startMs: number } | null;
  heatmap?: LatencyHeatmap;
  annotations?: Annotation[];
  heapTrend?: HeapTrend;
}

export interface LatencyHeatmap {
  times: number[];
  rowUpperMs: number[];
  cells: number[][];
  stepMs: number;
}

export interface RouteMetricRow {
  method: string;
  path: string;
  count: number;
  errors5xx: number;
  errors4xx: number;
  errorRate: number;
  avgMs: number;
  p50: number;
  p95: number;
  p99: number;
  maxMs: number;
  totalMs: number;
  bytesOut: number;
  rps: number;
  lastMs: number;
  sparkRps: number[];
  sparkAvgMs: number[];
}

export interface RouteMetricsData {
  startedAtMs: number;
  sparkStepMs: number;
  routes: RouteMetricRow[];
  totals: { requests: number; totalMs: number };
}

export interface BenchRunSummary {
  durationSec: number;
  requests: number;
  errors5xx: number;
  errors4xx: number;
  avgRps: number;
  peakRps: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  maxMs: number;
  avgMs: number;
  bytesIn: number;
  bytesOut: number;
  mbPerSec: number;
  inflightMax: number;
  loopP50: number;
  loopP99: number;
  loopMax: number;
  heapPeak: number;
  rssPeak: number;
  cpuAvg: number;
  cpuPeak: number;
  gcMs: number;
  pointCount: number;
}

export interface BenchRun {
  loadTest?: LoadTestConfig;
  id: number;
  name: string;
  startMs: number;
  endMs: number;
  summary: BenchRunSummary;
  points: TimeSeriesPoint[];
}

export interface RunsData {
  active: { id: number; name: string; startMs: number } | null;
  runs: BenchRun[];
  baselineId: number | null;
  persisted: boolean;
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
  requestId?: number;
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
  url: string;
  status: number | null;
  durationMs: number;
  timestampMs: number;
  error?: string;
  requestId?: number;
}

export interface QueryEntry {
  id: number;
  system: string;
  sql: string;
  durationMs: number;
  timestampMs: number;
  rowCount?: number;
  error?: string;
  requestId?: number;
  slow?: boolean;
  nPlusOne?: boolean;
  repeats?: number;
}

export interface QueriesData {
  statements: QueryStatement[];
  total: number;
  failed: number;
  slow: number;
  nPlusOneGroups: number;
  slowQueryMs: number;
  entries: QueryEntry[];
}

export interface ErrorGroup {
  id: string;
  name: string;
  message: string;
  stack: string;
  source: 'request' | 'uncaught' | 'rejection' | 'manual';
  count: number;
  firstSeenMs: number;
  lastSeenMs: number;
  lastRequestId?: number;
  lastRoute?: string;
  lastStatus?: number;
}

export interface ErrorsData {
  total: number;
  groups: ErrorGroup[];
}

export interface OutgoingData {
  total: number;
  failed: number;
  entries: OutgoingRequestEntry[];
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
  count: number;
  errors: number;
  /** 0..1, 5xx only. */
  errorRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  byStatus: { '2xx': number; '3xx': number; '4xx': number; '5xx': number };
  routes: RouteStat[];
}

export interface ReplayInput {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface ReplayResult {
  status: number;
  statusMessage: string;
  headers: Record<string, string>;
  durationMs: number;
  sizeBytes: number;
  body: string;
  bodyTruncated: boolean;
  binary: boolean;
}

export type AlertMetric =
  'p50' | 'p95' | 'p99' | 'maxMs' | 'errorRate' | 'rps' | 'loopP99' | 'cpu' | 'heapMb' | 'rssMb';

export interface AlertRuleView {
  id: number;
  name: string;
  metric: AlertMetric;
  op: '>' | '<';
  threshold: number;
  forSeconds: number;
  windowSeconds: number;
  source: 'config' | 'ui';
  state: 'ok' | 'pending' | 'firing';
  value: number | null;
  sinceMs: number;
}

export interface AlertEvent {
  ruleId: number;
  name: string;
  type: 'fired' | 'resolved';
  atMs: number;
  value: number;
  threshold: number;
  metric: AlertMetric;
}

export interface AlertsData {
  rules: AlertRuleView[];
  firing: number;
  events: AlertEvent[];
  metrics: Array<{ id: AlertMetric; label: string; unit: string }>;
}

export interface AlertInput {
  metric: AlertMetric;
  op: '>' | '<';
  threshold: number;
  forSeconds: number;
  name?: string;
}

/** One normalized statement, aggregated over every captured execution. */
export interface QueryStatement {
  /** Normalized text (literals replaced by `?`). */
  key: string;
  /** A real example of the statement, truncated. */
  sample: string;
  system: string;
  count: number;
  errors: number;
  totalMs: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  /** Requests in which this statement ran 3+ times (N+1 suspects). */
  nPlusOneRequests: number;
  /** Largest repeat count within a single request. */
  maxRepeats: number;
  lastMs: number;
}

export type AnnotationKind = 'note' | 'app' | 'run' | 'alert';

/** A marker on the metrics time axis. */
export interface Annotation {
  id: number;
  atMs: number;
  label: string;
  /** `note` and `app` come from people or the host app; `run` and `alert` are automatic. */
  kind: AnnotationKind;
}

/** Verdict of the heap leak heuristic over the requested window. */
export interface HeapTrend {
  windowMs: number;
  /** Slope of the heap's lower envelope (post-GC floor), MB per minute. */
  slopeMbPerMin: number;
  floorStartMb: number;
  floorEndMb: number;
  /** Goodness of the linear fit, 0..1. */
  r2: number;
  suspect: boolean;
  reason: string;
}

/** One function in the call tree of a CPU profile. */
export interface FlameNode {
  name: string;
  /** Short source location, e.g. `src/routes/users.js`. */
  file: string;
  line: number;
  /** Time in this function and everything it called. */
  totalMs: number;
  /** Time spent in this function itself. */
  selfMs: number;
  children: FlameNode[];
}

export interface TopFunction {
  name: string;
  file: string;
  line: number;
  selfMs: number;
  /** Fraction of the whole profile (0..1). */
  share: number;
}

export interface CpuProfileResult {
  durationMs: number;
  totalMs: number;
  /** Time the process was idle (waiting for work), included in `totalMs`. */
  idleMs: number;
  sampleCount: number;
  tree: FlameNode;
  top: TopFunction[];
}

export type CpuProfileData =
  | { state: 'idle' }
  | { state: 'running'; seconds: number; startedAtMs: number }
  | {
      state: 'done';
      seconds: number;
      startedAtMs: number;
      finishedAtMs: number;
      result: CpuProfileResult;
    }
  | { state: 'error'; seconds: number; startedAtMs: number; error: string };

/** What the built-in load generator fires at the app. */
export interface LoadTestConfig {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  connections: number;
  durationSec: number;
  maxRequests: number;
  name: string;
}

export interface LoadTestStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  config?: LoadTestConfig;
  startedAtMs?: number;
  sent: number;
  completed: number;
  errors: number;
  /** Saved run produced by a finished test. */
  runId?: number;
  error?: string;
}

export interface DiagnoseFinding {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  hint: string;
  view?: string;
}

export interface DiagnoseData {
  status: 'ok' | 'warning' | 'critical' | 'collecting';
  windowSeconds: number;
  findings: DiagnoseFinding[];
}

export interface AllocNode {
  name: string;
  file: string;
  line: number;
  totalBytes: number;
  selfBytes: number;
  children: AllocNode[];
}

export interface TopAllocator {
  name: string;
  file: string;
  line: number;
  selfBytes: number;
  share: number;
}

export interface HeapProfileResult {
  durationMs: number;
  totalBytes: number;
  tree: AllocNode;
  top: TopAllocator[];
}

export type HeapProfileData =
  | { state: 'idle' }
  | { state: 'running'; seconds: number; startedAtMs: number }
  | {
      state: 'done';
      seconds: number;
      startedAtMs: number;
      finishedAtMs: number;
      result: HeapProfileResult;
    }
  | { state: 'error'; seconds: number; startedAtMs: number; error: string };
