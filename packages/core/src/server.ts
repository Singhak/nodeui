import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
} from './safety';
import { AUTH_COOKIE, createGuard } from './guard';
import { ConfirmationStore } from './confirmations';
import { DEFAULT_LOG_SIZE } from './constants';
import { startSse } from './sse';
import { ProviderRegistry } from './registry';
import { resolveStaticAsset } from './static';
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

const STATIC_ROOT = resolve(__dirname, '..', 'static');

const SSE_HEARTBEAT_MS = 15_000;

/**
 * Serializes an API envelope to JSON, applying secret masking so values
 * under keys like `TOKEN`/`KEY`/`SECRET`/`PASSWORD` never reach the UI.
 */
export function serializeEnvelope<T>(envelope: ApiEnvelope<T>, mask = true): string {
  return JSON.stringify(mask ? maskSecrets(envelope) : envelope);
}

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
]);
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const RESERVED_API_NAMES = new Set(['config', 'live', 'confirmations']);

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
    persistFile:
      (typeof options.persist === 'string' ? options.persist : options.persist?.file) ??
      env.NODEUI_PERSIST_FILE ??
      null,
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
    for (const provider of [outgoingProvider, queriesProvider]) {
      provider.start();
      pinned.add(provider.id);
    }
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

  async function takeHeapSnapshot(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers['x-nodeui-confirm'];
    const nonce = Array.isArray(header) ? header[0] : header;
    if (typeof nonce !== 'string' || !confirmations.consume(nonce)) {
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
      return;
    }
    const heapProvider = registry.get('heap-snapshot');
    if (!heapProvider || !('takeSnapshot' in heapProvider)) return notFound(res);
    const result = (await (heapProvider as HeapSnapshotProvider).takeSnapshot(
      ctx,
    )) as ProviderResult<HeapSnapshotData>;
    sendJson(res, result.ok ? 200 : 500, result);
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
    }
    notFound(res);
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, urlPath: string): void {
    const relative = urlPath.slice(path.length);
    const asset = resolveStaticAsset(STATIC_ROOT, relative);
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

  function recordAppRequest(req: IncomingMessage, res: ServerResponse): number {
    const started = process.hrtime.bigint();
    const timestampMs = Date.now();
    const requestId = requestsProvider.reserveId();
    bindRequestId(req, requestId);
    const collectDetail = captureRequestDetail(req, res, config.requestDetail, config.maskSecrets);
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      requestsProvider.record(
        {
          method: req.method ?? '?',
          path: pathnameOf(req),
          status: res.statusCode,
          durationMs,
          timestampMs,
          ip: req.socket.remoteAddress ?? 'unknown',
          route: routePatternOf(req),
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
      persistence?.close();
      exporter?.close();
      for (const id of pinned) registry.get(id)?.stop?.(ctx);
      pinned.clear();
      stopAll();
    },
  };

  return server;
}
