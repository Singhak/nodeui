# NodeUI Local Developer Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `nodeui` — a BootUI-inspired, local-only developer console (bundled React UI + REST API) for Express and NestJS apps, as an npm workspaces monorepo.

**Architecture:** A framework-neutral core (`@nodeui/core`) holds the engine: 7 observability providers, safety gate (activation, loopback, secret masking, confirmation-based mutations), REST contract at `/nodeui/api/**`, static asset serving of a Vite-built React console. Thin adapters (`@nodeui/express`, `@nodeui/nestjs`) mount the same middleware. Two demo apps exercise both adapters.

**Tech Stack:** Node 22, npm workspaces, TypeScript 5.9 (strict, CJS output), React 19 + Vite 8, Express 5, NestJS 11, Vitest 3, ESLint 9 flat config, Prettier.

## Global Constraints

- Monorepo layout exactly: `apps/ui`, `packages/core`, `packages/express`, `packages/nestjs`, `apps/demo-express`, `apps/demo-nestjs`.
- Core 7 panels: Health, Memory, CPU, Event-loop lag, Heap snapshot, Startup timing, HTTP request log.
- All packages: `"strict": true` TypeScript, no `any` leaks, JSDoc on all public API.
- Safety: activated by dev `NODE_ENV` or `NODEUI_ENABLED=true`, fails closed otherwise; loopback-only by default; secret masking keys matching `TOKEN|KEY|SECRET|PASSWORD`; read-only default; mutations (heap snapshot) require explicit nonce confirmation; fail-closed in production.
- Provider contract: `{ ok: true, data } | { ok: false, error: { code, message } }`; never leak exceptions to the UI.
- Performance: no event-loop blocking; memory/CPU sampled every ~2s; heap snapshot on explicit action only; request log fixed ring buffer (default 500); zero-cost when disabled (no-op passthrough middleware); lazy providers (start on first view, stop after inactivity).
- Env vars: `NODEUI_ENABLED`, `NODEUI_HOST` (default `127.0.0.1`), `NODEUI_PORT` (informational, default same as host app), `NODEUI_PATH` (default `/nodeui`), `NODEUI_REQUEST_LOG_SIZE` (default 500), `NODEUI_POLL_INTERVAL_MS` (default 2000). `.env.example` documents all; no real secrets.
- Enforced in CI: ESLint + Prettier, `tsc --noEmit`, Vitest, build.
- Vite dev server: `allowedHosts: ['.monkeycode-ai.live']`.
- No emoji in any file or message.

---

### Task 1: Monorepo Scaffold

**Files:**

- Create: `/workspace/package.json`
- Create: `/workspace/tsconfig.base.json`
- Create: `/workspace/eslint.config.mjs`
- Create: `/workspace/.prettierrc.json`
- Create: `/workspace/.prettierignore`
- Create: `/workspace/.env.example`
- Create: `/workspace/.github/workflows/ci.yml`
- Create: `/workspace/README.md`
- Modify: `/workspace/.gitignore`

**Interfaces:**

- Consumes: nothing (root of the tree).
- Produces: installable workspace with scripts `build`, `test`, `typecheck`, `lint`, `format`, `demo:express`, `demo:nestjs`; shared TS base config every package extends.

- [ ] **Step 1: Root `package.json`**

```json
{
  "name": "nodeui-monorepo",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "npm run build -w @nodeui/core && npm run build -w @nodeui/express && npm run build -w @nodeui/nestjs && npm run build -w @nodeui/ui",
    "test": "npm run test -w @nodeui/core && npm run test -w @nodeui/express && npm run test -w @nodeui/nestjs && npm run test -w @nodeui/ui",
    "typecheck": "npm run typecheck -w @nodeui/core && npm run typecheck -w @nodeui/express && npm run typecheck -w @nodeui/nestjs && npm run typecheck -w @nodeui/ui && npm run typecheck -w @nodeui/demo-express && npm run typecheck -w @nodeui/demo-nestjs",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "demo:express": "npm run dev -w @nodeui/demo-express",
    "demo:nestjs": "npm run dev -w @nodeui/demo-nestjs"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.0",
    "eslint": "^9.39.0",
    "eslint-config-prettier": "^10.1.0",
    "prettier": "^3.6.2",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.44.0"
  }
}
```

- [ ] **Step 2: `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 3: `eslint.config.mjs` (flat config)**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/static/**',
      '**/build/**',
      'apps/ui/.vite/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  prettier,
);
```

- [ ] **Step 4: `.prettierrc.json` + `.prettierignore`**

```json
{ "printWidth": 100, "singleQuote": true, "trailingComma": "all" }
```

`.prettierignore`: `node_modules`, `dist`, `static`, `build`, `coverage`, `package-lock.json`.

- [ ] **Step 5: `.env.example`** (documents all env vars)

