import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  ApiEnvelope,
  ConfigData,
  ConfirmIssued,
  HeapSnapshotData,
  LogLevel,
  NodeUIConfig,
  NodeUIProvider,
  PanelId,
  ProviderContext,
  ProviderResult,
  RouteEntry,
  StartupData,
  RequestDetailOptions,
} from './types';
import {
  isLoopbackAddress,
  isLoopbackHostname,
  maskSecrets,
  resolveActivation,
  SECRET_KEY_PATTERN,
  isValidAddressEntry,
} from './safety';
import { AUTH_COOKIE, createGuard } from './guard';
import { ConfirmationStore } from './confirmations';
import { AnnotationStore } from './annotations';
import { RunStore } from './run-store';
import { normalizeReplayRequest, replayRequest, ReplayError, type ReplayTarget } from './replay';
import { DEFAULT_LOG_SIZE } from './constants';
import { startSse } from './sse';
import { ProviderRegistry } from './registry';
import { resolveStaticAsset, uiAssetsDir } from './static';
import { MemoryProvider } from './providers/memory';
import { CpuProvider } from './providers/cpu';
import { EventLoopLagProvider } from './providers/event-loop';
import { HealthProvider } from './providers/health';
import { HeapSnapshotProvider } from './providers/heap-snapshot';
import { bindRequestId, currentRequestId, runWithRequestId } from './context';
import { captureRequestDetail, resolveRequestDetail } from './request-detail';
import { OtlpExporter, type OtlpOptions } from './otlp';
import { DEFAULT_PERSIST_MAX_BYTES, Persistence, type PersistedRecord } from './persistence';
import { StartupTracker } from './providers/startup-tracker';
import { RequestsProvider } from './providers/requests';
import { OutgoingProvider } from './providers/outgoing';
import { ErrorsProvider } from './providers/errors';
import { QueriesProvider } from './providers/queries';
import type { HealthCheck } from './providers/health';
import { TimeSeriesProvider } from './providers/timeseries';
import { RouteMetricsProvider } from './providers/route-metrics';
import { AlertsProvider, type AlertRuleInput } from './providers/alerts';
import { CpuProfileProvider } from './providers/cpu-profile';
import { LoadGenProvider } from './providers/load-gen';
import { MetricsProvider, LogsProvider, EnvProvider, RoutesProvider } from './providers';

export interface NodeUIOptions {
  /** URL path prefix. Default `/nodeui` (or `NODEUI_PATH`). */
  path?: string;
  /** Interface the console considers its own. Default `127.0.0.1` (or `NODEUI_HOST`). */
  host?: string;
  /** Informational port of the host application. */
  port?: number;
  /** Ring buffer capacity for the request log. Default 500. */
  requestLogSize?: number;
  /** Ring buffer capacity for the log viewer. Default 500. */
  logSize?: number;
  /** App config surfaced in the env panel; may be an object or a getter. */
  config?: unknown | (() => unknown);
  /** Sampling/polling interval in ms. Default 2000. */
  pollIntervalMs?: number;
  /** Explicit activation override. Defaults to env-based activation. */
  enabled?: boolean;
  /** Environment snapshot. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Whether secret masking applies to panel output. Default true. */
  maskSecrets?: boolean;
  /**
   * Extra detail recorded per request: query, headers (credentials always
   * redacted) and, opt-in, textual bodies (or `NODEUI_CAPTURE_BODIES=true`).
   * `false` records none of it.
   */
  captureRequestDetail?: boolean | RequestDetailOptions;
  /**
   * Keep recent requests, outgoing calls, queries and errors in an NDJSON
   * journal so they survive a restart (or `NODEUI_PERSIST_FILE`). Off by
   * default. The file is private (0600), masked, and rotated at `maxBytes`
   * (default 5 MiB). It holds whatever the console records, so keep it out of
   * version control.
   */
  persist?: string | { file: string; maxBytes?: number };
  /**
   * File that keeps saved load-test runs (and the pinned baseline) across
   * restarts, or `NODEUI_RUNS_FILE`. Defaults to `nodeui-runs.json` next to the
   * `persist` journal when that is set; otherwise runs live in memory only.
   */
  runsFile?: string;
  /**
   * Threshold alerts, e.g. `{ metric: 'p99', threshold: 300 }` fires when the
   * 10-second p99 stays above 300 ms for 5 seconds. Metrics: p50, p95, p99,
   * maxMs, errorRate (%), rps, loopP99, cpu (%), heapMb, rssMb. More rules can
   * be added in the console.
   */
  alerts?: AlertRuleInput[];
  /**
   * When the outgoing-call, query and log instrumentation runs. `'always'`
   * (default) records from startup, so you can open the console after a problem
   * and still see what led to it. `'lazy'` installs the hooks only while a panel
   * is open and removes them after `inactivityTimeoutMs`, for zero cost when
   * nobody is looking (or `NODEUI_CAPTURE=lazy`). Buffers are bounded either way.
   */
  capture?: 'always' | 'lazy';
  /**
   * Export requests, outgoing calls and queries as OTLP/HTTP JSON spans to a
   * collector (or `NODEUI_OTLP_ENDPOINT`). Off by default. Enabling it keeps
   * outgoing and query instrumentation running and sends (masked) telemetry to
   * the given endpoint, so point it at a local collector.
   */
  otlp?: string | OtlpOptions;
  /** Idle time after which background samplers stop. Default 60000. */
  inactivityTimeoutMs?: number;
  /** TTL for mutation confirmation nonces. Default 60000. */
  confirmTtlMs?: number;
  /** Directory for heap snapshot files. Defaults to a private dir under the OS temp dir. */
  heapSnapshotDir?: string;
  /** Extra `Host` hostnames accepted besides loopback names (or `NODEUI_ALLOWED_HOSTS`, comma-separated). */
  allowedHosts?: string[];
  /** Extra `Origin` values accepted for cross-origin calls (or `NODEUI_ALLOWED_ORIGINS`). */
  allowedOrigins?: string[];
  /**
   * Extra remote IPs / IPv4 CIDRs accepted (or `NODEUI_ALLOWED_REMOTE`). Use
   * `['172.16.0.0/12']` to reach the console from the host when the app runs in Docker.
   */
  allowedRemoteAddresses?: string[];
  /** Accept requests carrying `X-Forwarded-*` headers (or `NODEUI_TRUST_PROXY=true`). Default false. */
  trustProxy?: boolean;
  /**
   * Shared access token (or `NODEUI_TOKEN`). When set, open `/nodeui/?token=<token>` once;
   * the browser then keeps an HttpOnly cookie. API clients may send `Authorization: Bearer`.
   */
  authToken?: string;
  /** Maximum concurrent live (SSE) streams. Default 10. */
  maxSseClients?: number;
  /** Custom panels; each provider needs a unique lowercase id, e.g. `queues`. */
  plugins?: NodeUIProvider[];
  /** Named dependency checks (database, cache, ...) surfaced in the health panel. */
  healthChecks?: Record<string, HealthCheck>;
  /** Max recorded outgoing HTTP calls. Default 200. */
  outgoingLogSize?: number;
  /** Max recorded database queries. Default 200. */
  queryLogSize?: number;
  /** Queries at or above this duration are flagged slow. Default 100 ms. */
  slowQueryMs?: number;
}

