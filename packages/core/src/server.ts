import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
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
  StartupData,
} from './types';
import { maskSecrets, resolveActivation, SECRET_KEY_PATTERN } from './safety';
import { isLoopbackAddress } from './safety';
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
import { StartupTracker } from './providers/startup-tracker';
import { RequestsProvider } from './providers/requests';
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
  /** Idle time after which background samplers stop. Default 60000. */
  inactivityTimeoutMs?: number;
  /** TTL for mutation confirmation nonces. Default 60000. */
  confirmTtlMs?: number;
  /** Directory for heap snapshot files. Defaults to the OS temp dir. */
  heapSnapshotDir?: string;
}

export interface NodeUIServer {
  readonly config: NodeUIConfig;
  readonly active: boolean;
  readonly activationReason: string;
  /** Express/Nest compatible middleware that serves the console and API. */
  middleware(): NodeUIMiddleware;
  /** Direct request handling (no `next`); used for tests and adapters. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** Records a bootstrap timing mark, e.g. `mark("listening")`. */
  mark(name: string): void;
  /** Whether a background-sampling provider is currently running. */
  isProviderActive(id: PanelId): boolean;
  /** Pushes an external log entry into the log viewer (logger adapter). */
  addLogSource(entry: { level: LogLevel; message: string }): void;
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
export function serializeEnvelope<T>(envelope: ApiEnvelope<T>): string {
  return JSON.stringify(maskSecrets(envelope));
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
    heapSnapshotDir: options.heapSnapshotDir ?? env.NODEUI_HEAP_SNAPSHOT_DIR ?? tmpdir(),
  };

  if (!isLoopbackAddress(config.host)) {
    console.warn(
      `[nodeui] NODEUI_HOST is set to non-loopback "${config.host}". ` +
        'The developer console will be reachable from other hosts; only do this deliberately.',
    );
  }

  const ctx: ProviderContext = { config, env, store: {} };
  if (options.config !== undefined) {
    ctx.store['app-config'] = options.config;
  }
  const registry = new ProviderRegistry();
  registry.register(new HealthProvider());
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

  const confirmations = new ConfirmationStore(config.confirmTtlMs);
  const activeProviders = new Set<PanelId>();
  let inactivityTimer: NodeJS.Timeout | null = null;

  function stopAll(): void {
    for (const id of activeProviders) {
      registry.get(id)?.stop?.(ctx);
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
    const body = serializeEnvelope(envelope);
    res.writeHead(status, {
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
    const result = (await provider.get(requestCtx)) as ProviderResult<unknown>;
    sendJson(res, result.ok ? 200 : 500, result);
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

    const stream = startSse(res);
    const push = async (): Promise<void> => {
      for (const id of panels) {
        ensureActive(id);
        const provider = registry.get(id);
        if (!provider) continue;
        const result = (await provider.get(ctx)) as ProviderResult<unknown>;
        stream.send({ panel: id, envelope: result });
      }
    };
    void push();
    const pushTimer = setInterval(() => void push(), config.pollIntervalMs);
    const heartbeatTimer = setInterval(() => stream.heartbeat(), SSE_HEARTBEAT_MS);
    if (typeof pushTimer.unref === 'function') pushTimer.unref();
    if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

    const cleanup = (): void => {
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
      'Content-Type': asset.contentType,
      'Content-Length': asset.length,
      'Cache-Control': 'no-cache',
    });
    asset.content.pipe(res);
  }

  function guardLoopback(req: IncomingMessage, res: ServerResponse): boolean {
    if (isLoopbackAddress(config.host)) {
      const remote = req.socket.remoteAddress;
      if (!isLoopbackAddress(remote)) {
        sendJson(res, 403, {
          ok: false,
          error: {
            code: 'forbidden',
            message: 'nodeui is loopback-only; requests from other hosts are rejected',
          },
        });
        return false;
      }
    }
    return true;
  }

  async function handleNodeUIPath(
    req: IncomingMessage,
    res: ServerResponse,
    urlPath: string,
  ): Promise<void> {
    if (!guardLoopback(req, res)) return;
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

  function recordAppRequest(req: IncomingMessage, res: ServerResponse): void {
    const started = process.hrtime.bigint();
    const timestampMs = Date.now();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      requestsProvider.record({
        method: req.method ?? '?',
        path: pathnameOf(req),
        status: res.statusCode,
        durationMs,
        timestampMs,
        ip: req.socket.remoteAddress ?? 'unknown',
      });
      metricsProvider.record(res.statusCode);
    });
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
        recordAppRequest(req, res);
        next();
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
    mark(name: string): void {
      startupTracker.mark(name);
    },
    isProviderActive(id: PanelId): boolean {
      return activeProviders.has(id);
    },
    addLogSource(entry: { level: LogLevel; message: string }): void {
      logsProvider.addSource(entry);
    },
    shutdown(): void {
      stopAll();
    },
  };

  return server;
}
