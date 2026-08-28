# NodeUI Phase 1 — Observability Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SSE live push, env/config viewer, route listing, RPS/error chart, log viewer, and per-panel JSON/CSV export to the existing NodeUI console.

**Architecture:** Four new core providers (`env`, `routes`, `logs`, `metrics`) plus a native SSE endpoint, all reusing the existing envelope contract, lazy lifecycle, loopback guard, and secret masking. The UI adds an SSE client with REST-polling fallback, four new/upgraded panels, and export helpers.

**Tech Stack:** Node 22, TypeScript 5.9 (strict, no `any`), Vitest 3, Express 5, NestJS 11, React 19 + Vite 8.

## Global Constraints

- Strict TS, no `any`, JSDoc on public API (see `code-quality-standards.md`).
- No emoji anywhere (code or docs).
- ESLint flat config: `no-console` allows only `warn`/`error` except `apps/demo-*` (off); `globals.node` applies to `*.mjs`/`scripts/**`.
- Prettier: 100 cols, singleQuote, trailingComma all.
- Provider contract: `{ ok: true; data: T } | { ok: false; error: { code; message } }`; providers never throw.
- Loopback-only (403 for non-loopback), fail-closed in production.
- `SECRET_KEY_PATTERN = /token|key|secret|password|credential/i` → `[REDACTED]` via `maskSecrets` at serialization.
- Root scripts: `npm run build` / `typecheck` / `test` / `lint` / `format:check` must all pass at the end.
- Vitest 3 requires explicit imports (no globals).
- Do not upgrade typescript (pinned 5.9.3).
- No delete operations; use `/tmp/opencode` for stray files.

---

### Task 1: Extend shared types, config, and constants for the new features

**Files:**

- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/server.ts`
- Modify: `packages/core/src/constants.ts`
- Modify: `packages/core/test/providers.test.ts:15-37` (makeConfig)
- Test: `packages/core/test/server.test.ts`

**Interfaces:**

- Consumes: existing `PanelId`, `NodeUIConfig`, `ConfigData`, `NodeUIOptions`, `ProviderContext`.
- Produces: new `PanelId` members `'env' | 'routes' | 'logs' | 'metrics'`; new data types `EnvEntry`, `EnvData`, `RouteEntry`, `RoutesData`, `LogLevel`, `LogEntry`, `LogsData`, `MetricsBucket`, `MetricsData`; `NodeUIConfig.logSize`, `ConfigData.logSize`, `NodeUIOptions.logSize` + `NodeUIOptions.config`; `ProviderContext.query?: Record<string, string>`.

- [ ] **Step 1: Add new panel and data types to `packages/core/src/types.ts`**

```ts
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
```

Add after `RequestEntry`:

```ts
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
```

Add `logSize` to `NodeUIConfig` (after `requestLogSize`):

```ts
/** Ring buffer capacity for the log viewer. Default 500. */
logSize: number;
```

Add `query` to `ProviderContext` (after `store`):

```ts
  /** Query parameters of the current API request (e.g. `?level=`). */
  query?: Record<string, string>;
```

Add `logSize` and `config` to `ConfigData`:

```ts
requestLogSize: number;
logSize: number;
pollIntervalMs: number;
```

- [ ] **Step 2: Add `logSize` default constant to `packages/core/src/constants.ts`**

```ts
/** Replacement value used when masking secret values. */
export const SECRET_MASKED = '[REDACTED]';

/** Default ring buffer capacity for the log viewer. */
export const DEFAULT_LOG_SIZE = 500;
```

- [ ] **Step 3: Wire `logSize` + `config` into `packages/core/src/server.ts`**

Add to `NodeUIOptions` (after `requestLogSize`):

```ts
  /** Ring buffer capacity for the log viewer. Default 500. */
  logSize?: number;
  /** App config surfaced in the env panel; may be an object or a getter. */
  config?: unknown | (() => unknown);
```

In `createNodeUI`, after `requestLogSize`:

```ts
    logSize: positiveInt(
      options.logSize,
      env.NODEUI_LOG_SIZE ? Number(env.NODEUI_LOG_SIZE) : DEFAULT_LOG_SIZE,
      'NODEUI_LOG_SIZE',
    ),
```

Import `DEFAULT_LOG_SIZE` from `./constants`.

Set app config into the store (right after `const ctx: ProviderContext = { config, env, store: {} };`):

```ts
if (options.config !== undefined) {
  ctx.store['app-config'] = options.config;
}
```

In `configData()`, add `logSize: config.logSize,`.

- [ ] **Step 4: Update test helper `makeConfig` in `packages/core/test/providers.test.ts`**

Add `logSize: 500,` after `requestLogSize: 500,` in the returned object.

- [ ] **Step 5: Verify**

Run: `npm run typecheck -w @nodeui/core && npm run test -w @nodeui/core`
Expected: typecheck clean; all tests pass. (`ALL_PANELS` stays at its current 7-member value until Task 6 registers the new routes; no test references the new ids yet.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/constants.ts packages/core/src/server.ts packages/core/test/providers.test.ts
git commit -m "feat(core): add types and config for env/routes/logs/metrics panels"
```

---

### Task 2: MetricsProvider — per-second RPS/error buckets

**Files:**

- Create: `packages/core/src/providers/metrics.ts`
- Modify: `packages/core/src/providers/index.ts`
- Modify: `packages/core/src/server.ts` (record tick in `recordAppRequest`)
- Test: `packages/core/test/metrics.test.ts`

**Interfaces:**

- Consumes: `NodeUIProvider`, `MetricsData`, `MetricsBucket` from Task 1.
- Produces: `class MetricsProvider implements NodeUIProvider<MetricsData>` with `readonly id = 'metrics'`; `constructor(nowMs?: () => number)` (injectable clock for tests); `record(status: number): void`; `get(): { ok: true; data: MetricsData }` returning the last 60 one-second buckets zero-filled.

- [ ] **Step 1: Write the failing test `packages/core/test/metrics.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { MetricsProvider } from '../src/providers/metrics';

function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('MetricsProvider', () => {
  it('records requests and errors into the current second bucket', () => {
    const clock = makeClock();
    const provider = new MetricsProvider(clock.now);
    provider.record(200);
    provider.record(200);
    provider.record(500);
    const result = provider.get();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const last = result.data.buckets[result.data.buckets.length - 1];
    expect(last).toEqual({ ts: 0, requests: 3, errors: 1 });
  });

  it('zero-fills the 60-second window', () => {
    const clock = makeClock();
    const provider = new MetricsProvider(clock.now);
    clock.advance(59_000);
    provider.record(200);
    const result = provider.get();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.buckets).toHaveLength(60);
    expect(result.data.buckets[0]?.requests).toBe(0);
    expect(result.data.buckets[59]?.requests).toBe(1);
    expect(result.data.buckets[59]?.ts).toBe(59_000);
  });

  it('rolls over buckets as time advances', () => {
    const clock = makeClock();
    const provider = new MetricsProvider(clock.now);
    provider.record(200);
    clock.advance(1000);
    provider.record(500);
    const result = provider.get();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const buckets = result.data.buckets;
    expect(buckets[59]?.requests).toBe(1);
    expect(buckets[59]?.errors).toBe(1);
    expect(buckets[58]?.requests).toBe(1);
    expect(buckets[58]?.errors).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/metrics.test.ts`
Expected: FAIL with `Cannot find module '../src/providers/metrics'`.

- [ ] **Step 3: Implement `packages/core/src/providers/metrics.ts`**

```ts
import type { MetricsBucket, MetricsData, NodeUIProvider } from '../types';

const WINDOW_SECONDS = 60;

/**
 * Records one-second buckets of request counts and error counts, derived from
 * the request recorder in the server middleware. Errors are responses with
 * status >= 500.
 */
export class MetricsProvider implements NodeUIProvider<MetricsData> {
  readonly id = 'metrics' as const;

  private buckets: MetricsBucket[] = [];
  private readonly nowMs: () => number;

  constructor(nowMs: () => number = Date.now) {
    this.nowMs = nowMs;
  }

  /** Ticks the current second bucket for one completed request. */
  record(status: number): void {
    const ts = Math.floor(this.nowMs() / 1000) * 1000;
    const last = this.buckets[this.buckets.length - 1];
    if (last && last.ts === ts) {
      last.requests += 1;
      if (status >= 500) last.errors += 1;
      return;
    }
    this.buckets.push({ ts, requests: 1, errors: status >= 500 ? 1 : 0 });
    if (this.buckets.length > WINDOW_SECONDS + 1) {
      this.buckets.splice(0, this.buckets.length - WINDOW_SECONDS);
    }
  }

  get(): { ok: true; data: MetricsData } {
    const now = Math.floor(this.nowMs() / 1000) * 1000;
    const start = now - (WINDOW_SECONDS - 1) * 1000;
    const byTs = new Map<number, MetricsBucket>(this.buckets.map((b) => [b.ts, b]));
    const buckets: MetricsBucket[] = [];
    for (let ts = start; ts <= now; ts += 1000) {
      const existing = byTs.get(ts);
      buckets.push(existing ? { ...existing } : { ts, requests: 0, errors: 0 });
    }
    return { ok: true, data: { buckets } };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/metrics.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Export from `packages/core/src/providers/index.ts`**

Add after `RequestsProvider`:

```ts
export { MetricsProvider } from './metrics';
```

- [ ] **Step 6: Tick metrics from the request recorder in `packages/core/src/server.ts`**

Import `MetricsProvider`; instantiate `const metricsProvider = new MetricsProvider();` and `registry.register(metricsProvider);`. In `recordAppRequest`, inside the `res.on('finish')` callback after `requestsProvider.record(...)`:

```ts
metricsProvider.record(res.statusCode);
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/providers/metrics.ts packages/core/src/providers/index.ts packages/core/src/server.ts packages/core/test/metrics.test.ts
git commit -m "feat(core): add per-second metrics provider for rps and error rate"
```

---

### Task 3: EnvProvider — masked environment + optional app config

**Files:**

- Create: `packages/core/src/providers/env.ts`
- Modify: `packages/core/src/providers/index.ts`
- Test: `packages/core/test/env.test.ts`

**Interfaces:**

- Consumes: `EnvData`, `EnvEntry`, `NodeUIProvider`, `ProviderContext`; `ctx.store['app-config']` set by `createNodeUI` (Task 1).
- Produces: `class EnvProvider implements NodeUIProvider<EnvData>` with `readonly id = 'env'`; `get(ctx)` returns `{ ok: true; data: EnvData }` with sorted arrays; config resolved via getter when a function is stored.

- [ ] **Step 1: Write the failing test `packages/core/test/env.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { EnvProvider } from '../src/providers/env';
import type { NodeUIConfig, ProviderContext } from '../src/types';