export interface NodeUIServer {
  readonly config: NodeUIConfig;
  readonly active: boolean;
  readonly activationReason: string;
  /** Express/Nest compatible middleware that serves the console and API. */
  middleware(): NodeUIMiddleware;
  /** Direct request handling (no `next`); used for tests and adapters. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /**
   * Supplies the route list directly (frameworks other than Express, e.g.
   * Fastify's `onRoute`). Takes precedence over Express router introspection.
   */
  setRoutes(source: RouteEntry[] | (() => RouteEntry[])): void;
  /** Records a bootstrap timing mark, e.g. `mark("listening")`. */
  mark(name: string): void;
  /**
   * Drops a marker on the metrics charts, e.g. `annotate("deployed v1.4")` or
   * `annotate("cache enabled")`, so a change can be matched to its effect.
   */
  annotate(label: string): void;
  /** Whether a background-sampling provider is currently running. */
  isProviderActive(id: PanelId): boolean;
  /** Pushes an external log entry into the log viewer (logger adapter). */
  addLogSource(entry: { level: LogLevel; message: string }): void;
  /**
   * Records a database query from an ORM or driver hook that NodeUI does not
   * patch itself (Sequelize `logging`, TypeORM logger, ...). Parameters are not recorded.
   */
  recordQuery(query: {
    system: string;
    sql: string;
    durationMs: number;
    rowCount?: number;
    error?: string;
  }): void;
  /**
   * Subscribes to a Prisma client's query events. Create the client with
   * `log: [{ emit: 'event', level: 'query' }]`.
   */
  trackPrisma(client: {
    $on(event: 'query', cb: (e: { query: string; duration: number | bigint }) => void): void;
  }): void;
  /**
   * Records a handled error (e.g. from a framework error hook) so it appears in
   * the Errors panel, attributed to the current request when there is one.
   */
  recordError(error: unknown, context?: { route?: string; status?: number }): void;
  /** Stops all timers and background samplers. */
  shutdown(): void;
}

export type NodeUIMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void;

const SSE_HEARTBEAT_MS = 15_000;

/**
 * Serializes an API envelope to JSON, applying secret masking so values
 * under keys like `TOKEN`/`KEY`/`SECRET`/`PASSWORD` never reach the UI.
 */
export function serializeEnvelope<T>(envelope: ApiEnvelope<T>, mask = true): string {
  return JSON.stringify(mask ? maskSecrets(envelope) : envelope);
}

function journalFile(
  options: NodeUIOptions,
  env: Record<string, string | undefined>,
): string | null {
  return (
    (typeof options.persist === 'string' ? options.persist : options.persist?.file) ??
    env.NODEUI_PERSIST_FILE ??
    null
  );
}

const REPLAY_BODY_LIMIT = 256 * 1024;
const RUNS_IMPORT_LIMIT = 4 * 1024 * 1024;