```
# NodeUI - Local Developer Console
# Activation: set NODEUI_ENABLED=true explicitly, or rely on dev NODE_ENV.
NODEUI_ENABLED=
NODEUI_HOST=127.0.0.1
NODEUI_PORT=3000
NODEUI_PATH=/nodeui
NODEUI_REQUEST_LOG_SIZE=500
NODEUI_POLL_INTERVAL_MS=2000
```

- [ ] **Step 6: `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm install
      - run: npm run lint
      - run: npm run format:check
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 7: `.gitignore` additions** (append)

```
# NodeUI
packages/*/coverage/
apps/ui/coverage/
apps/ui/.vite/
*.heapsnapshot
```

- [ ] **Step 8: `README.md`** — one-page overview: what it is, monorepo layout, quickstart (install, build, run demos), env vars table, safety model, links to per-package docs.

- [ ] **Step 9: Verify**

Run: `npm install` — expects success, creates root `node_modules` and lockfile.
Run: `npx prettier --check package.json tsconfig.base.json` — PASS.

---

### Task 2: Core — Types & Contracts

**Files:**

- Create: `/workspace/packages/core/package.json`
- Create: `/workspace/packages/core/tsconfig.json`
- Create: `/workspace/packages/core/vitest.config.ts`
- Create: `/workspace/packages/core/src/types.ts`
- Create: `/workspace/packages/core/src/index.ts`

**Interfaces:**

- Consumes: root scaffold.
- Produces: the shared typed contract — `PanelId`, `NodeUIConfig`, `ProviderContext`, `ProviderResult`, `ApiEnvelope`, all panel data types, `NodeUIProvider`. Exported from `@nodeui/core`.

- [ ] **Step 1: `packages/core/package.json`**

```json
{
  "name": "@nodeui/core",
  "version": "0.1.0",
  "description": "Framework-neutral engine and safety gate for the NodeUI developer console.",
  "license": "Apache-2.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "static"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.19.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 4: `src/types.ts`** — the complete typed contract (exact contents):

```ts
export type PanelId =
  'health' | 'memory' | 'cpu' | 'event-loop' | 'heap-snapshot' | 'startup' | 'requests';

export interface NodeUIConfig {
  path: string;
  host: string;
  port: number;
  requestLogSize: number;
  pollIntervalMs: number;
  enabled: boolean;
  activationReason: string;
  maskSecrets: boolean;
  inactivityTimeoutMs: number;
  confirmTtlMs: number;
  heapSnapshotDir: string;
}

export interface ProviderContext {
  config: NodeUIConfig;
  env: Record<string, string | undefined>;
  store: Record<string, unknown>;
}

export interface ProviderError {
  code: string;
  message: string;
}

export type ProviderResult<T> = { ok: true; data: T } | { ok: false; error: ProviderError };

export type ApiEnvelope<T> = ProviderResult<T>;

export interface NodeUIProvider<T = unknown> {
  readonly id: PanelId;
  start?(ctx: ProviderContext): void;
  stop?(ctx: ProviderContext): void;
  get(ctx: ProviderContext): ProviderResult<T> | Promise<ProviderResult<T>>;
}

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

export interface HealthData {
  status: 'ok' | 'degraded' | 'critical' | 'unknown';
  statusReason: string;
  uptimeSeconds: number;
  pid: number;
  nodeVersion: string;
  platform: string;
  eventLoopLagMs: number | null;
  memoryUsedPercent: number | null;
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

export interface ConfigData {
  enabled: boolean;
  activationReason: string;
  path: string;
  host: string;
  port: number;
  requestLogSize: number;
  pollIntervalMs: number;
  panels: PanelId[];
  masking: { enabled: boolean; pattern: string };
}
```

- [ ] **Step 5: `src/index.ts`** — export everything from `types.ts` plus placeholder re-exports that later tasks fill:

```ts
export * from './types';
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck -w @nodeui/core` — PASS (no files yet for other symbols; keep index minimal until added).

---

### Task 3: Core — Ring Buffer, Secret Masking, Safety Gate, Confirmations

**Files:**

- Create: `/workspace/packages/core/src/ring-buffer.ts`
- Create: `/workspace/packages/core/test/ring-buffer.test.ts`
- Create: `/workspace/packages/core/src/safety.ts`
- Create: `/workspace/packages/core/test/safety.test.ts`
- Create: `/workspace/packages/core/src/confirmations.ts`
- Create: `/workspace/packages/core/test/confirmations.test.ts`

**Interfaces:**

- Consumes: `types.ts`.
- Produces:
  - `class RingBuffer<T> { constructor(size: number); push(item: T): void; get length(): number; toArray(): T[]; slice(offset?: number, limit?: number): T[] }` — head-pointer ring buffer, drops oldest when full.
  - `resolveActivation(env): { active: boolean; reason: string }` — active if `NODEUI_ENABLED === "true"` OR `NODE_ENV !== "production"`.
  - `isLoopbackAddress(address): boolean` — `127.*`, `::1`, `::ffff:127.*`.
  - `SECRET_KEY_PATTERN` = `/token|key|secret|password|credential/i`.
  - `maskSecrets<T>(value: T): T` — deep-clone walk, replaces values under matching keys with `"[REDACTED]"`.
  - `class ConfirmationStore { constructor(ttlMs: number); issue(): ConfirmIssued; consume(nonce: string): boolean; size(): number; prune(): void }` — single-use, expiring nonces.

- [ ] **Step 1: Write failing tests** (`ring-buffer.test.ts`, `safety.test.ts`, `confirmations.test.ts`) covering: push/length/drop-oldest/slice-pagination; activation matrix (prod+unset → inactive; dev NODE_ENV → active; NODEUI_ENABLED=true → active in prod); loopback checks; masking (keys, deep nesting, arrays, pass-through non-matching); confirmation issue/consume/single-use/expiry.

- [ ] **Step 2: Run tests to verify they fail** — `npm test -w @nodeui/core` — FAIL (modules missing).

- [ ] **Step 3: Implement `ring-buffer.ts`**

```ts
export class RingBuffer<T> {
  private buffer: Array<T | undefined>;
  private head = 0;
  private count = 0;
  readonly capacity: number;

  constructor(size: number) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error('RingBuffer size must be a positive integer');
    }
    this.capacity = size;
    this.buffer = new Array<T | undefined>(size);
  }

  push(item: T): void {
    this.buffer[(this.head + this.count) % this.capacity] = item;
    if (this.count < this.capacity) {
      this.count += 1;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  get length(): number {
    return this.count;
  }

  toArray(): T[] {
    return this.slice(0, this.count);
  }

  slice(offset = 0, limit?: number): T[] {
    const capped = limit === undefined ? this.count : Math.max(0, limit);
    const out: T[] = [];
    for (let i = 0; i < this.count && out.length < capped; i += 1) {
      if (i >= offset) out.push(this.buffer[(this.head + i) % this.capacity] as T);
    }
    return out;
  }
}
```

- [ ] **Step 4: Implement `safety.ts`**

```ts
import { SECRET_MASKED } from './constants';

export const SECRET_KEY_PATTERN = /token|key|secret|password|credential/i;

export function resolveActivation(env: Record<string, string | undefined>): {
  active: boolean;
  reason: string;
} {
  if (env.NODEUI_ENABLED === 'true') {
    return { active: true, reason: 'activated by NODEUI_ENABLED=true' };
  }
  if (env.NODE_ENV !== 'production') {
    return {
      active: true,
      reason: `activated by NODE_ENV="${env.NODE_ENV ?? 'unset'}" (non-production)`,
    };
  }
  return {
    active: false,
    reason: "inactive: NODE_ENV=production and NODEUI_ENABLED is not 'true' (fail-closed)",
  };
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return (
    address.startsWith('127.') ||
    address === '::1' ||
    address.startsWith('::ffff:127.') ||
    address === 'localhost'
  );
}

export function maskSecrets<T>(value: T, pattern: RegExp = SECRET_KEY_PATTERN): T {
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v, pattern)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (pattern.test(key)) {
        out[key] = SECRET_MASKED;
      } else {
        out[key] = maskSecrets(v, pattern);
      }
    }
    return out as T;
  }
  return value;
}
```

(Add `/workspace/packages/core/src/constants.ts` with `export const SECRET_MASKED = "[REDACTED]";` and `export const DEFAULT_HEAP_SNAPSHOT_DIR = ...` later — keep constants file now.)

- [ ] **Step 5: Implement `confirmations.ts`**

```ts
import { randomBytes } from 'node:crypto';
import type { ConfirmIssued } from './types';

export class ConfirmationStore {
  private nonces = new Map<string, number>();
  constructor(private readonly ttlMs: number) {}

  issue(): ConfirmIssued {
    this.prune();
    const nonce = randomBytes(16).toString('hex');
    const expiresAtMs = Date.now() + this.ttlMs;
    this.nonces.set(nonce, expiresAtMs);
    return { nonce, expiresAtMs, ttlMs: this.ttlMs };
  }

  consume(nonce: string): boolean {
    this.prune();
    const expiresAt = this.nonces.get(nonce);
    if (expiresAt === undefined) return false;
    this.nonces.delete(nonce);
    return Date.now() <= expiresAt;
  }

  size(): number {
    this.prune();
    return this.nonces.size;
  }

  prune(): void {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.nonces) {
      if (expiresAt <= now) this.nonces.delete(nonce);
    }
  }
}
```

- [ ] **Step 6: Run tests to verify they pass** — `npm test -w @nodeui/core` — PASS.

---

### Task 4: Core — Providers (7 panels)

**Files:**

- Create: `/workspace/packages/core/src/providers/startup-tracker.ts`
- Create: `/workspace/packages/core/src/providers/health.ts`
- Create: `/workspace/packages/core/src/providers/memory.ts`
- Create: `/workspace/packages/core/src/providers/cpu.ts`
- Create: `/workspace/packages/core/src/providers/event-loop.ts`
- Create: `/workspace/packages/core/src/providers/heap-snapshot.ts`
- Create: `/workspace/packages/core/src/providers/requests.ts`
- Create: `/workspace/packages/core/src/providers/sampler.ts`
- Create: `/workspace/packages/core/test/providers.test.ts`

**Interfaces:**

- Consumes: `types.ts`, `ring-buffer.ts`.
- Produces: one `NodeUIProvider` per panel, each a named class:
  - `class StartupTracker { mark(name: string): void; getData(): StartupData; reset(): void }` — used by server + startup provider.
  - `MemoryProvider implements NodeUIProvider<MemoryData>` — samples every `pollIntervalMs`, writes latest to `ctx.store["memory"]`.
  - `CpuProvider implements NodeUIProvider<CpuData>` — delta of `process.cpuUsage()` every `pollIntervalMs`.
  - `EventLoopLagProvider implements NodeUIProvider<EventLoopSample>` — background `setInterval`, drift measurement, rolling samples (keep last 600), writes latest to `ctx.store["event-loop"]`.
  - `HealthProvider implements NodeUIProvider<HealthData>` — reads `store["memory"]` + `store["event-loop"]`; status derived from lag thresholds (<50 ok, <200 degraded, else critical; unknown when no samples).
  - `HeapSnapshotProvider implements NodeUIProvider<HeapSnapshotPanelData>` — `get()` returns `{ supported, lastSnapshot }`; `takeSnapshot(ctx): Promise<HeapSnapshotData>` writes via `v8.writeHeapSnapshot` into `config.heapSnapshotDir`; tracks last snapshot.
  - `RequestsProvider implements NodeUIProvider<RequestsData>` — wraps a `RingBuffer<RequestEntry>`; `record(entry)`; `get()` returns `{ total, entries: last N }`.
  - `class Sampler<T> { constructor({ intervalMs, collect, onSample }); start(): void; stop(): void; get isRunning(): boolean }` — idempotent start, tracked/cleared interval.
  - `class LazySampler<T> { constructor(sampler, ctx); start(): void; stop(): void }` helper used by sampled providers.

- [ ] **Step 1: Write failing tests** (`providers.test.ts`) — use fake timers (`vi.useFakeTimers()`): memory provider returns typed numbers and populates store; CPU returns percentages in `[0, 100]` (inject a fake `cpuUsage`/`hrtime` via provider constructor params for determinism); event-loop provider measures drift (advance fake timers with imprecise setInterval via `vi.advanceTimersByTime`); startup tracker marks ordered with `sinceFirstMs`; requests provider bounds to capacity and paginates via `slice`; heap snapshot provider `takeSnapshot` writes a file (temp dir via `fs.mkdtemp`) and `get()` reflects it, returns clean error when unsupported.

- [ ] **Step 2: Run tests to verify they fail** — FAIL (missing modules).

- [ ] **Step 3: Implement `sampler.ts`**

```ts
export interface SamplerOptions<T> {
  intervalMs: number;
  collect: () => T;
  onSample: (sample: T) => void;
}

export class Sampler<T> {
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly opts: SamplerOptions<T>) {}

  start(): void {
    if (this.timer) return;
    const run = (): void => {
      try {
        this.opts.onSample(this.opts.collect());
      } catch {
        // sampling must never throw into the event loop
      }
    };
    this.timer = setInterval(run, this.opts.intervalMs);
    run();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }
}
```

- [ ] **Step 4: Implement `startup-tracker.ts`, `memory.ts`, `cpu.ts`, `event-loop.ts`, `health.ts`, `heap-snapshot.ts`, `requests.ts`** following the exact types from Task 2. Key formulas:

- CPU percent: `userPercent = userUs / (elapsedMs * 1000) * 100` where `userUs` is microsecond delta and `elapsedMs` the wall-clock delta; `totalPercent = (userUs + systemUs) / (elapsedMs * 1000) * 100`.
- Event-loop lag: `driftMs = deltaNs / 1e6 - intervalMs; lagMs = max(0, driftMs)`; store `currentMs`, `maxMs`, `avgMs` (rolling mean over kept samples), `count`, `sampleAtMs`.
- Heap snapshot filename: `nodeui-heap-<pid>-<yyyyMMdd-HHmmss>.heapsnapshot`; return `{ fileName, filePath, sizeBytes, createdAtMs }`; delete nothing.
- Requests provider `get()` returns `entries` as `slice(length - 100)` (last 100) with `total = length`.
- Sampled providers write `ctx.store[id] = latest` in `onSample`; `start()` creates a `Sampler` (idempotent); `stop()` clears it; `get()` returns latest (or typed zeroed data with `sampleAtMs: 0` when never sampled).

- [ ] **Step 5: Run tests to verify they pass** — PASS.

---

### Task 5: Core — Server (router, middleware, static, API)

**Files:**

- Create: `/workspace/packages/core/src/static.ts`
- Create: `/workspace/packages/core/src/server.ts`
- Create: `/workspace/packages/core/src/registry.ts`
- Create: `/workspace/packages/core/test/server.test.ts`

**Interfaces:**

- Consumes: all of Tasks 2–4.
- Produces:
  - `createNodeUI(options?: NodeUIOptions): NodeUIServer`
  - `interface NodeUIOptions { path?; host?; port?; requestLogSize?; pollIntervalMs?; enabled?; env?; maskSecrets?; inactivityTimeoutMs?; confirmTtlMs?; heapSnapshotDir?; log? }`
  - `interface NodeUIServer { readonly config: NodeUIConfig; readonly active: boolean; readonly activationReason: string; middleware(): NodeUIMiddleware; mark(name: string): void; shutdown(): void; recordRequest(entry: RequestEntry): void }`
  - `type NodeUIMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void`
  - REST routes under `${path}/api`: `GET /config`, `GET /health`, `GET /memory`, `GET /cpu`, `GET /event-loop`, `GET /startup`, `GET /requests`, `GET /heap-snapshot`, `POST /confirmations`, `POST /heap-snapshot` (requires `x-nodeui-confirm` nonce header).
  - Static serving of `packages/core/static` under `${path}/` with SPA fallback to `index.html`; path-traversal safe.

- [ ] **Step 1: Write failing tests** (`server.test.ts`) — spin a real `http.createServer` on an ephemeral port with `middleware()` and fetch via global `fetch`:
  - active in dev env; `GET /nodeui/api/config` returns envelope `{ ok: true, data: { enabled: true, ... } }`.
  - all 7 GET panels return `{ ok: true, data }`.
  - fail-closed: `env: { NODE_ENV: "production" }`, no `NODEUI_ENABLED` → middleware no-ops (server returns 404 for `/nodeui/api/config`), no timers leaked (assert `active === false`).
  - `POST /nodeui/api/heap-snapshot` without nonce → `{ ok: false, error: { code: "confirmation-required" } }`; with nonce from `POST /confirmations` → `{ ok: true, data: { fileName, ... } }` (writes into `fs.mkdtemp` dir).
  - loopback: request from non-loopback source address (simulate via `socket.setTimeout`? — instead unit-test `isLoopbackAddress` and test that middleware rejects a crafted `remoteAddress` by injecting a fake socket — implement middleware to read `req.socket.remoteAddress`; in test, pass a request object with overridden `socket.remoteAddress` through `server.handle` directly) → 403 envelope.
  - request log: hit `/hello` twice through middleware, then `GET /nodeui/api/requests` shows 2 entries with statuses; nodeui's own API paths are excluded.
  - masking: memory provider response passes through `maskSecrets`; unit-level assert `maskSecrets` on a nested sample.
  - static: `GET /nodeui/` returns HTML containing `<div id="root">` (after Task 8 builds UI); before that, test uses a fixture file written into `packages/core/static`.

- [ ] **Step 2: Run tests to verify they fail** — FAIL (missing `server.ts`).

- [ ] **Step 3: Implement `static.ts`** — `serveStaticFile(rootDir: string, urlPath: string): { content: Buffer; contentType: string } | null`, MIME map for `html/js/css/svg/json/png/ico/map/woff2`, path-traversal guard (`path.resolve` must stay inside `rootDir`), SPA fallback.

- [ ] **Step 4: Implement `registry.ts`** — `class ProviderRegistry { register(p: NodeUIProvider): void; get(id: PanelId): NodeUIProvider | undefined; all(): NodeUIProvider[] }`.

- [ ] **Step 5: Implement `server.ts`** — `createNodeUI(options)`:
  - Build `NodeUIConfig` from `options` + `env` (`options.env ?? process.env`); call `resolveActivation`.
  - Instantiate all providers + `StartupTracker` (mark `nodeui.init`), `ConfirmationStore`, `RingBuffer` for requests.
  - `middleware()` returns `(req, res, next)`: if not active → `next()`; if request path under `config.path` → `handleApiOrStatic(req, res)`; else → record request (start time, `res.on("finish")` status+duration, skip `/nodeui` API paths) then `next()`.
  - API handler: route on `pathname`; read nonce header `x-nodeui-confirm` for mutations; call provider `start()` + reset inactivity timer before `get()`; wrap all in try/catch returning `{ ok: false, error: { code: "internal-error" } }`; JSON responses.
  - Loopback check for API/static: if `!isLoopbackAddress(req.socket.remoteAddress)` and `isLoopbackAddress(config.host)` → 403 envelope `{ ok: false, error: { code: "forbidden", message: "nodeui is loopback-only" } }`.
  - Inactivity timer: `inactivityTimeoutMs`; on fire → `stop()` all providers.
  - `mark(name)` → startup tracker; `shutdown()` → stop all timers (samplers, inactivity), clear confirmations.
  - `recordRequest(entry)` → ring buffer push (id auto-increment).
  - Export `NodeUIOptions`, `NodeUIServer`, `NodeUIMiddleware`.

- [ ] **Step 6: Run tests to verify they pass** — PASS.

---

### Task 6: Core — Integration/E2E tests + polish

**Files:**

- Create: `/workspace/packages/core/test/e2e.test.ts`

**Interfaces:**

- Consumes: `createNodeUI` from Task 5.
- Produces: no new API; proof the safety + performance invariants hold end-to-end.

- [ ] **Step 1: Write e2e test** — real http server + fetch:
  - fail-closed e2e: `NODE_ENV=production`, no flag → `/nodeui/api/config` 404, app's own route works.
  - activation override: same production env but `NODEUI_ENABLED=true` → active.
  - mutation flow end-to-end: confirmations → nonce → heap snapshot POST → file exists on disk (mkdtemp dir), then GET `/api/heap-snapshot` reports `lastSnapshot.fileName`.
  - nonce reuse → second POST rejected.
  - request log excludes nodeui paths, includes app route.
  - lazy lifecycle: assert sampled provider's sampler not running before first request, running after, and stopped after `inactivityTimeoutMs` (short timeout, fake timers not needed — use real 50ms timeout).
- [ ] **Step 2: Run tests** — PASS.
- [ ] **Step 3: `src/index.ts` final exports** — export `types`, `ring-buffer`, `safety`, `confirmations`, `server` (`createNodeUI`, types), `providers` (classes), `registry`, `static`. Ensure `tsc` clean.
- [ ] **Step 4: Run full core suite** — `npm test -w @nodeui/core` PASS; `npm run typecheck -w @nodeui/core` PASS.

---

### Task 7: Express Adapter

**Files:**

- Create: `/workspace/packages/express/package.json`
- Create: `/workspace/packages/express/tsconfig.json`
- Create: `/workspace/packages/express/src/index.ts`
- Create: `/workspace/packages/express/test/express.test.ts`

**Interfaces:**

- Consumes: `@nodeui/core` (`createNodeUI`, `NodeUIOptions`, `NodeUIServer`, `NodeUIMiddleware`).
- Produces: `nodeui(options?: NodeUIOptions): { middleware: NodeUIMiddleware; server: NodeUIServer }` — Express middleware mounting the core; `@nodeui/express` package.

- [ ] **Step 1: `packages/express/package.json`** — name `@nodeui/express`, `main`/`types` → `dist`, `files: ["dist"]`, dep `"@nodeui/core": "*"`, devDeps `@types/express`, `@types/node`, `express`, `supertest`, `@types/supertest`, `typescript`, `vitest`. Scripts `build`, `typecheck`, `test`.
- [ ] **Step 2: `tsconfig.json`** (extends base, outDir dist, rootDir src).
- [ ] **Step 3: `src/index.ts`**

```ts
import {
  createNodeUI,
  type NodeUIMiddleware,
  type NodeUIOptions,
  type NodeUIServer,
} from '@nodeui/core';

export interface NodeUIExpress {
  middleware: NodeUIMiddleware;
  server: NodeUIServer;
}

export function nodeui(options?: NodeUIOptions): NodeUIExpress {
  const server = createNodeUI(options);
  return { middleware: server.middleware(), server };
}

export * from '@nodeui/core';
```

- [ ] **Step 4: Write failing integration test** (`express.test.ts`) — express app with `app.use(nodeui().middleware)`, route `/hello` returning JSON; supertest:
  - `GET /nodeui/api/config` → 200, `body.ok === true`, `body.data.path === "/nodeui"`.
  - `GET /nodeui/api/health` → 200 `ok`.
  - `GET /hello` → 200; then `GET /nodeui/api/requests` shows entry `path: "/hello"`.
  - `GET /nodeui/api/requests` itself not in log.
  - production env (pass `env: { NODE_ENV: "production" }`) → `GET /nodeui/api/config` 404, `/hello` still works.
- [ ] **Step 5: Run tests** — PASS.
- [ ] **Step 6: `src/index.ts` typecheck** — PASS.

---

### Task 8: NestJS Adapter

**Files:**

- Create: `/workspace/packages/nestjs/package.json`
- Create: `/workspace/packages/nestjs/tsconfig.json`
- Create: `/workspace/packages/nestjs/src/index.ts`
- Create: `/workspace/packages/nestjs/src/nodeui.module.ts`
- Create: `/workspace/packages/nestjs/src/nodeui.service.ts`
- Create: `/workspace/packages/nestjs/test/nestjs.test.ts`

**Interfaces:**

- Consumes: `@nodeui/core`.
- Produces: `NodeUIModule.register(options?: NodeUIOptions): DynamicModule` (NestModule applying core middleware to `'*'`), `NodeUIService` (injectable, `mark(name)`), `NODEUI_SERVER` injection token.

- [ ] **Step 1: `packages/nestjs/package.json`** — name `@nodeui/nestjs`, peerDependencies `@nestjs/common ^11`, `@nestjs/core ^11`, `reflect-metadata`, `rxjs`; devDependencies include `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/testing`, `reflect-metadata`, `rxjs`, `express`, `supertest`, `@types/supertest`, `@types/express`, typescript, vitest. Dep `"@nodeui/core": "*"`.
- [ ] **Step 2: `tsconfig.json`** (extends base, outDir dist, rootDir src; note Nest decorators need `"experimentalDecorators": true` and `"emitDecoratorMetadata": true`).
- [ ] **Step 3: `src/index.ts`** exports module, service, token, and `@nodeui/core`.
- [ ] **Step 4: Write failing test** (`nestjs.test.ts`) — `Test.createTestingModule({ imports: [NodeUIModule.register()] })`, compile; `app.getHttpAdapter().getInstance()` gives the express instance; use supertest:
  - `GET /nodeui/api/config` → 200 ok (validates `forRoutes("*")` reaches unregistered paths).
  - `GET /nodeui/api/health` → 200.
  - Inject `NodeUIService`, call `mark("booted")`, then `GET /nodeui/api/startup` contains `booted`.
  - production env (`register({ env: { NODE_ENV: "production" } })`) → 404.
- [ ] **Step 5: Run tests** — PASS.

---

### Task 9: UI Console (Vite + React)

**Files:**

- Create: `/workspace/apps/ui/package.json`
- Create: `/workspace/apps/ui/tsconfig.json`
- Create: `/workspace/apps/ui/vite.config.ts`
- Create: `/workspace/apps/ui/index.html`
- Create: `/workspace/apps/ui/src/main.tsx`
- Create: `/workspace/apps/ui/src/App.tsx`
- Create: `/workspace/apps/ui/src/api.ts`
- Create: `/workspace/apps/ui/src/types.ts`
- Create: `/workspace/apps/ui/src/hooks.ts`
- Create: `/workspace/apps/ui/src/styles.css`
- Create: `/workspace/apps/ui/src/panels/*.tsx` (Health, Memory, Cpu, EventLoop, Startup, Requests, HeapSnapshot, plus shared `Panel.tsx`)
- Create: `/workspace/apps/ui/src/ConfirmDialog.tsx`
- Create: `/workspace/apps/ui/test/smoke.test.tsx`
- Create: `/workspace/apps/ui/scripts/verify-build.mjs`

**Interfaces:**

- Consumes: core's REST contract (mirrored as local TS types in `src/types.ts`).
- Produces: static bundle in `/workspace/packages/core/static` (Vite `build.outDir` + `emptyOutDir: true` + `base: "./"`), which core serves.

- [ ] **Step 1: `apps/ui/package.json`** — private, `@nodeui/ui`, deps `react`, `react-dom`; devDeps `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `typescript`, `vite`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@types/node`. Scripts: `build` (`vite build`), `dev` (`vite`), `typecheck`, `test` (`vitest run` then `node scripts/verify-build.mjs`).
- [ ] **Step 2: `vite.config.ts`** — `plugin react()`, `base: "./"`, `server: { allowedHosts: [".monkeycode-ai.live"] }`, `build.outDir: "../../packages/core/static"`, `emptyOutDir: true`.
- [ ] **Step 3: `src/types.ts`** — mirror of core panel types (subset actually needed by UI).
- [ ] **Step 4: `src/api.ts`** — `apiUrl(path)` derives base from `window.location` (`/nodeui/api`), `getConfig()`, `getPanel(path)`, `issueConfirmation()`, `takeHeapSnapshot(nonce)` typed fetches with envelope unwrapping and typed error throwing.
- [ ] **Step 5: `src/hooks.ts`** — `usePolledPanel<T>(path)` — polls every `pollIntervalMs` (from config) with exponential backoff (1x, 2x, 4x, … max 30s) on failure; returns `{ data, error, loading, refetch }`; cleanup on unmount; also `useConfig()`.
- [ ] **Step 6: `src/App.tsx` + panels** — dark theme, header ("nodeui" + status badge), grid of 7 panels. Each panel component: title, value, unit; Health (status + metrics), Memory (bar + numbers), CPU (percent + sparkline), Event-loop (current/max/avg + sparkline), Startup (timeline of marks), Requests (table), Heap snapshot (button + last snapshot info). Mutation flow: "Capture heap snapshot" → `ConfirmDialog` ("This action writes a heap snapshot file to disk. Continue?") → issue nonce → POST → show result. Sparklines = hand-rolled inline SVG (no chart lib).
- [ ] **Step 7: `styles.css`** — dark theme (CSS variables), grid layout, panel cards, badges, dialog overlay.
- [ ] **Step 8: `scripts/verify-build.mjs`** — asserts `packages/core/static/index.html` and `packages/core/static/assets/*.js` exist.
- [ ] **Step 9: Write failing smoke test** (`smoke.test.tsx`) — vitest + jsdom + testing-library: mock `global.fetch` (config + empty panel data), render `<App />`, assert title `nodeui` and the 7 panel headings render; heap snapshot button opens the confirm dialog.
- [ ] **Step 10: Run tests** — `npm test -w @nodeui/ui` PASS; then `npm run build -w @nodeui/ui` and verify static assets copied to `packages/core/static`.

---

### Task 10: Demo Apps

**Files:**

- Create: `/workspace/apps/demo-express/package.json`
- Create: `/workspace/apps/demo-express/tsconfig.json`
- Create: `/workspace/apps/demo-express/src/index.ts`
- Create: `/workspace/apps/demo-express/.env.example`
- Create: `/workspace/apps/demo-nestjs/package.json`
- Create: `/workspace/apps/demo-nestjs/tsconfig.json`
- Create: `/workspace/apps/demo-nestjs/src/main.ts`
- Create: `/workspace/apps/demo-nestjs/src/app.module.ts`
- Create: `/workspace/apps/demo-nestjs/src/app.controller.ts`
- Create: `/workspace/apps/demo-nestjs/.env.example`

**Interfaces:**

- Consumes: `@nodeui/express` / `@nodeui/nestjs` (built packages), built UI in core/static.
- Produces: two runnable demo apps for manual verification (ports 3000 / 3001).

- [ ] **Step 1: `demo-express`** — express app: `app.use(express.json())`, `const { middleware, server } = nodeui(); app.use(middleware);`, routes `/hello` (returns JSON), `/slow` (200ms setTimeout), `/boom` (throws → error handler). `app.listen(3000, '127.0.0.1', () => { server.mark("listening"); console.log(...) })`. devDeps: `tsx`, `@types/express`, `express`, `@nodeui/express`, typescript. Scripts: `dev: tsx watch src/index.ts`, `start: tsx src/index.ts`, `typecheck`.
- [ ] **Step 2: `demo-nestjs`** — `AppModule` imports `NodeUIModule.register()`, controller `GET /hello`. `main.ts`: `NestFactory.create(AppModule)`, `await app.listen(3001, "127.0.0.1")`, then mark listening via `app.get(NodeUIService).mark("listening")`. devDeps: `tsx`, `@nestjs/*`, `reflect-metadata`, `rxjs`, `@nodeui/nestjs`. Scripts: `dev`, `start`, `typecheck`.
- [ ] **Step 3: `.env.example`** for both — port, NODEUI vars.
- [ ] **Step 4: Verify** — `npm run build` then start `demo-express` in background terminal; `curl http://127.0.0.1:3000/nodeui/api/config` → `{ ok: true, ... }`; `curl http://127.0.0.1:3000/hello`; hit `/slow` twice; `curl .../nodeui/api/requests` shows entries. Kill. Repeat for `demo-nestjs` on 3001.

---

### Task 11: Quality Pass + Docs + Final Verification

**Files:**

- Modify: `/workspace/README.md`
- Create: `/workspace/docs/PROJECT_INFO.md` (optional, if needed)
- Create: `/workspace/packages/core/README.md`, `/workspace/packages/express/README.md`, `/workspace/packages/nestjs/README.md`

**Interfaces:**

- Consumes: everything.
- Produces: lint/format/typecheck/test/build all green; docs.

- [ ] **Step 1: Docs** — root README + per-package READMEs: install, mount code, env vars, safety model, API route table, provider list.
- [ ] **Step 2: Full verification**

Run: `npm run lint` — no errors.
Run: `npm run format:check` — PASS.
Run: `npm run typecheck` — PASS.
Run: `npm test` — all suites PASS.
Run: `npm run build` — all packages build; static assets present.

- [ ] **Step 3: Manual demo walk** — start demo-express via background terminal, request preview URL, verify all 7 panels populate; verify heap snapshot requires confirmation; verify `NODE_ENV=production` run → 404. Kill terminal.

---

## Self-Review Notes

- **Spec coverage:** Layout (T1, T10), core 7 panels (T4), safety model (T3, T5, T6), error contract (T4, T5), performance/lazy/throttle/bounded/zero-cost (T4, T5, T6), env config (T1, T5), tests per provider + adapters + UI smoke (T3–T9), success criteria incl. fail-closed and masking (T5, T6, T11). BootUI naming/UX parity documented in README.
- **Placeholders:** none — every step carries code or an exact command; the large mechanical files (providers, panels) specify exact formulas, shapes, and files.
- **Type consistency:** `PanelId` values match provider ids and UI mirror types; `ApiEnvelope<T>` is `ProviderResult<T>`; `NodeUIServer`/`NodeUIMiddleware` names match across T5–T8; env vars match `.env.example` (T1) and config resolution (T5).