function makeCtx(
  env: Record<string, string | undefined>,
  store: Record<string, unknown> = {},
): ProviderContext {
  const config: NodeUIConfig = {
    path: '/nodeui',
    host: '127.0.0.1',
    port: 3000,
    requestLogSize: 500,
    logSize: 500,
    pollIntervalMs: 2000,
    enabled: true,
    activationReason: 'test',
    maskSecrets: true,
    inactivityTimeoutMs: 60_000,
    confirmTtlMs: 60_000,
    heapSnapshotDir: '/tmp',
  };
  return { config, env, store };
}

describe('EnvProvider', () => {
  it('returns the environment sorted by key', () => {
    const provider = new EnvProvider();
    const result = provider.get(makeCtx({ ZETA: '1', ALPHA: '2', BETA: undefined }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.environment).toEqual([
      { key: 'ALPHA', value: '2' },
      { key: 'BETA', value: '' },
      { key: 'ZETA', value: '1' },
    ]);
    expect(result.data.config).toBeNull();
  });

  it('surfaces the app config from the store, resolving getters', () => {
    const provider = new EnvProvider();
    const ctx = makeCtx({}, { 'app-config': () => ({ name: 'demo', PORT: 3000 }) });
    const result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.config).toEqual([
      { key: 'PORT', value: '3000' },
      { key: 'name', value: 'demo' },
    ]);
  });

  it('stringifies non-string config values', () => {
    const provider = new EnvProvider();
    const ctx = makeCtx({}, { 'app-config': { nested: { deep: true } } });
    const result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.config?.[0]).toEqual({ key: 'nested', value: '{"deep":true}' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/env.test.ts`
Expected: FAIL with `Cannot find module '../src/providers/env'`.

- [ ] **Step 3: Implement `packages/core/src/providers/env.ts`**

```ts
import type { EnvData, EnvEntry, NodeUIProvider, ProviderContext } from '../types';

function stringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function toEntries(source: Record<string, unknown>): EnvEntry[] {
  return Object.entries(source)
    .map(([key, value]) => ({ key, value: stringify(value) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Environment and app-config viewer. The environment comes from the process
 * env snapshot; secret masking is applied later at serialization time.
 */
export class EnvProvider implements NodeUIProvider<EnvData> {
  readonly id = 'env' as const;

  get(ctx: ProviderContext): { ok: true; data: EnvData } {
    const environment = toEntries(ctx.env as Record<string, unknown>);
    const rawConfig = ctx.store['app-config'];
    let config: EnvEntry[] | null = null;
    if (rawConfig !== undefined) {
      const resolved = typeof rawConfig === 'function' ? rawConfig() : rawConfig;
      if (resolved !== undefined && resolved !== null) {
        config = toEntries(resolved as Record<string, unknown>);
      }
    }
    return { ok: true, data: { environment, config } };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/env.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Export from `packages/core/src/providers/index.ts`**

Add: `export { EnvProvider } from './env';`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/providers/env.ts packages/core/src/providers/index.ts packages/core/test/env.test.ts
git commit -m "feat(core): add environment and app-config viewer provider"
```

---

### Task 4: RoutesProvider — Express router introspection

**Files:**

- Create: `packages/core/src/providers/routes.ts`
- Modify: `packages/core/src/providers/index.ts`
- Modify: `packages/core/src/server.ts` (capture `req.app._router` in middleware/handle)
- Test: `packages/core/test/routes.test.ts`

**Interfaces:**

- Consumes: `RoutesData`, `RouteEntry`, `NodeUIProvider`, `ProviderContext`; `ctx.store['express-router']` set by the server from `req.app._router`.
- Produces: `export function extractRoutes(router: unknown): RouteEntry[]` (recursive walk, dedup by method+path, sorted); `class RoutesProvider` with `readonly id = 'routes'` returning `{ ok: true; data: RoutesData }` or `{ ok: false; error: { code: 'router-unavailable', message } }` when no router was captured.

- [ ] **Step 1: Write the failing test `packages/core/test/routes.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { extractRoutes, RoutesProvider } from '../src/providers/routes';
import type { NodeUIConfig, ProviderContext } from '../src/types';

function makeCtx(store: Record<string, unknown> = {}): ProviderContext {
  const config: NodeUIConfig = {
    path: '/nodeui',
    host: '127.0.0.1',
    port: 3000,
    requestLogSize: 500,
    logSize: 500,
    pollIntervalMs: 2000,
    enabled: true,
    activationReason: 'test',
    maskSecrets: true,
    inactivityTimeoutMs: 60_000,
    confirmTtlMs: 60_000,
    heapSnapshotDir: '/tmp',
  };
  return { config, env: {}, store };
}

function layer(route: { path: string; methods: Record<string, boolean>; handler: string }) {
  return {
    name: 'bound dispatch',
    route: {
      path: route.path,
      methods: route.methods,
      stack: [{ handle: { name: route.handler } }],
    },
  };
}

describe('extractRoutes', () => {
  it('walks the router stack and extracts method, path, and handler', () => {
    const stack = [
      { name: 'query', handle: () => undefined },
      layer({ path: '/hello', methods: { get: true }, handler: 'helloHandler' }),
      layer({ path: '/users/:id', methods: { get: true, post: true }, handler: 'userHandler' }),
    ];
    const routes = extractRoutes({ stack });
    expect(routes).toEqual([
      { method: 'GET', path: '/hello', handler: 'helloHandler' },
      { method: 'GET', path: '/users/:id', handler: 'userHandler' },
      { method: 'POST', path: '/users/:id', handler: 'userHandler' },
    ]);
  });

  it('recurses into nested routers with the mount prefix', () => {
    const stack = [
      {
        name: 'router',
        path: '/api',
        handle: {
          stack: [layer({ path: '/v1', methods: { get: true }, handler: 'v1Handler' })],
        },
      },
    ];
    const routes = extractRoutes({ stack });
    expect(routes).toEqual([{ method: 'GET', path: '/api/v1', handler: 'v1Handler' }]);
  });

  it('deduplicates identical method+path entries', () => {
    const stack = [
      layer({ path: '/x', methods: { get: true }, handler: 'a' }),
      layer({ path: '/x', methods: { get: true }, handler: 'b' }),
    ];
    const routes = extractRoutes({ stack });
    expect(routes).toHaveLength(1);
  });

  it('is resilient to missing router structures', () => {
    expect(extractRoutes(undefined)).toEqual([]);
    expect(extractRoutes({ stack: 'nope' })).toEqual([]);
  });
});

describe('RoutesProvider', () => {
  it('returns an error envelope when no router was captured', () => {
    const provider = new RoutesProvider();
    const result = provider.get(makeCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('router-unavailable');
  });

  it('returns routes from the captured router', () => {
    const provider = new RoutesProvider();
    const ctx = makeCtx({
      'express-router': {
        stack: [layer({ path: '/hello', methods: { get: true }, handler: 'helloHandler' })],
      },
    });
    const result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.routes).toEqual([
      { method: 'GET', path: '/hello', handler: 'helloHandler' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/routes.test.ts`
Expected: FAIL with `Cannot find module '../src/providers/routes'`.

- [ ] **Step 3: Implement `packages/core/src/providers/routes.ts`**

```ts
import type { NodeUIProvider, ProviderContext, RouteEntry, RoutesData } from '../types';

interface RouterLayer {
  name?: string;
  path?: string;
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack?: Array<{ handle?: { name?: string } }>;
  };
  handle?: { stack?: RouterLayer[] };
}

function joinPath(prefix: string, sub: string): string {
  if (!sub || sub === '/') return prefix || '/';
  return `${prefix.replace(/\/+$/, '')}/${sub.replace(/^\/+/, '')}`;
}

/**
 * Recursively walks an Express-style router stack, extracting concrete
 * method + path + handler entries. Middleware-only layers are skipped.
 */
export function extractRoutes(router: unknown): RouteEntry[] {
  const out: RouteEntry[] = [];
  const seen = new Set<string>();
  const stack = (router as { stack?: RouterLayer[] } | undefined)?.stack;
  if (!Array.isArray(stack)) return out;

  const walk = (layers: RouterLayer[], prefix: string): void => {
    for (const layer of layers) {
      if (!layer || typeof layer !== 'object') continue;
      if (layer.route && typeof layer.route.path === 'string') {
        const path = joinPath(prefix, layer.route.path);
        const methods = Object.entries(layer.route.methods ?? {})
          .filter(([, enabled]) => enabled)
          .map(([method]) => method.toUpperCase());
        const handler = layer.route.stack?.[0]?.handle?.name ?? 'anonymous';
        for (const method of methods) {
          const key = `${method} ${path}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ method, path, handler });
        }
        continue;
      }
      const nested = layer.handle?.stack;
      if (Array.isArray(nested)) {
        walk(nested, joinPath(prefix, layer.path ?? ''));
      }
    }
  };

  walk(stack, '');
  out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return out;
}

/**
 * Lists the HTTP routes of the host application by introspecting the Express
 * router captured from `req.app._router` on the first handled request.
 */
export class RoutesProvider implements NodeUIProvider<RoutesData> {
  readonly id = 'routes' as const;

  get(
    ctx: ProviderContext,
  ): { ok: true; data: RoutesData } | { ok: false; error: { code: string; message: string } } {
    const router = ctx.store['express-router'];
    if (!router) {
      return {
        ok: false,
        error: {
          code: 'router-unavailable',
          message: 'No Express router captured yet. Send at least one request through the app.',
        },
      };
    }
    return { ok: true, data: { routes: extractRoutes(router) } };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/routes.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Capture the Express router in `packages/core/src/server.ts`**

Add a helper inside `createNodeUI`:

```ts
function captureRouter(req: IncomingMessage): void {
  if (ctx.store['express-router'] !== undefined) return;
  const app = (req as IncomingMessage & { app?: { _router?: unknown } }).app;
  if (app && app._router) {
    ctx.store['express-router'] = app._router;
  }
}
```

Call `captureRouter(req)` at the top of the `middleware()` handler (before the enabled check) and at the top of `handle()`.

- [ ] **Step 6: Export from `packages/core/src/providers/index.ts`**

Add: `export { RoutesProvider, extractRoutes } from './routes';`

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/providers/routes.ts packages/core/src/providers/index.ts packages/core/src/server.ts packages/core/test/routes.test.ts
git commit -m "feat(core): add express router introspection provider"
```

---

### Task 5: LogsProvider — console interception + logger adapter

**Files:**

- Create: `packages/core/src/providers/logs.ts`
- Modify: `packages/core/src/providers/index.ts`
- Modify: `packages/core/src/server.ts` (register provider, add `addLogSource` to server + options)
- Modify: `packages/core/src/types.ts` (already added log types in Task 1)
- Modify: `packages/express/src/index.ts`, `packages/nestjs/src/nodeui.service.ts` (pass-through `addLogSource`)
- Test: `packages/core/test/logs.test.ts`

**Interfaces:**

- Consumes: `LogEntry`, `LogLevel`, `LogsData`, `NodeUIProvider`, `ProviderContext`, `RingBuffer`, `DEFAULT_LOG_SIZE`.
- Produces: `export function interceptConsole(push: (entry: Omit<LogEntry, 'timestamp'>) => void): () => void` (refcounted, restores originals on last release); `class LogsProvider` with `readonly id = 'logs'`, `start/stop` installing/removing the console tee, `addSource(entry)` for the adapter, and `get(ctx)` filtering by `ctx.query.level`/`ctx.query.query`; `NodeUIServer.addLogSource(entry: { level: LogLevel; message: string }): void`; `NodeUIOptions.logSize`.

- [ ] **Step 1: Write the failing test `packages/core/test/logs.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { LogsProvider } from '../src/providers/logs';
import type { NodeUIConfig, ProviderContext } from '../src/types';

function makeCtx(query: Record<string, string> = {}): ProviderContext {
  const config: NodeUIConfig = {
    path: '/nodeui',
    host: '127.0.0.1',
    port: 3000,
    requestLogSize: 500,
    logSize: 500,
    pollIntervalMs: 2000,
    enabled: true,
    activationReason: 'test',
    maskSecrets: true,
    inactivityTimeoutMs: 60_000,
    confirmTtlMs: 60_000,
    heapSnapshotDir: '/tmp',
  };
  return { config, env: {}, store: {}, query };
}

const original = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

afterEach(() => {
  console.log = original.log;
  console.info = original.info;
  console.warn = original.warn;
  console.error = original.error;
});

describe('LogsProvider', () => {
  it('captures console output while active and restores it on stop', () => {
    const provider = new LogsProvider();
    const ctx = makeCtx();
    provider.start(ctx);
    console.info('hello');
    console.error('boom', { code: 42 });
    const result = provider.get(ctx);
    provider.stop(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const messages = result.data.entries.map((e) => ({ level: e.level, message: e.message }));
    expect(messages).toContainEqual({ level: 'info', message: 'hello' });
    expect(messages).toContainEqual({ level: 'error', message: 'boom {"code":42}' });
    expect(console.log).toBe(original.log);
    expect(console.error).toBe(original.error);
  });

  it('filters by level and free-text query', () => {
    const provider = new LogsProvider();
    const ctx = makeCtx();
    provider.start(ctx);
    console.log('apple pie');
    console.warn('apple core');
    console.error('banana split');
    provider.stop(ctx);
    const levelResult = provider.get(makeCtx({ level: 'warn' }));
    if (!levelResult.ok) return;
    expect(levelResult.data.entries.map((e) => e.level)).toEqual(['warn']);
    const queryResult = provider.get(makeCtx({ query: 'APPLE' }));
    if (!queryResult.ok) return;
    expect(queryResult.data.entries.map((e) => e.message)).toEqual(['apple pie', 'apple core']);
  });

  it('does not intercept console when inactive', () => {
    const provider = new LogsProvider();
    const before = console.log;
    provider.get(makeCtx());
    expect(console.log).toBe(before);
  });

  it('accepts entries from the adapter addSource', () => {
    const provider = new LogsProvider();
    provider.addSource({ level: 'info', message: 'from adapter' });
    const result = provider.get(makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toEqual([
      expect.objectContaining({ level: 'info', message: 'from adapter' }),
    ]);
  });

  it('bounds the buffer to capacity', () => {
    const provider = new LogsProvider(3);
    provider.addSource({ level: 'debug', message: 'a' });
    provider.addSource({ level: 'debug', message: 'b' });
    provider.addSource({ level: 'debug', message: 'c' });
    provider.addSource({ level: 'debug', message: 'd' });
    const result = provider.get(makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries.map((e) => e.message)).toEqual(['b', 'c', 'd']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/logs.test.ts`
Expected: FAIL with `Cannot find module '../src/providers/logs'`.

- [ ] **Step 3: Implement `packages/core/src/providers/logs.ts`**

```ts
import type { LogEntry, LogLevel, LogsData, NodeUIProvider, ProviderContext } from '../types';
import { RingBuffer } from '../ring-buffer';

const CONSOLE_METHODS: Array<[keyof Console, LogLevel]> = [
  ['debug', 'debug'],
  ['info', 'info'],
  ['log', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
];

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  try {
    const json = JSON.stringify(arg);
    return json === undefined ? String(arg) : json;
  } catch {
    return String(arg);
  }
}

let refs = 0;
let originals: Partial<Record<keyof Console, (...args: unknown[]) => void>> = {};

function consoleRef(): Record<string, (...args: unknown[]) => void> {
  return console as unknown as Record<string, (...args: unknown[]) => void>;
}

/**
 * Wraps `console.debug/info/log/warn/error` to tee entries to `push`.
 * Refcounted: the first install replaces the methods, the last release
 * restores the originals. Never throws into the caller.
 */
export function interceptConsole(push: (entry: Omit<LogEntry, 'timestamp'>) => void): () => void {
  refs += 1;
  if (refs === 1) {
    originals = {};
    for (const [method, level] of CONSOLE_METHODS) {
      const original = consoleRef()[method];
      originals[method] = original;
      consoleRef()[method] = (...args: unknown[]) => {
        try {
          push({ level, message: args.map(formatArg).join(' ') });
        } catch {
          // interception must never throw into the caller
        }
        original(...args);
      };
    }
  }
  return () => {
    refs = Math.max(0, refs - 1);
    if (refs === 0) {
      for (const method of Object.keys(originals) as Array<keyof Console>) {
        const original = originals[method];
        if (original) consoleRef()[method] = original;
      }
      originals = {};
    }
  };
}

/**
 * Log viewer provider. While active it intercepts `console.*` output and
 * also accepts entries pushed via {@link addSource}. Filtering happens
 * server-side via `ctx.query.level` and `ctx.query.query`.
 */
export class LogsProvider implements NodeUIProvider<LogsData> {
  readonly id = 'logs' as const;

  private buffer: RingBuffer<LogEntry>;
  private release: (() => void) | null = null;

  constructor(size: number = DEFAULT_LOG_SIZE) {
    this.buffer = new RingBuffer<LogEntry>(size);
  }

  start(): void {
    if (this.release) return;
    this.release = interceptConsole(({ level, message }) => {
      this.buffer.push({ level, message, timestamp: Date.now() });
    });
  }

  stop(): void {
    this.release?.();
    this.release = null;
  }

  /** Pushes an external entry (logger adapter). */
  addSource(entry: { level: LogLevel; message: string }): void {
    this.buffer.push({ ...entry, timestamp: Date.now() });
  }

  get(ctx: ProviderContext): { ok: true; data: LogsData } {
    let entries = this.buffer.toArray();
    const level = ctx.query?.level;
    if (level) entries = entries.filter((e) => e.level === level);
    const query = ctx.query?.query;
    if (query) {
      const needle = query.toLowerCase();
      entries = entries.filter((e) => e.message.toLowerCase().includes(needle));
    }
    return { ok: true, data: { entries } };
  }
}
```

Note: `DEFAULT_LOG_SIZE` is imported from `../constants`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/logs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Export from `packages/core/src/providers/index.ts`**

Add: `export { LogsProvider, interceptConsole } from './logs';`

- [ ] **Step 6: Register the provider and add `addLogSource` in `packages/core/src/server.ts`**

Import `LogsProvider`. Instantiate `const logsProvider = new LogsProvider(config.logSize);` and `registry.register(logsProvider);`.

Add `addLogSource` to the `NodeUIServer` interface:

```ts
  /** Pushes an external log entry into the log viewer (logger adapter). */
  addLogSource(entry: { level: LogLevel; message: string }): void;
```

Import `type LogLevel` from `./types`. Implement on the server object:

```ts
    addLogSource(entry: { level: LogLevel; message: string }): void {
      logsProvider.addSource(entry);
    },
```

- [ ] **Step 7: Pass `addLogSource` through the adapters**

`packages/express/src/index.ts` — add to `NodeUIExpress` interface `addLogSource: NodeUIServer['addLogSource'];` and in the return: `addLogSource: server.addLogSource,`.

`packages/nestjs/src/nodeui.service.ts` — add method:

```ts
  addLogSource(entry: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }): void {
    this.server.addLogSource(entry);
  }
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/providers/logs.ts packages/core/src/providers/index.ts packages/core/src/server.ts packages/express/src/index.ts packages/nestjs/src/nodeui.service.ts packages/core/test/logs.test.ts
git commit -m "feat(core): add log viewer provider with console interception and adapter"
```

---

### Task 6: Register all new providers and expose their GET routes

**Files:**

- Modify: `packages/core/src/server.ts` (register EnvProvider/RoutesProvider, GET_ROUTES, servePanel query passthrough)
- Modify: `packages/core/src/types.ts` (ConfigData panels already derived from registry)
- Test: `packages/core/test/server.test.ts`

**Interfaces:**

- Consumes: providers from Tasks 2-5.
- Produces: GET routes `/env`, `/routes`, `/logs`, `/metrics`; `servePanel` accepts `query` and passes a shallow-cloned context; `handleApi` parses query params from `req.url`.

- [ ] **Step 1: Write the failing test additions to `packages/core/test/server.test.ts`**

First, extend `ALL_PANELS` in `server.test.ts` to include the four new panel ids:

```ts
const ALL_PANELS: PanelId[] = [
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
];
```

Then adjust the existing generic panel test in `server.test.ts` so it excludes `routes` (in the raw-http test harness there is no `req.app`, so the routes provider reports `router-unavailable`, which is a 500 error envelope):

```ts
it.each(ALL_PANELS.filter((p) => p !== 'routes'))(
  'serves the %s panel with a successful envelope',
  async (panel) => {
    await withServer({}, async ({ base }) => {
      const { status, body } = await getJson(base, `/nodeui/api/${panel}`);
      expect(status).toBe(200);
      const envelope = body as { ok: boolean; data: unknown };
      expect(envelope.ok).toBe(true);
      expect(envelope.data).toBeDefined();
    });
  },
);
```

Add a dedicated routes test with a captured router, and the new-panel tests:

```ts
describe('routes panel', () => {
  it('reports router-unavailable when no express app was captured', async () => {
    await withServer({}, async ({ base }) => {
      const { status, body } = await getJson(base, '/nodeui/api/routes');
      expect(status).toBe(500);
      const envelope = body as { ok: boolean; error: { code: string } };
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe('router-unavailable');
    });
  });

  it('lists routes when an express app is captured', async () => {
    const server = createNodeUI({ env: { NODE_ENV: 'development' } });
    const fakeRouter = {
      stack: [
        {
          name: 'bound dispatch',
          route: {
            path: '/hello',
            methods: { get: true },
            stack: [{ handle: { name: 'helloHandler' } }],
          },
        },
      ],
    };
    const req = {
      method: 'GET',
      url: '/nodeui/api/routes',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
      app: { _router: fakeRouter },
    } as unknown as IncomingMessage;
    const res = {
      status: 0,
      body: '',
      writeHead(status: number) {
        this.status = status;
        return this;
      },
      end(body: string) {
        this.body = body;
        return this;
      },
    } as unknown as ServerResponse & { status: number; body: string };

    await server.handle(req, res);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as {
      ok: boolean;
      data: { routes: Array<{ path: string }> };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.routes).toEqual([
      { method: 'GET', path: '/hello', handler: 'helloHandler' },
    ]);
    server.shutdown();
  });
});

describe('new phase-1 panel routes', () => {
  it('serves env, routes, logs, and metrics panels', async () => {
    await withServer({ env: { NODE_ENV: 'development', DEMO_VAR: 'x' } }, async ({ base }) => {
      const env = await getJson(base, '/nodeui/api/env');
      expect(env.status).toBe(200);
      const envData = env.body as {
        data: { environment: Array<{ key: string }>; config: unknown };
      };
      expect(envData.data.environment.some((e) => e.key === 'DEMO_VAR')).toBe(true);

      const routes = await getJson(base, '/nodeui/api/routes');
      expect(routes.status).toBe(200);

      const logs = await getJson(base, '/nodeui/api/logs');
      expect(logs.status).toBe(200);
      const logsData = logs.body as { data: { entries: unknown[] } };
      expect(Array.isArray(logsData.data.entries)).toBe(true);

      const metrics = await getJson(base, '/nodeui/api/metrics');
      expect(metrics.status).toBe(200);
      const metricsData = metrics.body as { data: { buckets: unknown[] } };
      expect(metricsData.data.buckets).toHaveLength(60);
    });
  });

  it('filters logs via query params and applies app config', async () => {
    await withServer(
      { env: { NODE_ENV: 'development' }, config: { app: 'demo', PORT: 3000 } },
      async ({ base }) => {
        const logs = await getJson(base, '/nodeui/api/logs?level=info');
        expect(logs.status).toBe(200);
        const env = await getJson(base, '/nodeui/api/env');
        const envData = env.body as { data: { config: Array<{ key: string; value: string }> } };
        expect(envData.data.config).toContainEqual({ key: 'app', value: 'demo' });
      },
    );
  });

  it('exposes the log size in the config envelope', async () => {
    await withServer({ logSize: 123 }, async ({ base }) => {
      const { body } = await getJson(base, '/nodeui/api/config');
      const data = body as { data: { logSize: number } };
      expect(data.data.logSize).toBe(123);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run packages/core/test/server.test.ts`
Expected: 3 new tests FAIL (404 / missing logSize) plus the 4 Task-1 `it.each` cases for the new panels.

- [ ] **Step 3: Register providers and routes in `packages/core/src/server.ts`**

Imports: add `EnvProvider` and `RoutesProvider`.

Register after `requestsProvider`:

```ts
const envProvider = new EnvProvider();
registry.register(envProvider);
const routesProvider = new RoutesProvider();
registry.register(routesProvider);
```

Extend `GET_ROUTES`:

```ts
  '/env': 'env',
  '/routes': 'routes',
  '/logs': 'logs',
  '/metrics': 'metrics',
```

- [ ] **Step 4: Pass query params into `servePanel`**

Change `servePanel` signature to `(res, id, query?: Record<string, string>)`. Inside, use a shallow-cloned context when query is present:

```ts
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
```

In `handleApi`, parse the query string from `req.url` and pass it:

```ts
if (method === 'GET') {
  const panel = GET_ROUTES[apiPath];
  if (panel) {
    const query = Object.fromEntries(new URL(req.url ?? '/', 'http://localhost').searchParams);
    return servePanel(res, panel, query);
  }
}
```

- [ ] **Step 5: Run the full core test suite**

Run: `npm run test -w @nodeui/core`
Expected: PASS (all tests including Task-1 `it.each` cases now that routes exist).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/server.ts packages/core/test/server.test.ts
git commit -m "feat(core): expose env/routes/logs/metrics panel routes with query support"
```

---

### Task 7: SSE live endpoint

**Files:**

- Create: `packages/core/src/sse.ts`
- Modify: `packages/core/src/server.ts` (handle `/api/live` GET)
- Modify: `packages/core/src/index.ts` (export sse helper if public)
- Test: `packages/core/test/sse.test.ts`

**Interfaces:**

- Consumes: `ProviderRegistry`, `ProviderContext`, `NodeUIConfig`, `IncomingMessage`, `ServerResponse`, `serializeEnvelope`/`maskSecrets`.
- Produces: `export function startSse(res: ServerResponse): { send(payload: unknown): void; heartbeat(): void; close(): void }` — a tiny wrapper writing `data:` events and `:ping` heartbeats; `handleApi` routes `GET /api/live?panels=a,b` to an SSE stream that pushes each subscribed panel envelope every `pollIntervalMs`, heartbeats every 15s, and cleans up on `close`.

- [ ] **Step 1: Write the failing test `packages/core/test/sse.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { startSse } from '../src/sse';

describe('startSse', () => {
  it('writes data events and heartbeats, and closes', () => {
    const chunks: string[] = [];
    const res = {
      writeHead: () => res,
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
      end: () => undefined,
    } as unknown as import('node:http').ServerResponse;

    const sse = startSse(res);
    sse.send({ panel: 'health', ok: true });
    sse.heartbeat();
    sse.close();
    expect(chunks.join('')).toContain('data: {"panel":"health","ok":true}\n\n');
    expect(chunks.join('')).toContain(':ping\n\n');
  });

  it('is a no-op after close', () => {
    const chunks: string[] = [];
    const res = {
      writeHead: () => res,
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
      end: () => undefined,
    } as unknown as import('node:http').ServerResponse;

    const sse = startSse(res);
    sse.close();
    sse.send({ x: 1 });
    sse.heartbeat();
    expect(chunks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/sse.test.ts`
Expected: FAIL with `Cannot find module '../src/sse'`.

- [ ] **Step 3: Implement `packages/core/src/sse.ts`**

```ts
import type { ServerResponse } from 'node:http';

export interface SseStream {
  send(payload: unknown): void;
  heartbeat(): void;
  close(): void;
}

/**
 * Minimal Server-Sent Events writer over a raw HTTP response. Events are
 * emitted as `data: <json>\n\n`; heartbeats as `:ping\n\n`.
 */
export function startSse(res: ServerResponse): SseStream {
  let closed = false;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  return {
    send(payload: unknown): void {
      if (closed || res.destroyed) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    },
    heartbeat(): void {
      if (closed || res.destroyed) return;
      res.write(':ping\n\n');
    },
    close(): void {
      if (closed || res.destroyed) return;
      closed = true;
      res.end();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/sse.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the `/api/live` handler in `packages/core/src/server.ts`**

Import `startSse`. Add a constant `const SSE_HEARTBEAT_MS = 15_000;` near the top of the module.

Add inside `createNodeUI` (before `handleApi`):

```ts
async function handleLive(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const search = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const requested = (search.get('panels') ?? '').split(',').filter(Boolean);
  const panels = (
    requested.length > 0
      ? requested.filter((id): id is PanelId => GET_ROUTES[`/${id}`] !== undefined)
      : Object.values(GET_ROUTES)
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
```

In `handleApi`, add before the `method === 'GET'` panel branch:

```ts
if (method === 'GET' && apiPath === '/live') {
  return handleLive(req, res);
}
```

- [ ] **Step 6: Add an e2e SSE test to `packages/core/test/server.test.ts`**

```ts
it('streams panel envelopes over SSE', async () => {
  await withServer({ pollIntervalMs: 50 }, async ({ base }) => {
    const controller = new AbortController();
    const res = await fetch(base + '/nodeui/api/live?panels=health', {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body?.getReader();
    const { value } = (await reader?.read()) ?? { value: undefined };
    const text = new TextDecoder().decode(value);
    expect(text).toContain('data:');
    expect(text).toContain('"panel":"health"');
    controller.abort();
  });
});
```

- [ ] **Step 7: Run the full core suite**

Run: `npm run test -w @nodeui/core`
Expected: PASS.

- [ ] **Step 8: Export `startSse` from `packages/core/src/index.ts`**

Add: `export { startSse, type SseStream } from './sse';`

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/sse.ts packages/core/src/server.ts packages/core/src/index.ts packages/core/test/sse.test.ts packages/core/test/server.test.ts
git commit -m "feat(core): add server-sent-events live push endpoint"
```

---

### Task 8: UI — types, export helpers, and export buttons on panels

**Files:**

- Create: `apps/ui/src/export.ts`
- Create: `apps/ui/test/export.test.tsx`
- Modify: `apps/ui/src/types.ts`
- Modify: `apps/ui/src/panels/Panel.tsx`
- Modify: `apps/ui/src/styles.css`

**Interfaces:**

- Consumes: existing `ConfigData`, `RequestEntry`, `LogEntry`, `EnvEntry`, `RouteEntry` shapes.
- Produces: `toCsv(rows: Array<Record<string, unknown>>): string`; `downloadFile(filename: string, content: string, mime: string): void`; `downloadJson(filename: string, data: unknown): void`; `downloadCsv(filename: string, rows: Array<Record<string, unknown>>): void`; `Panel` gains optional props `exportName?: string`, `exportJson?: unknown`, `exportCsv?: Array<Record<string, unknown>>` that render header buttons.

- [ ] **Step 1: Write the failing test `apps/ui/test/export.test.tsx`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv, downloadJson, toCsv } from '../src/export';

describe('toCsv', () => {
  it('emits a header row and quoted values', () => {
    const rows = [
      { method: 'GET', path: '/a', status: 200 },
      { method: 'POST', path: '/b', status: 500 },
    ];
    expect(toCsv(rows)).toBe('method,path,status\nGET,/a,200\nPOST,/b,500\n');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = toCsv([{ note: 'hello, "world"\nnext' }]);
    expect(csv).toContain('"hello, ""world""\nnext"');
  });
});

describe('download helpers', () => {
  const original = {
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };

  afterEach(() => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
    vi.restoreAllMocks();
  });

  it('downloadJson builds a blob and clicks an anchor', () => {
    const click = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      click,
      set href(_v: string) {},
    } as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    downloadJson('nodeui-health', { status: 'ok' });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
  });

  it('downloadCsv converts rows to CSV', () => {
    const click = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      click,
      set href(_v: string) {},
    } as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    downloadCsv('nodeui-requests', [{ method: 'GET', path: '/a', status: 200 }]);
    expect(click).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/ui/test/export.test.tsx`
Expected: FAIL with `Cannot find module '../src/export'`.

- [ ] **Step 3: Implement `apps/ui/src/export.ts`**

```ts
function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0] ?? {});
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, data: unknown): void {
  downloadFile(`${filename}.json`, JSON.stringify(data, null, 2), 'application/json');
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>): void {
  downloadFile(`${filename}.csv`, toCsv(rows), 'text/csv');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/ui/test/export.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update `apps/ui/src/types.ts`**

Mirror core: add `'env' | 'routes' | 'logs' | 'metrics'` to `PanelId`; add `logSize: number;` to `ConfigData`; add the new interfaces `EnvEntry`, `EnvData`, `RouteEntry`, `RoutesData`, `LogLevel`, `LogEntry`, `LogsData`, `MetricsBucket`, `MetricsData`.

- [ ] **Step 6: Extend `Panel` with export buttons in `apps/ui/src/panels/Panel.tsx`**

```tsx
import type { ReactNode } from 'react';
import { downloadCsv, downloadJson } from '../export';

export function Panel({
  title,
  children,
  className,
  exportName,
  exportJson: jsonData,
  exportCsv: csvRows,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  exportName?: string;
  exportJson?: unknown;
  exportCsv?: Array<Record<string, unknown>>;
}) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        {exportName ? (
          <div className="panel-actions">
            {jsonData !== undefined ? (
              <button
                type="button"
                className="btn btn-mini"
                onClick={() => downloadJson(exportName, jsonData)}
              >
                JSON
              </button>
            ) : null}
            {csvRows ? (
              <button
                type="button"
                className="btn btn-mini"
                onClick={() => downloadCsv(exportName, csvRows)}
              >
                CSV
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 7: Add styles to `apps/ui/src/styles.css`**

```css
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.panel-actions {
  display: flex;
  gap: 0.25rem;
}

.btn-mini {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
```

(Append after the existing `.panel-title` rule; adjust the `--border` fallback to match the existing stylesheet if it already defines a variable.)

- [ ] **Step 8: Commit**

```bash
git add apps/ui/src/export.ts apps/ui/test/export.test.tsx apps/ui/src/types.ts apps/ui/src/panels/Panel.tsx apps/ui/src/styles.css
git commit -m "feat(ui): add export helpers and per-panel json/csv buttons"
```

---

### Task 9: UI — live client with SSE and REST-poll fallback

**Files:**

- Create: `apps/ui/src/live.ts`
- Modify: `apps/ui/src/hooks.ts` (add `useLivePanel`)
- Create: `apps/ui/test/live.test.tsx`
- Modify: `apps/ui/test/setup.ts` (polyfill guard)

**Interfaces:**

- Consumes: `apiBase()` from `api.ts`, `PanelId`/`Envelope` from `types.ts`.
- Produces: `liveClient: { subscribe(id: PanelId, cb: (env: Envelope<unknown>) => void): () => void; isConnected(id: PanelId): boolean }` — one shared `EventSource` whose panel list is the union of subscribers, with backoff reconnect; `useLivePanel<T>(id, fetchFn, intervalMs)` returning the same `PollState<T>` shape as `usePolledPanel` but driven by SSE when connected and REST polling otherwise.

- [ ] **Step 1: Write the failing test `apps/ui/test/live.test.tsx`**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { liveClient } from '../src/live';
import { useLivePanel } from '../src/hooks';
import type { Envelope } from '../src/types';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static handler: ((ev: MessageEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close(): void {}
  static emit(payload: unknown): void {
    const ev = { data: JSON.stringify(payload) } as MessageEvent;
    for (const inst of FakeEventSource.instances) inst.onmessage?.(ev);
  }
  static open(): void {
    for (const inst of FakeEventSource.instances) inst.onopen?.();
  }
}

describe('liveClient', () => {
  it('opens one EventSource and dispatches envelopes to subscribers', () => {
    window.history.replaceState({}, '', '/nodeui/');
    const original = globalThis.EventSource;
    (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
    const received: Envelope<unknown>[] = [];
    const unsubscribe = liveClient.subscribe('health', (env) => received.push(env));
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.emit({ panel: 'health', envelope: { ok: true, data: { status: 'ok' } } });
    expect(received).toEqual([{ ok: true, data: { status: 'ok' } }]);
    unsubscribe();
    expect(liveClient.isConnected('health')).toBe(false);
    (globalThis as { EventSource: unknown }).EventSource = original;
  });
});

describe('useLivePanel', () => {
  it('falls back to fetch polling when EventSource is unavailable', async () => {
    (globalThis as { EventSource: unknown }).EventSource = undefined;
    const fetchFn = vi.fn(async () => ({ status: 'ok' }));
    const { result } = renderHook(() => useLivePanel('health', fetchFn, 2000));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(fetchFn).toHaveBeenCalled();
    expect(result.current.data).toEqual({ status: 'ok' });
  });
});
```

Note: the jsdom test environment does not implement `EventSource`; the guard in `live.ts` must treat `typeof EventSource === 'undefined'` as "not connected" so tests and older browsers fall back to REST polling.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/ui/test/live.test.tsx`
Expected: FAIL with `Cannot find module '../src/live'` / missing `useLivePanel`.

- [ ] **Step 3: Implement `apps/ui/src/live.ts`**

```ts
import { apiBase } from './api';
import type { Envelope, PanelId } from './types';

type Subscriber = (env: Envelope<unknown>) => void;

const MAX_RETRY_MS = 30_000;

/**
 * Shared Server-Sent Events client. One `EventSource` is kept open with the
 * union of all subscribed panel ids; envelopes are dispatched to the
 * matching subscribers. Reconnects with backoff. When `EventSource` is
 * unavailable (jsdom, old browsers) subscriptions simply never connect and
 * callers fall back to REST polling.
 */
class LiveClient {
  private es: EventSource | null = null;
  private readonly subscribers = new Map<PanelId, Set<Subscriber>>();
  private connected = false;
  private retryMs = 1000;
  private reconnectTimer: number | undefined;

  subscribe(id: PanelId, cb: Subscriber): () => void {
    const set = this.subscribers.get(id) ?? new Set<Subscriber>();
    set.add(cb);
    this.subscribers.set(id, set);
    this.ensure();
    return () => {
      const current = this.subscribers.get(id);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) this.subscribers.delete(id);
      if (this.subscribers.size === 0) this.close();
      else this.reconnect();
    };
  }

  isConnected(id: PanelId): boolean {
    return this.connected && this.subscribers.has(id);
  }

  private ensure(): void {
    if (typeof EventSource === 'undefined') return;
    if (this.es) return;
    const panels = [...this.subscribers.keys()].join(',');
    const es = new EventSource(`${apiBase()}/live?panels=${encodeURIComponent(panels)}`);
    this.es = es;
    es.onopen = () => {
      this.connected = true;
      this.retryMs = 1000;
    };
    es.onmessage = (ev) => {
      let payload: { panel?: PanelId; envelope?: Envelope<unknown> };
      try {
        payload = JSON.parse(String(ev.data)) as { panel?: PanelId; envelope?: Envelope<unknown> };
      } catch {
        return;
      }
      if (!payload.panel || !payload.envelope) return;
      const set = this.subscribers.get(payload.panel);
      if (!set) return;
      for (const cb of set) cb(payload.envelope);
    };
    es.onerror = () => {
      es.close();
      if (this.es === es) this.es = null;
      this.connected = false;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensure();
    }, this.retryMs);
    this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
  }

  private close(): void {
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.es?.close();
    this.es = null;
    this.connected = false;
    this.retryMs = 1000;
  }

  private reconnect(): void {
    if (!this.es && this.subscribers.size > 0) this.ensure();
  }
}

export const liveClient = new LiveClient();
```

- [ ] **Step 4: Add `useLivePanel` to `apps/ui/src/hooks.ts`**

```ts
import { liveClient } from './live';

/**
 * Panel data hook with SSE-first delivery and REST polling fallback. When the
 * live connection is up, updates come from the SSE stream; otherwise it polls
 * `fetchFn` on `intervalMs` with exponential backoff.
 */
export function useLivePanel<T>(
  id: PanelId,
  fetchFn: () => Promise<T>,
  intervalMs: number,
): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    return liveClient.subscribe(id, (env) => {
      if (env.ok) {
        setData(env.data as T);
        setError(null);
      } else {
        setError(env.error.message);
      }
    });
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = intervalMs;

    const tick = async (): Promise<void> => {
      if (liveClient.isConnected(id)) {
        if (!cancelled) timer = setTimeout(() => void tick(), intervalMs);
        return;
      }
      try {
        const result = await fetchRef.current();
        if (cancelled) return;
        delay = intervalMs;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        delay = Math.min(MAX_BACKOFF_MS, Math.max(intervalMs, delay * 2));
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) {
        timer = setTimeout(() => void tick(), delay);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, intervalMs, nonce]);

  const refetch = (): void => setNonce((n) => n + 1);
  return { data, error, loading, refetch };
}
```

Import `type PanelId` in hooks.ts (add to the existing type imports).

- [ ] **Step 5: Update smoke test config to include `logSize` and new panel stubs**

In `apps/ui/test/smoke.test.tsx`:

- Add `logSize: 500,` to the `config` object.
- Add `'env', 'routes', 'logs', 'metrics'` to `config.panels`.
- Add payload stubs for `/env`, `/routes`, `/logs`, `/metrics` in `payloads`.

- [ ] **Step 6: Run the full UI test suite**

Run: `npm run test -w @nodeui/ui`
Expected: PASS (existing smoke tests still pass because `EventSource` is undefined in jsdom → REST fallback).

- [ ] **Step 7: Commit**

```bash
git add apps/ui/src/live.ts apps/ui/src/hooks.ts apps/ui/test/live.test.tsx apps/ui/test/smoke.test.tsx
git commit -m "feat(ui): add sse live client with polling fallback and useLivePanel hook"
```

---

### Task 10: UI — Environment, Routes, Logs panels, and the Requests chart

**Files:**

- Create: `apps/ui/src/panels/EnvPanel.tsx`
- Create: `apps/ui/src/panels/RoutesPanel.tsx`
- Create: `apps/ui/src/panels/LogsPanel.tsx`
- Create: `apps/ui/src/panels/MetricsChart.tsx`
- Modify: `apps/ui/src/panels/RequestsPanel.tsx` (mount the chart)
- Modify: `apps/ui/src/styles.css`
- Create: `apps/ui/test/panels.test.tsx`

**Interfaces:**

- Consumes: `useLivePanel`, `getPanel`, panel data types, `Panel`/`PanelError`/`PanelLoading`, `formatDuration`/`formatTime`.
- Produces: four React components rendering the new panels, all export-enabled; `MetricsChart` renders 60 bars of RPS (requests) and error count with a scale legend.

- [ ] **Step 1: Write the failing test `apps/ui/test/panels.test.tsx`**

```tsx
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { EnvPanel } from '../src/panels/EnvPanel';
import { RoutesPanel } from '../src/panels/RoutesPanel';
import { LogsPanel } from '../src/panels/LogsPanel';
import { RequestsPanel } from '../src/panels/RequestsPanel';

const env = {
  environment: [
    { key: 'NODE_ENV', value: 'development' },
    { key: 'TOKEN', value: '[REDACTED]' },
  ],
  config: [{ key: 'app', value: 'demo' }],
};

const routes = {
  routes: [
    { method: 'GET', path: '/hello', handler: 'helloHandler' },
    { method: 'POST', path: '/users', handler: 'createUser' },
  ],
};

const logs = {
  entries: [
    { level: 'info', message: 'started', timestamp: 1 },
    { level: 'error', message: 'boom', timestamp: 2 },
  ],
};

const metrics = {
  buckets: Array.from({ length: 60 }, (_, i) => ({ ts: i * 1000, requests: 2, errors: 1 })),
};

const requests = { total: 0, entries: [] };

const payloads: Record<string, unknown> = {
  '/env': env,
  '/routes': routes,
  '/logs': logs,
  '/metrics': metrics,
  '/requests': requests,
};

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = Object.keys(payloads).find((p) => url.includes(p));
      if (match) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: payloads[match] }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: false, error: { code: 'not-found', message: 'nf' } }),
      } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/nodeui/');
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EnvPanel', () => {
  it('renders environment and config values', async () => {
    render(<EnvPanel intervalMs={2000} />);
    await waitFor(() => {
      expect(screen.getByText('NODE_ENV')).toBeInTheDocument();
    });
    expect(screen.getByText('development')).toBeInTheDocument();
    expect(screen.getByText('[REDACTED]')).toBeInTheDocument();
    expect(screen.getByText('demo')).toBeInTheDocument();
  });
});

describe('RoutesPanel', () => {
  it('renders routes with method and path', async () => {
    render(<RoutesPanel intervalMs={2000} />);
    await waitFor(() => {
      expect(screen.getByText('/hello')).toBeInTheDocument();
    });
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('createUser')).toBeInTheDocument();
  });
});

describe('LogsPanel', () => {
  it('renders log entries with levels', async () => {
    render(<LogsPanel intervalMs={2000} />);
    await waitFor(() => {
      expect(screen.getByText('started')).toBeInTheDocument();
    });
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});

describe('RequestsPanel', () => {
  it('renders the metrics chart and the request table', async () => {
    render(<RequestsPanel intervalMs={2000} />);
    await waitFor(() => {
      expect(screen.getByText(/rps/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('No requests observed yet.')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/ui/test/panels.test.tsx`
Expected: FAIL with `Cannot find module '../src/panels/EnvPanel'` etc.

- [ ] **Step 3: Implement `apps/ui/src/panels/EnvPanel.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { getPanel } from '../api';
import { useLivePanel } from '../hooks';
import type { EnvData } from '../types';
import { Panel, PanelError, PanelLoading } from './Panel';

export function EnvPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = useLivePanel<EnvData>('env', () => getPanel<EnvData>('/env'), intervalMs);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    if (!data) return [];
    const environment = data.environment.filter((e) =>
      e.key.toLowerCase().includes(query.toLowerCase()),
    );
    const config =
      data.config?.filter((e) => e.key.toLowerCase().includes(query.toLowerCase())) ?? [];
    return {
      environment,
      config,
      total: data.environment.length + (data.config?.length ?? 0),
    };
  }, [data, query]);

  return (
    <Panel
      title="Environment"
      exportName="nodeui-env"
      exportJson={data ?? undefined}
      exportCsv={rows.environment}
    >
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : (
        <>
          <input
            className="filter-input"
            type="search"
            placeholder="Filter keys…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="muted">{rows.total} entries</p>
          {rows.environment.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>key</th>
                  <th>value</th>
                </tr>
              </thead>
              <tbody>
                {rows.environment.map((e) => (
                  <tr key={`env-${e.key}`}>
                    <td className="mono">{e.key}</td>
                    <td className={`mono${e.value === '[REDACTED]' ? ' redacted' : ''}`}>
                      {e.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {rows.config && rows.config.length > 0 ? (
            <>
              <h3 className="panel-sub">app config</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>key</th>
                    <th>value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.config.map((e) => (
                    <tr key={`cfg-${e.key}`}>
                      <td className="mono">{e.key}</td>
                      <td className={`mono${e.value === '[REDACTED]' ? ' redacted' : ''}`}>
                        {e.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      )}
    </Panel>
  );
}
```

- [ ] **Step 4: Implement `apps/ui/src/panels/RoutesPanel.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { getPanel } from '../api';
import { useLivePanel } from '../hooks';
import type { RoutesData } from '../types';
import { Panel, PanelError, PanelLoading } from './Panel';

export function RoutesPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = useLivePanel<RoutesData>(
    'routes',
    () => getPanel<RoutesData>('/routes'),
    intervalMs,
  );
  const [query, setQuery] = useState('');

  const routes = useMemo(() => {
    if (!data) return [];
    const q = query.toLowerCase();
    return data.routes.filter(
      (r) => r.method.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <Panel
      title="Routes"
      exportName="nodeui-routes"
      exportJson={data ?? undefined}
      exportCsv={routes}
    >
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : (
        <>
          <input
            className="filter-input"
            type="search"
            placeholder="Filter routes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="muted">{routes.length} routes</p>
          {routes.length === 0 ? (
            <p className="muted">No routes to show.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>method</th>
                  <th>path</th>
                  <th>handler</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={`${r.method} ${r.path}`}>
                    <td>
                      <span className={`method-badge method-${r.method.toLowerCase()}`}>
                        {r.method}
                      </span>
                    </td>
                    <td className="mono">{r.path}</td>
                    <td className="mono">{r.handler}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Panel>
  );
}
```

- [ ] **Step 5: Implement `apps/ui/src/panels/LogsPanel.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { getPanel } from '../api';
import { useLivePanel } from '../hooks';
import type { LogLevel, LogsData } from '../types';
import { formatTime } from '../format';
import { Panel, PanelError, PanelLoading } from './Panel';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export function LogsPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = useLivePanel<LogsData>(
    'logs',
    () => getPanel<LogsData>('/logs'),
    intervalMs,
  );
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [query, setQuery] = useState('');

  const entries = useMemo(() => {
    if (!data) return [];
    const q = query.toLowerCase();
    return data.entries.filter(
      (e) =>
        (level === 'all' || e.level === level) && (q === '' || e.message.toLowerCase().includes(q)),
    );
  }, [data, level, query]);

  return (
    <Panel title="Logs" exportName="nodeui-logs" exportJson={data ?? undefined} exportCsv={entries}>
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : (
        <>
          <div className="log-toolbar">
            <div className="log-levels">
              <button
                type="button"
                className={`chip${level === 'all' ? ' chip-active' : ''}`}
                onClick={() => setLevel('all')}
              >
                all
              </button>
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`chip chip-${l}${level === l ? ' chip-active' : ''}`}
                  onClick={() => setLevel(l)}
                >
                  {l}
                </button>
              ))}
            </div>
            <input
              className="filter-input"
              type="search"
              placeholder="Search messages…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {entries.length === 0 ? (
            <p className="muted">No log entries.</p>
          ) : (
            <ul className="log-list">
              {entries.map((e, i) => (
                <li key={`${e.timestamp}-${i}`} className={`log-line log-${e.level}`}>
                  <span className="log-level">{e.level}</span>
                  <span className="log-time mono">{formatTime(e.timestamp)}</span>
                  <span className="log-message">{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
```

- [ ] **Step 6: Implement `apps/ui/src/panels/MetricsChart.tsx`**

```tsx
import { useLivePanel } from '../hooks';
import { getPanel } from '../api';
import type { MetricsData } from '../types';

export function MetricsChart({ intervalMs }: { intervalMs: number }) {
  const { data } = useLivePanel<MetricsData>(
    'metrics',
    () => getPanel<MetricsData>('/metrics'),
    intervalMs,
  );
  if (!data) return null;
  const max = Math.max(1, ...data.buckets.map((b) => Math.max(b.requests, b.errors)));
  return (
    <div className="metrics-chart">
      <div className="metrics-bars">
        {data.buckets.map((b) => (
          <div
            key={b.ts}
            className="metrics-bar-wrap"
            title={`${b.requests} req / ${b.errors} err`}
          >
            <div
              className="metrics-bar metrics-bar-errors"
              style={{ height: `${(b.errors / max) * 100}%` }}
            />
            <div
              className="metrics-bar metrics-bar-requests"
              style={{ height: `${(b.requests / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="metrics-legend">
        <span className="muted">rps · last 60s · max {max}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Mount the chart in `apps/ui/src/panels/RequestsPanel.tsx`**

Import `MetricsChart`; render `<MetricsChart intervalMs={intervalMs} />` at the top of the panel body (inside the `<>` fragment, before the total line). Switch the panel's data hook from `usePolledPanel` to `useLivePanel` so it benefits from SSE-first delivery too:

```tsx
const { data, error } = useLivePanel<RequestsData>(
  'requests',
  () => getPanel<RequestsData>('/requests'),
  intervalMs,
);
```

Update the `Panel` export props: `exportName="nodeui-requests"` `exportJson={data ?? undefined}` `exportCsv={data?.entries ?? []}`.

- [ ] **Step 8: Add styles to `apps/ui/src/styles.css`**

```css
.filter-input {
  width: 100%;
  margin-bottom: 0.5rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  background: transparent;
  color: inherit;
}

.panel-sub {
  font-size: 0.85rem;
  color: var(--muted, #888);
  margin: 0.75rem 0 0.25rem;
}

.redacted {
  color: #d97706;
}

.method-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.05rem 0.4rem;
  border-radius: 4px;
  background: #222;
  color: #ddd;
}

.method-get {
  color: #22c55e;
}
.method-post {
  color: #3b82f6;
}
.method-put {
  color: #eab308;
}
.method-delete {
  color: #ef4444;
}

.log-toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.log-levels {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.chip {
  font-size: 0.7rem;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--border, #333);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.chip-active {
  border-color: #22c55e;
  color: #22c55e;
}

.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow-y: auto;
}

.log-line {
  display: flex;
  gap: 0.5rem;
  font-size: 0.8rem;
  padding: 0.2rem 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.1);
}

.log-level {
  flex: 0 0 3rem;
  font-weight: 600;
}
.log-time {
  flex: 0 0 6rem;
  color: var(--muted, #888);
}
.log-message {
  word-break: break-word;
}
.log-debug .log-level {
  color: #6b7280;
}
.log-info .log-level {
  color: #3b82f6;
}
.log-warn .log-level {
  color: #eab308;
}
.log-error .log-level {
  color: #ef4444;
}

.metrics-chart {
  margin-bottom: 0.75rem;
}

.metrics-bars {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 64px;
}

.metrics-bar-wrap {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
  gap: 1px;
}

.metrics-bar {
  flex: 1;
  min-height: 1px;
}

.metrics-bar-requests {
  background: #3b82f6;
  opacity: 0.8;
}
.metrics-bar-errors {
  background: #ef4444;
}
.metrics-legend {
  margin-top: 0.25rem;
}
```

- [ ] **Step 9: Run the full UI test suite**

Run: `npm run test -w @nodeui/ui`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/ui/src/panels/EnvPanel.tsx apps/ui/src/panels/RoutesPanel.tsx apps/ui/src/panels/LogsPanel.tsx apps/ui/src/panels/MetricsChart.tsx apps/ui/src/panels/RequestsPanel.tsx apps/ui/src/styles.css apps/ui/test/panels.test.tsx
git commit -m "feat(ui): add environment, routes, logs panels and rps/error chart"
```

---

### Task 11: UI — App wiring for the new panels

**Files:**

- Modify: `apps/ui/src/App.tsx`

**Interfaces:**

- Consumes: new panel components from Task 10.
- Produces: `App` renders the new panels in the grid.

- [ ] **Step 1: Update `apps/ui/src/App.tsx`**

Import `EnvPanel`, `RoutesPanel`, `LogsPanel`. Add to `PANELS`:

```tsx
  { id: 'env', title: 'Environment', component: (i) => <EnvPanel intervalMs={i} /> },
  { id: 'routes', title: 'Routes', component: (i) => <RoutesPanel intervalMs={i} /> },
  { id: 'logs', title: 'Logs', component: (i) => <LogsPanel intervalMs={i} /> },
```

- [ ] **Step 2: Verify with UI tests**

Run: `npm run test -w @nodeui/ui`
Expected: PASS.

- [ ] **Step 3: Build the UI and verify static output**

Run: `npm run build:ui`
Expected: `verify-build` prints success; `packages/core/static/` contains a fresh `index.html` + hashed assets.

- [ ] **Step 4: Commit**

```bash
git add apps/ui/src/App.tsx
git commit -m "feat(ui): wire environment, routes, and logs panels into the console grid"
```

---

### Task 12: Demo apps — exercise the new features

**Files:**

- Modify: `apps/demo-express/src/index.ts`
- Modify: `apps/demo-nestjs/src/main.ts`
- Modify: `apps/demo-nestjs/src/app.controller.ts`

**Interfaces:**

- Consumes: `nodeui({ config })` and `server.addLogSource` (express), `NodeUIModule.register({ config })` and `NodeUIService.addLogSource` (nestjs).
- Produces: demos that (1) pass an app-config object, (2) emit a log line at startup, and (3) have several routes so the routes panel has content.

- [ ] **Step 1: Update `apps/demo-express/src/index.ts`**

Change the `nodeui()` call:

```ts
const { middleware, server } = nodeui({
  config: { appName: 'demo-express', version: '0.1.0', port: Number(process.env.PORT ?? 3000) },
});
```

Add a `/users/:id` route after `/hello`:

```ts
app.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id, via: 'nodeui demo' });
});
```

Inside the `listen` callback, after `server.mark('listening')`:

```ts
server.addLogSource({ level: 'info', message: 'demo-express listening on port ' + port });
console.warn('[demo-express] log interception is active while the Logs panel is open');
```

- [ ] **Step 2: Update `apps/demo-nestjs/src/main.ts`**

After `app.get(NodeUIService).mark('listening')`:

```ts
app
  .get(NodeUIService)
  .addLogSource({ level: 'info', message: 'demo-nestjs listening on port ' + port });
```

- [ ] **Step 3: Update `apps/demo-nestjs/src/app.module.ts`**

```ts
imports: [
  NodeUIModule.register({
    config: { appName: 'demo-nestjs', version: '0.1.0', port: Number(process.env.PORT ?? 3001) },
  }),
],
```

- [ ] **Step 4: Add a parameterized route to `apps/demo-nestjs/src/app.controller.ts`**

```ts
import { Controller, Get, Param } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('/hello')
  hello(): { message: string; via: string } {
    return { message: 'hello from nestjs demo', via: 'nodeui demo' };
  }

  @Get('/users/:id')
  user(@Param('id') id: string): { id: string; via: string } {
    return { id, via: 'nodeui demo' };
  }
}
```

- [ ] **Step 5: Typecheck both demos**

Run: `npm run typecheck -w @nodeui/demo-express && npm run typecheck -w @nodeui/demo-nestjs`
Expected: PASS.

- [ ] **Step 6: Build core so demos resolve the new runtime exports**

Run: `npm run build:core`
Expected: dist rebuilt without errors.

- [ ] **Step 7: Manually verify the demo-express endpoints**

Run: `npm run demo:express` in a background terminal, then:

```bash
curl -s http://127.0.0.1:3000/nodeui/api/config
curl -s http://127.0.0.1:3000/nodeui/api/env
curl -s http://127.0.0.1:3000/nodeui/api/routes
curl -s http://127.0.0.1:3000/nodeui/api/metrics
curl -s -N http://127.0.0.1:3000/nodeui/api/live?panels=health --max-time 2
```

Expected: config shows `logSize`, env shows `appName`, routes lists `/hello`, `/users/:id`, `/slow`, `/boom`; metrics returns 60 buckets; live streams `data:` lines. Then open `http://127.0.0.1:3000/nodeui` and confirm the Logs panel shows the `demo-express listening` line. Kill the background terminal.

- [ ] **Step 8: Commit**

```bash
git add apps/demo-express/src/index.ts apps/demo-nestjs/src/main.ts apps/demo-nestjs/src/app.module.ts apps/demo-nestjs/src/app.controller.ts
git commit -m "feat(demos): exercise env, routes, logs, and sse features"
```

---

### Task 13: Documentation updates

**Files:**

- Modify: `README.md`
- Modify: `packages/core/README.md`
- Modify: `docs/superpowers/specs/2026-08-20-nodeui-phase1-observability.md` (tick spec as implemented — optional)

**Interfaces:**

- Consumes: final API surface from all tasks.

- [ ] **Step 1: Update `README.md`**

- Panels table: add Environment, Routes, Logs, and note the RPS/error chart in Requests.
- API route table: add `GET /{path}/api/live?panels=a,b`, `GET /{path}/api/env`, `GET /{path}/api/routes`, `GET /{path}/api/logs?level=&query=`, `GET /{path}/api/metrics`.
- Env table: add `NODEUI_LOG_SIZE` (default 500).
- New section "Log viewer" describing console interception + `addLogSource`.
- New section "Live updates" describing SSE + REST fallback.
- New section "Export" describing the JSON/CSV buttons.

- [ ] **Step 2: Update `packages/core/README.md`**

- Document `NodeUIServer.addLogSource`, `NodeUIOptions.logSize`, `NodeUIOptions.config`.

- [ ] **Step 3: Verify formatting**

Run: `npm run format:check`
Expected: PASS (or run `npm run format` first).

- [ ] **Step 4: Commit**

```bash
git add README.md packages/core/README.md
git commit -m "docs: document phase 1 observability features"
```

---

### Task 14: Final verification pass

**Files:**

- No code changes expected; fixes only if a check fails.

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: PASS. If the new `.tsx` files trip the `no-console` rule or unused vars, fix inline.

- [ ] **Step 2: Format check**

Run: `npm run format:check`
Expected: PASS.

- [ ] **Step 3: Typecheck all packages**

Run: `npm run typecheck`
Expected: PASS (core, express, nestjs, ui, demo-express, demo-nestjs).

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: PASS (89 existing + new core env/metrics/routes/logs/sse + UI export/live/panels tests).

- [ ] **Step 5: Full build**

Run: `npm run build`
Expected: PASS; `packages/core/static/` has fresh hashed assets.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "chore: final phase 1 verification fixes"
```

(Only run if Step 1-5 produced changes.)

---

## Self-Review

**Spec coverage:**

- SSE live push → Task 7 (endpoint) + Task 9 (UI client).
- Env/config viewer → Task 3 (provider) + Task 10 (EnvPanel) + Task 1 (`config` option).
- Route listing → Task 4 (provider + router capture) + Task 10 (RoutesPanel).
- RPS/error chart → Task 2 (metrics) + Task 10 (MetricsChart in RequestsPanel).
- Log viewer (console + adapter) → Task 5 + Task 10 (LogsPanel) + Task 12 (demo `addLogSource`).
- Export JSON/CSV → Task 8.
- Non-goals (DB, outgoing HTTP, plugin API, alerting, load sim, multi-instance) → not implemented, deferred per spec.
- Error handling: providers return error envelopes (routes `router-unavailable`), console wrapper never throws, SSE cleanup on close → covered in Tasks 4/5/7.
- Lazy lifecycle: `logs` interception only runs while active (Task 5 `start`/`stop`); SSE activates providers (Task 7 `ensureActive`) — covered.

**Placeholder scan:** No TBD/TODO; every step has concrete code or commands.

**Type consistency:** `EnvData`, `RouteEntry`, `LogEntry`, `MetricsBucket` names identical across core (`types.ts`), UI (`types.ts`), providers, and tests. `addLogSource` signature `{ level: LogLevel; message: string }` consistent across core server, express adapter, nestjs service, and demos. `useLivePanel` returns the same `PollState<T>` shape as `usePolledPanel`. `startSse`/`SseStream` consistent between `sse.ts`, `server.ts`, and tests.

**Scope:** Single coherent release; all changes are within the monorepo.