const BUILT_IN_PANELS = new Set<string>([
  'health',
  'memory',
  'cpu',
  'event-loop',
  'heap-snapshot',
  'startup',
  'requests',
  'env',
  'routes',
  'logs',
  'metrics',
  'outgoing',
  'errors',
  'queries',
  'timeseries',
  'routemetrics',
  'alerts',
  'cpu-profile',
  'loadtest',
]);
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const RESERVED_API_NAMES = new Set([
  'config',
  'live',
  'confirmations',
  'runs',
  'prometheus',
  'replay',
]);

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function listFrom(value: string[] | undefined, raw: string | undefined): string[] {
  if (value) return value;
  return (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function otlpHostname(endpoint: string): string {
  try {
    return new URL(endpoint).hostname.replace(/^\[|\]$/g, '');
  } catch {
    throw new Error(`nodeui otlp endpoint "${endpoint}" is not a valid URL`);
  }
}

function pathnameOf(req: IncomingMessage): string {
  const raw = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '/';
  try {
    return new URL(raw, 'http://localhost').pathname;
  } catch {
    return raw;
  }
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) throw new Error(`NODEUI_PATH must start with "/", got "${value}"`);
  return trimmed.replace(/\/+$/, '') || '/';
}

function resolveCapture(
  option: 'always' | 'lazy' | undefined,
  env: string | undefined,
): 'always' | 'lazy' {
  const value = option ?? env ?? 'always';
  if (value !== 'always' && value !== 'lazy') {
    throw new Error(`nodeui capture must be 'always' or 'lazy', got "${String(value)}"`);
  }
  return value;
}

function positiveInt(value: number | undefined, fallback: number, name: string): number {
  const n = value === undefined ? fallback : value;
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

export function createNodeUI(options: NodeUIOptions = {}): NodeUIServer {
  const env = options.env ?? process.env;

  const activation =
    options.enabled !== undefined
      ? {
          active: options.enabled,
          reason: options.enabled
            ? 'explicitly enabled via options'
            : 'explicitly disabled via options',
        }
      : resolveActivation(env);

  const path = normalizePath(options.path ?? env.NODEUI_PATH ?? '/nodeui');
  const host = options.host ?? env.NODEUI_HOST ?? '127.0.0.1';
  const config: NodeUIConfig = {
    path,
    host,
    port: options.port ?? (env.NODEUI_PORT ? Number(env.NODEUI_PORT) : 0),
    requestLogSize: positiveInt(
      options.requestLogSize,
      env.NODEUI_REQUEST_LOG_SIZE ? Number(env.NODEUI_REQUEST_LOG_SIZE) : 500,
      'NODEUI_REQUEST_LOG_SIZE',
    ),
    logSize: positiveInt(
      options.logSize,
      env.NODEUI_LOG_SIZE ? Number(env.NODEUI_LOG_SIZE) : DEFAULT_LOG_SIZE,
      'NODEUI_LOG_SIZE',
    ),
    pollIntervalMs: positiveInt(
      options.pollIntervalMs,
      env.NODEUI_POLL_INTERVAL_MS ? Number(env.NODEUI_POLL_INTERVAL_MS) : 2000,
      'NODEUI_POLL_INTERVAL_MS',
    ),
    enabled: activation.active,
    activationReason: activation.reason,
    maskSecrets: options.maskSecrets ?? true,
    capture: resolveCapture(options.capture, env.NODEUI_CAPTURE),
    persistFile:
      (typeof options.persist === 'string' ? options.persist : options.persist?.file) ??
      env.NODEUI_PERSIST_FILE ??
      null,
    runsFile:
      options.runsFile ??
      env.NODEUI_RUNS_FILE ??
      (journalFile(options, env)
        ? join(dirname(journalFile(options, env) as string), 'nodeui-runs.json')
        : null),
    persistMaxBytes: positiveInt(
      typeof options.persist === 'object' ? options.persist.maxBytes : undefined,
      DEFAULT_PERSIST_MAX_BYTES,
      'persist.maxBytes',
    ),
    otlp:
      typeof options.otlp === 'string'
        ? { endpoint: options.otlp }
        : (options.otlp ??
          (env.NODEUI_OTLP_ENDPOINT ? { endpoint: env.NODEUI_OTLP_ENDPOINT } : null)),
    requestDetail: resolveRequestDetail(
      options.captureRequestDetail,
      env.NODEUI_CAPTURE_BODIES === 'true',
    ),
    inactivityTimeoutMs: positiveInt(
      options.inactivityTimeoutMs,
      env.NODEUI_INACTIVITY_TIMEOUT_MS ? Number(env.NODEUI_INACTIVITY_TIMEOUT_MS) : 60_000,
      'NODEUI_INACTIVITY_TIMEOUT_MS',
    ),
    confirmTtlMs: positiveInt(
      options.confirmTtlMs,
      env.NODEUI_CONFIRM_TTL_MS ? Number(env.NODEUI_CONFIRM_TTL_MS) : 60_000,
      'NODEUI_CONFIRM_TTL_MS',
    ),
    heapSnapshotDir:
      options.heapSnapshotDir ?? env.NODEUI_HEAP_SNAPSHOT_DIR ?? join(tmpdir(), 'nodeui-heap'),
    allowedHosts: listFrom(options.allowedHosts, env.NODEUI_ALLOWED_HOSTS),
    allowedOrigins: listFrom(options.allowedOrigins, env.NODEUI_ALLOWED_ORIGINS),
    allowedRemoteAddresses: listFrom(options.allowedRemoteAddresses, env.NODEUI_ALLOWED_REMOTE),
    trustProxy: options.trustProxy ?? env.NODEUI_TRUST_PROXY === 'true',
    authRequired: Boolean(options.authToken ?? env.NODEUI_TOKEN),
    maxSseClients: positiveInt(
      options.maxSseClients,
      env.NODEUI_MAX_SSE_CLIENTS ? Number(env.NODEUI_MAX_SSE_CLIENTS) : 10,
      'NODEUI_MAX_SSE_CLIENTS',
    ),
  };
  const authToken = options.authToken ?? env.NODEUI_TOKEN;
  const guard = createGuard({
    host: config.host,
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedOrigins,
    allowedRemoteAddresses: config.allowedRemoteAddresses,
    trustProxy: config.trustProxy,
    authToken: authToken || undefined,
  });

  if (config.enabled && !isLoopbackAddress(config.host)) {
    console.warn(
      `[nodeui] NODEUI_HOST is set to non-loopback "${config.host}". ` +
        'The developer console will be reachable from other hosts; only do this deliberately' +
        (config.authRequired ? '.' : ' and set NODEUI_TOKEN (authToken) to require a token.'),
    );
  }
  if (config.enabled && env.NODE_ENV === 'production') {
    console.warn(
      '[nodeui] running with NODE_ENV=production. The console exposes environment, logs and ' +
        'heap data; keep it behind loopback and an auth token.',
    );
  }
  if (config.enabled) {
    for (const entry of config.allowedRemoteAddresses) {
      if (!isValidAddressEntry(entry)) {
        console.warn(
          `[nodeui] ignoring allowedRemoteAddresses entry "${entry}": expected an IP or a ` +
            'CIDR such as 172.16.0.0/12 or fd00::/8; it will never match.',
        );
      }
    }
  }
  if (config.enabled && !config.maskSecrets) {
    console.warn('[nodeui] secret masking is disabled; panels may show credentials.');
  }

  const ctx: ProviderContext = { config, env, store: {} };
  if (options.config !== undefined) {
    ctx.store['app-config'] = options.config;
  }
  const registry = new ProviderRegistry();
  registry.register(new HealthProvider(options.healthChecks));
  registry.register(new MemoryProvider());
  registry.register(new CpuProvider());
  registry.register(new EventLoopLagProvider());
  registry.register(new HeapSnapshotProvider());

  const startupTracker = new StartupTracker();
  startupTracker.mark('nodeui.init');
  const startupProvider: NodeUIProvider<StartupData> = {
    id: 'startup',
    get: () => ({ ok: true, data: startupTracker.getData() }),
  };
  registry.register(startupProvider);

  const requestsProvider = new RequestsProvider(config.requestLogSize);
  registry.register(requestsProvider);

  const metricsProvider = new MetricsProvider();
  registry.register(metricsProvider);

  const timeSeries = new TimeSeriesProvider();
  registry.register(timeSeries);
  const annotations = new AnnotationStore();
  timeSeries.annotations = annotations;
  // History must accumulate even when no console tab is open.
  if (config.enabled) timeSeries.start(ctx);
  const cpuProfile = new CpuProfileProvider();
  registry.register(cpuProfile);

  const loadGen = new LoadGenProvider({
    startRun: (name, config) => void timeSeries.startRun(name, config),
    stopRun: () => timeSeries.stopRun(),
  });
  registry.register(loadGen);

  const alerts = new AlertsProvider({ windowSummary: (s) => timeSeries.windowSummary(s) });
  registry.register(alerts);
  for (const rule of options.alerts ?? []) alerts.addRule(rule, 'config');
  alerts.onEvent = (e) => {
    const verb = e.type === 'fired' ? 'ALERT' : 'resolved';
    console.warn(`[nodeui] ${verb}: ${e.name} (now ${e.value}, limit ${e.threshold})`);
    annotations.add(`${e.type === 'fired' ? 'Alert' : 'Resolved'}: ${e.name}`, 'alert', e.atMs);
  };
  if (config.enabled) alerts.start();
  const runStore = config.enabled && config.runsFile ? new RunStore(config.runsFile) : null;
  if (runStore) {
    timeSeries.restoreRuns(runStore.load());
    timeSeries.onRunsChanged = () => runStore.save(timeSeries.snapshotRuns());
  }

  const routeMetrics = new RouteMetricsProvider();
  registry.register(routeMetrics);

  const logsProvider = new LogsProvider(config.logSize);
  registry.register(logsProvider);

  const envProvider = new EnvProvider();
  registry.register(envProvider);
  const routesProvider = new RoutesProvider();
  registry.register(routesProvider);
  const outgoingProvider = new OutgoingProvider(
    positiveInt(options.outgoingLogSize, 200, 'outgoingLogSize'),
  );
  registry.register(outgoingProvider);

  const queriesProvider = new QueriesProvider({
    size: positiveInt(options.queryLogSize, 200, 'queryLogSize'),
    slowQueryMs: positiveInt(options.slowQueryMs, 100, 'slowQueryMs'),
  });
  registry.register(queriesProvider);

  const errorsProvider = new ErrorsProvider();
  registry.register(errorsProvider);
  if (config.enabled) errorsProvider.attach();

  // Optional sinks fed by every recorded item: a journal that survives restarts
  // and an OTLP exporter. Their data comes from the lazy outgoing/query
  // instrumentation, so either sink keeps those running ("pinned").
  const persistence =
    config.enabled && config.persistFile
      ? new Persistence(config.persistFile, config.persistMaxBytes)
      : null;
  const exporter = config.enabled && config.otlp ? new OtlpExporter(config.otlp) : null;
  const pinned = new Set<PanelId>();
  const otlpHost = config.otlp ? otlpHostname(config.otlp.endpoint) : null;
  if (exporter && config.otlp && !isLoopbackHostname(otlpHost)) {
    console.warn(
      `[nodeui] exporting telemetry to non-local OTLP endpoint ${config.otlp.endpoint}; ` +
        'requests, queries and outgoing URLs leave this machine (masked).',
    );
  }
  if (persistence) {
    const byKind = (kind: PersistedRecord['kind']): never[] =>
      persistence
        .load()
        .filter((r) => r.kind === kind)
        .map((r) => r.data) as never[];
    requestsProvider.restore(byKind('request'));
    outgoingProvider.restore(byKind('outgoing'));
    queriesProvider.restore(byKind('query'));
    errorsProvider.restore(byKind('error'));
  }
  if (persistence || exporter) {
    const save = (kind: PersistedRecord['kind'], data: unknown): void =>
      persistence?.append(kind, config.maskSecrets ? maskSecrets(data) : data);
    requestsProvider.onRecord = (e) => {
      save('request', e);
      exporter?.request(e);
    };
    outgoingProvider.onRecord = (e) => {
      save('outgoing', e);
      exporter?.outgoing(e);
    };
    queriesProvider.onRecord = (e) => {
      save('query', e);
      exporter?.query(e);
    };
    errorsProvider.onRecord = (e) => save('error', e);
  }
  // Sinks need the outgoing/query hooks running; `capture: 'always'` also pins logs.
  const pinnedProviders: Array<NodeUIProvider> = [];
  if (persistence || exporter || (config.enabled && config.capture === 'always')) {
    pinnedProviders.push(outgoingProvider, queriesProvider);
  }
  if (config.enabled && config.capture === 'always') pinnedProviders.push(logsProvider);
  for (const provider of pinnedProviders) {
    provider.start?.(ctx);
    pinned.add(provider.id);
  }

  // The metrics history samples continuously; the inactivity timer must not stop it.
  if (config.enabled) {
    pinned.add('timeseries');
    pinned.add('alerts');
  }

  const pluginMeta: Array<{ id: PanelId; title: string }> = [];
  for (const plugin of options.plugins ?? []) {
    if (
      !PLUGIN_ID_PATTERN.test(plugin.id) ||
      BUILT_IN_PANELS.has(plugin.id) ||
      RESERVED_API_NAMES.has(plugin.id) ||
      registry.get(plugin.id)
    ) {
      throw new Error(
        `nodeui plugin id "${plugin.id}" is invalid or already taken ` +
          '(use lowercase letters, digits and "-")',
      );
    }
    registry.register(plugin);
    pluginMeta.push({ id: plugin.id, title: plugin.title ?? plugin.id });
  }

  const confirmations = new ConfirmationStore(config.confirmTtlMs);
  const activeProviders = new Set<PanelId>();
  let inactivityTimer: NodeJS.Timeout | null = null;
  let sseClients = 0;

  function stopAll(): void {
    for (const id of activeProviders) {
      if (!pinned.has(id)) registry.get(id)?.stop?.(ctx);
    }
    activeProviders.clear();
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }

  function resetInactivityTimer(): void {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(stopAll, config.inactivityTimeoutMs);
    if (typeof inactivityTimer.unref === 'function') inactivityTimer.unref();
  }

  function ensureActive(id: PanelId): void {
    if (!activeProviders.has(id)) {
      registry.get(id)?.start?.(ctx);
      activeProviders.add(id);
    }
    resetInactivityTimer();
  }

  function sendJson(res: ServerResponse, status: number, envelope: ApiEnvelope<unknown>): void {
    const body = serializeEnvelope(envelope, config.maskSecrets);
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  function notFound(res: ServerResponse): void {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: 'Not found' } });
  }

  function isUnderPath(urlPath: string): boolean {
    return urlPath === path || urlPath.startsWith(`${path}/`);
  }

  async function servePanel(
    res: ServerResponse,
    id: PanelId,
    query?: Record<string, string>,
  ): Promise<void> {
    ensureActive(id);
    const provider = registry.get(id);
    if (!provider) return notFound(res);
    const requestCtx = query ? { ...ctx, query } : ctx;
    sendJson(res, ...(await readPanel(provider, requestCtx)));
  }

  /** Runs a provider, converting a throw or rejection into an error envelope. */
  async function readPanel(
    provider: NodeUIProvider,
    requestCtx: ProviderContext,
  ): Promise<[number, ProviderResult<unknown>]> {
    try {
      const result = (await provider.get(requestCtx)) as ProviderResult<unknown>;
      return [result.ok ? 200 : 500, result];
    } catch (err) {
      return [
        500,
        {
          ok: false,
          error: {
            code: 'provider-failed',
            message: err instanceof Error ? err.message : 'provider failed',
          },
        },
      ];
    }
  }

  function configData(): ConfigData {
    return {
      enabled: config.enabled,
      activationReason: config.activationReason,
      path: config.path,
      host: config.host,
      port: config.port,
      requestLogSize: config.requestLogSize,
      logSize: config.logSize,
      pollIntervalMs: config.pollIntervalMs,
      panels: registry.ids(),
      masking: { enabled: config.maskSecrets, pattern: SECRET_KEY_PATTERN.source },
      locked: config.authRequired,
      plugins: pluginMeta,
    };
  }

  function issueConfirmation(res: ServerResponse): void {
    const issued: ConfirmIssued = confirmations.issue();
    sendJson(res, 200, { ok: true, data: issued });
  }

  /** Consumes the one-time `x-nodeui-confirm` nonce, or answers 409 and returns false. */
  function requireConfirmation(req: IncomingMessage, res: ServerResponse): boolean {
    const header = req.headers['x-nodeui-confirm'];
    const nonce = Array.isArray(header) ? header[0] : header;
    if (typeof nonce === 'string' && confirmations.consume(nonce)) return true;
    sendJson(res, 409, {
      ok: false,
      error: {
        code: 'confirmation-required',
        message:
          'This mutating action needs a fresh confirmation nonce. Issue one via ' +
          'POST ' +
          `${path}/api/confirmations` +
          ' and repeat the request with an x-nodeui-confirm header.',
      },
    });
    return false;
  }

  /** Starting a load test fires real requests at the app, so it needs a confirmation nonce. */
  async function handleLoadTestAction(
    req: IncomingMessage,
    res: ServerResponse,
    action: string,
  ): Promise<void> {
    try {
      if (action === 'start') {
        const body = await readJsonBody(req, REPLAY_BODY_LIMIT);
        if (!requireConfirmation(req, res)) return;
        sendJson(res, 200, { ok: true, data: loadGen.startTest(appTarget, body) });
      } else {
        sendJson(res, 200, { ok: true, data: loadGen.stopTest() });
      }
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        error: { code: 'loadtest-failed', message: err instanceof Error ? err.message : 'failed' },
      });
    }
  }

  /** Starting a profile is mutating, so it needs a confirmation nonce; stopping is harmless. */
  async function handleProfileAction(
    req: IncomingMessage,
    res: ServerResponse,
    action: string,
  ): Promise<void> {
    try {
      if (action === 'start') {
        const body = await readJsonBody(req);
        if (!requireConfirmation(req, res)) return;
        sendJson(res, 200, {
          ok: true,
          data: await cpuProfile.startProfile(Number(body.seconds)),
        });
      } else {
        sendJson(res, 200, { ok: true, data: await cpuProfile.stopProfile() });
      }
    } catch (err) {
      sendJson(res, 409, {
        ok: false,
        error: { code: 'profile-failed', message: err instanceof Error ? err.message : 'failed' },
      });
    }
  }

  async function handleAnnotationAction(
    req: IncomingMessage,
    res: ServerResponse,
    action: string,
  ): Promise<void> {
    try {
      const body = await readJsonBody(req);
      if (action === 'add') {
        const at = Number(body.atMs);
        sendJson(res, 200, {
          ok: true,
          data: annotations.add(
            String(body.label ?? ''),
            'note',
            Number.isFinite(at) && at > 0 ? at : undefined,
          ),
        });
      } else {
        sendJson(res, 200, { ok: true, data: { removed: annotations.remove(Number(body.id)) } });
      }
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        error: { code: 'bad-request', message: err instanceof Error ? err.message : 'invalid' },
      });
    }
  }

  async function handleAlertAction(
    req: IncomingMessage,
    res: ServerResponse,
    action: string,
  ): Promise<void> {
    try {
      const body = await readJsonBody(req);
      if (action === 'add') {
        sendJson(res, 200, { ok: true, data: alerts.addRule(body as unknown as AlertRuleInput) });
      } else {
        sendJson(res, 200, { ok: true, data: { removed: alerts.removeRule(Number(body.id)) } });
      }
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        error: { code: 'bad-request', message: err instanceof Error ? err.message : 'invalid' },
      });
    }
  }

  /** Re-sends a captured (and possibly edited) request to the app itself. */
  async function handleReplay(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req, REPLAY_BODY_LIMIT);
      normalizeReplayRequest(body);
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        error: {
          code: 'bad-request',
          message: err instanceof Error ? err.message : 'invalid request',
        },
      });
      return;
    }
    if (!requireConfirmation(req, res)) return;
    try {
      const result = await replayRequest(appTarget, body);
      sendJson(res, 200, { ok: true, data: result });
    } catch (err) {
      const code = err instanceof ReplayError ? err.code : 'replay-failed';
      sendJson(res, code === 'upstream-error' ? 502 : 400, {
        ok: false,
        error: { code, message: err instanceof Error ? err.message : 'replay failed' },
      });
    }
  }

  async function takeHeapSnapshot(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!requireConfirmation(req, res)) return;
    const heapProvider = registry.get('heap-snapshot');
    if (!heapProvider || !('takeSnapshot' in heapProvider)) return notFound(res);
    const result = (await (heapProvider as HeapSnapshotProvider).takeSnapshot(
      ctx,
    )) as ProviderResult<HeapSnapshotData>;
    sendJson(res, result.ok ? 200 : 500, result);
  }

  async function readJsonBody(
    req: IncomingMessage,
    limit = 8192,
  ): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > limit) throw new Error('request body too large');
      chunks.push(buf);
    }
    if (size === 0) return {};
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  }

  async function handleRunAction(
    req: IncomingMessage,
    res: ServerResponse,
    action: string,
  ): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req, action === 'import' ? RUNS_IMPORT_LIMIT : 8192);
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        error: {
          code: 'bad-request',
          message: err instanceof Error ? err.message : 'invalid JSON body',
        },
      });
      return;
    }
    if (action === 'import') {
      try {
        sendJson(res, 200, { ok: true, data: { imported: timeSeries.importRuns(body).length } });
      } catch (err) {
        sendJson(res, 400, {
          ok: false,
          error: { code: 'bad-request', message: err instanceof Error ? err.message : 'invalid' },
        });
      }
      return;
    }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (action === 'start') {
      sendJson(res, 200, { ok: true, data: timeSeries.startRun(name) });
    } else if (action === 'stop') {
      const run = timeSeries.stopRun();
      if (!run) {
        sendJson(res, 409, {
          ok: false,
          error: { code: 'not-recording', message: 'No run is being recorded' },
        });
        return;
      }
      sendJson(res, 200, { ok: true, data: run });
    } else if (action === 'save') {
      const fromMs = Number(body.fromMs);
      const toMs = Number(body.toMs);
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
        sendJson(res, 400, {
          ok: false,
          error: { code: 'bad-request', message: 'fromMs and toMs must define a valid range' },
        });
        return;
      }
      sendJson(res, 200, { ok: true, data: timeSeries.saveRange(name, fromMs, toMs) });
    } else if (action === 'delete') {
      sendJson(res, 200, { ok: true, data: { deleted: timeSeries.deleteRun(Number(body.id)) } });
    } else if (action === 'baseline') {
      const id = body.id === null || body.id === undefined ? null : Number(body.id);
      if (!timeSeries.setBaseline(id)) {
        sendJson(res, 404, {
          ok: false,
          error: { code: 'not-found', message: 'No saved run has that id' },
        });
        return;
      }
      sendJson(res, 200, { ok: true, data: { baselineId: id } });
    } else if (action === 'reset-routes') {
      routeMetrics.reset();
      sendJson(res, 200, { ok: true, data: { reset: true } });
    } else {
      notFound(res);
    }
  }

  async function handleLive(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const search = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const requested = (search.get('panels') ?? '').split(',').filter(Boolean);
    const panels = (
      requested.length > 0
        ? requested.filter((id): id is PanelId => registry.get(id as PanelId) !== undefined)
        : registry.ids()
    ).filter((value, index, self) => self.indexOf(value) === index);

    if (panels.length === 0) return notFound(res);

    if (sseClients >= config.maxSseClients) {
      res.writeHead(429, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: { code: 'too-many-streams', message: 'too many open live streams' },
        }),
      );
      return;
    }
    sseClients += 1;
    const stream = startSse(res, SECURITY_HEADERS);
    const push = async (): Promise<void> => {
      for (const id of panels) {
        ensureActive(id);
        const provider = registry.get(id);
        if (!provider) continue;
        const [, result] = await readPanel(provider, ctx);
        stream.send({ panel: id, envelope: config.maskSecrets ? maskSecrets(result) : result });
      }
    };
    void push().catch(() => undefined);
    const pushTimer = setInterval(() => void push().catch(() => undefined), config.pollIntervalMs);
    const heartbeatTimer = setInterval(() => stream.heartbeat(), SSE_HEARTBEAT_MS);
    if (typeof pushTimer.unref === 'function') pushTimer.unref();
    if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      sseClients -= 1;
      clearInterval(pushTimer);
      clearInterval(heartbeatTimer);
      stream.close();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  }

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    apiPath: string,
  ): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'GET' && apiPath === '/config') {
      sendJson(res, 200, { ok: true, data: configData() });
      return;
    }
    if (method === 'GET' && apiPath === '/live') {
      return handleLive(req, res);
    }
    if (method === 'GET' && apiPath === '/runs') {
      sendJson(res, 200, {
        ok: true,
        data: { ...timeSeries.listRuns(), persisted: runStore !== null },
      });
      return;
    }
    if (method === 'GET' && apiPath === '/runs/export') {
      const payload = JSON.stringify(timeSeries.snapshotRuns());
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="nodeui-runs.json"',
        'Content-Length': Buffer.byteLength(payload),
        'Cache-Control': 'no-store',
      });
      res.end(payload);
      return;
    }
    if (method === 'GET' && apiPath === '/prometheus') {
      const body = timeSeries.prometheus({ uptimeSeconds: process.uptime() });
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }
    if (method === 'GET') {
      const panel = registry.get(apiPath.slice(1) as PanelId);
      if (panel) {
        const query = Object.fromEntries(new URL(req.url ?? '/', 'http://localhost').searchParams);
        return servePanel(res, panel.id, query);
      }
    }
    if (method === 'POST') {
      if (apiPath === '/confirmations') {
        issueConfirmation(res);
        return;
      }
      if (apiPath === '/heap-snapshot') {
        return takeHeapSnapshot(req, res);
      }
      if (apiPath === '/replay') {
        return handleReplay(req, res);
      }
      if (apiPath === '/loadtest/start' || apiPath === '/loadtest/stop') {
        return handleLoadTestAction(req, res, apiPath.slice('/loadtest/'.length));
      }
      if (apiPath === '/cpu-profile/start' || apiPath === '/cpu-profile/stop') {
        return handleProfileAction(req, res, apiPath.slice('/cpu-profile/'.length));
      }
      if (apiPath === '/annotations/add' || apiPath === '/annotations/remove') {
        return handleAnnotationAction(req, res, apiPath.slice('/annotations/'.length));
      }
      if (apiPath === '/alerts/add' || apiPath === '/alerts/remove') {
        return handleAlertAction(req, res, apiPath.slice('/alerts/'.length));
      }
      if (apiPath.startsWith('/runs/')) {
        return handleRunAction(req, res, apiPath.slice('/runs/'.length));
      }
    }
    notFound(res);
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, urlPath: string): void {
    const relative = urlPath.slice(path.length);
    const asset = resolveStaticAsset(uiAssetsDir(), relative);
    if (!asset) {
      sendJson(res, 404, { ok: false, error: { code: 'not-found', message: 'Not found' } });
      return;
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Security-Policy': CSP,
      'Content-Type': asset.contentType,
      'Content-Length': asset.length,
      'Cache-Control': 'no-cache',
    });
    asset.content.pipe(res);
  }

  async function handleNodeUIPath(
    req: IncomingMessage,
    res: ServerResponse,
    urlPath: string,
  ): Promise<void> {
    const verdict = guard(req);
    if (!verdict.ok) {
      sendJson(res, verdict.status, {
        ok: false,
        error: { code: verdict.code, message: verdict.message },
      });
      return;
    }
    if (verdict.setToken !== undefined) {
      res.writeHead(302, {
        ...SECURITY_HEADERS,
        'Set-Cookie': `${AUTH_COOKIE}=${encodeURIComponent(verdict.setToken)}; Path=${path}; HttpOnly; SameSite=Strict`,
        Location: `${path}/`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    const apiBase = `${path}/api`;
    if (urlPath === apiBase || urlPath.startsWith(`${apiBase}/`)) {
      await handleApi(req, res, urlPath.slice(apiBase.length));
      return;
    }
    serveStatic(req, res, urlPath);
  }

  function captureRouter(req: IncomingMessage): void {
    if (ctx.store['express-router'] !== undefined) return;
    const app = (req as IncomingMessage & { app?: { _router?: unknown; router?: unknown } }).app;
    if (!app) return;
    let router: unknown;
    try {
      // Express 4 and 5 both expose the router on `_router` once the app has
      // handled a request. Reading it directly avoids Express 4's deprecated
      // `app.router` getter, which throws on access.
      router = app._router;
    } catch {
      router = undefined;
    }
    if (router === undefined) {
      try {
        router = app.router;
      } catch {
        router = undefined;
      }
    }
    if (router) {
      ctx.store['express-router'] = router;
    }
  }

  /** Matched route pattern: Express exposes `req.route`, adapters may set `nodeuiRoute`. */
  function routePatternOf(req: IncomingMessage): string | undefined {
    const r = req as IncomingMessage & {
      nodeuiRoute?: unknown;
      route?: { path?: unknown };
      baseUrl?: unknown;
    };
    if (typeof r.nodeuiRoute === 'string') return r.nodeuiRoute;
    const path = r.route?.path;
    if (typeof path !== 'string') return undefined;
    return `${typeof r.baseUrl === 'string' ? r.baseUrl : ''}${path}` || undefined;
  }

  const readMarks = new WeakMap<object, number>();
  /** Address the app listens on, learned from its own sockets (never from user input). */
  let appTarget: ReplayTarget | null = null;

  function recordAppRequest(req: IncomingMessage, res: ServerResponse): number {
    const started = process.hrtime.bigint();
    const timestampMs = Date.now();
    const requestId = requestsProvider.reserveId();
    bindRequestId(req, requestId);
    const collectDetail = captureRequestDetail(req, res, config.requestDetail, config.maskSecrets);
    const socket = req.socket;
    if (socket?.localPort) {
      const local = socket.localAddress;
      appTarget = {
        host: local && isLoopbackAddress(local) ? local : '127.0.0.1',
        port: socket.localPort,
      };
    }
    // Headers are parsed before this hook runs, so count request bytes since the
    // previous response on this keep-alive socket finished.
    const readAtStart = (socket && readMarks.get(socket)) ?? 0;
    const wroteAtStart = socket?.bytesWritten ?? 0;
    timeSeries.requestStarted();
    let settled = false;
    res.on('close', () => {
      if (!settled) {
        settled = true;
        timeSeries.requestAborted();
      }
    });
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (!settled) {
        settled = true;
        const readNow = socket?.bytesRead ?? 0;
        if (socket) readMarks.set(socket, readNow);
        timeSeries.requestFinished(
          res.statusCode,
          durationMs,
          Math.max(0, readNow - readAtStart),
          Math.max(0, (socket?.bytesWritten ?? 0) - wroteAtStart),
        );
      }
      const route = routePatternOf(req);
      routeMetrics.record(
        req.method ?? '?',
        pathnameOf(req),
        route,
        res.statusCode,
        durationMs,
        Math.max(0, (socket?.bytesWritten ?? 0) - wroteAtStart),
      );
      requestsProvider.record(
        {
          method: req.method ?? '?',
          path: pathnameOf(req),
          status: res.statusCode,
          durationMs,
          timestampMs,
          ip: req.socket.remoteAddress ?? 'unknown',
          route,
          ...collectDetail(),
        },
        requestId,
      );
      metricsProvider.record(res.statusCode);
    });
    return requestId;
  }

  const server: NodeUIServer = {
    get config() {
      return config;
    },
    get active() {
      return config.enabled;
    },
    get activationReason() {
      return config.activationReason;
    },
    middleware(): NodeUIMiddleware {
      return (req, res, next) => {
        captureRouter(req);
        if (!config.enabled) {
          next();
          return;
        }
        const urlPath = pathnameOf(req);
        if (isUnderPath(urlPath)) {
          void handleNodeUIPath(req, res, urlPath);
          return;
        }
        const requestId = recordAppRequest(req, res);
        runWithRequestId(requestId, next);
      };
    },
    async handle(req, res): Promise<void> {
      captureRouter(req);
      if (!config.enabled) {
        notFound(res);
        return;
      }
      const urlPath = pathnameOf(req);
      if (isUnderPath(urlPath)) {
        await handleNodeUIPath(req, res, urlPath);
        return;
      }
      notFound(res);
    },
    setRoutes(source): void {
      ctx.store['routes-source'] = source;
    },
    annotate(label: string): void {
      try {
        annotations.add(label, 'app');
      } catch {
        // an empty label is ignored
      }
    },
    mark(name: string): void {
      startupTracker.mark(name);
    },
    isProviderActive(id: PanelId): boolean {
      return activeProviders.has(id);
    },
    addLogSource(entry: { level: LogLevel; message: string }): void {
      logsProvider.addSource(entry);
    },
    recordQuery(query): void {
      if (!config.enabled) return;
      queriesProvider.record({
        ...query,
        sql: query.sql.slice(0, 2000),
        timestampMs: Date.now() - query.durationMs,
        requestId: currentRequestId(),
      });
    },
    trackPrisma(client): void {
      if (!config.enabled) return;
      client.$on('query', (e) =>
        server.recordQuery({ system: 'prisma', sql: e.query, durationMs: Number(e.duration) }),
      );
    },
    recordError(error, context): void {
      if (!config.enabled) return;
      // Client errors (e.g. http-errors 404) are expected outcomes, not failures.
      const e = error as { status?: unknown; statusCode?: unknown } | null;
      const status = e?.status ?? e?.statusCode;
      if (typeof status === 'number' && status >= 400 && status < 500) return;
      errorsProvider.record(error, 'request', context);
    },
    shutdown(): void {
      errorsProvider.detach();
      timeSeries.stop();
      alerts.stop();
      cpuProfile.stop();
      loadGen.stop();
      runStore?.close();
      persistence?.close();
      exporter?.close();
      for (const id of pinned) registry.get(id)?.stop?.(ctx);
      pinned.clear();
      stopAll();
    },
  };

  return server;
}
