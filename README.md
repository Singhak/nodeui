# NodeUI — Local Developer Console for Node.js Backends

NodeUI is a BootUI-inspired, **local-only** developer console for Express and
NestJS applications. Add one dependency and get a bundled React console plus a
REST API that expose runtime observability — health, memory, CPU, event-loop
lag, heap snapshots, startup timing, HTTP traffic (with a live metrics chart),
environment variables, declared routes, and captured console logs — served by
your own application. No separate frontend deployment required.

## Why

BootUI exists for Spring Boot and Quarkus, but the Node ecosystem has no
equivalent embedded dev console. Today Node developers stitch together
`node --inspect` + Chrome DevTools, `clinic.js`, and `console.log`. NodeUI is
that whitespace: open source, embedded in your app, visible only on your own
machine, and zero-cost when disabled.

## Packages

| Package                        | Description                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `@singhak/nodeui-core`         | Framework-neutral engine: 10 observability providers, REST contract, safety gate, static asset server. |
| `@singhak/nodeui-express`      | Express middleware adapter.                                                                            |
| `@singhak/nodeui-nestjs`       | NestJS module adapter.                                                                                 |
| `apps/ui`                      | React + Vite console, built into static assets embedded in `@singhak/nodeui-core`.                     |
| `apps/demo-express`            | Sample Express app for manual verification.                                                            |
| `apps/demo-nestjs`             | Sample NestJS app for manual verification.                                                             |

## Quickstart

```bash
npm install
npm run build
npm run demo:express   # http://127.0.0.1:3000/nodeui
npm run demo:nestjs    # http://127.0.0.1:3001/nodeui
```

## Installing in your app

```bash
npm install @singhak/nodeui-express     # Express (or @singhak/nodeui-nestjs for NestJS)
```

**Express:**

```ts
import express from 'express';
import { nodeui } from '@singhak/nodeui-express';

const app = express();
const { middleware, server } = nodeui();
app.use(middleware);

app.get('/hello', (_req, res) => res.json({ hello: 'world' }));

app.listen(3000, '127.0.0.1', () => {
  server.mark('listening');
});
```

**NestJS:**

```ts
import { Module } from '@nestjs/common';
import { NodeUIModule } from '@singhak/nodeui-nestjs';

@Module({ imports: [NodeUIModule.register()] })
export class AppModule {}
```

Both adapters accept the same options object. Open the console at
`{path}/` (default `/nodeui`) and the API at `{path}/api`.

| Option                | Default     | Description                                                     |
| --------------------- | ----------- | --------------------------------------------------------------- |
| `path`                | `/nodeui`   | URL path prefix for the console and API.                        |
| `host`                | `127.0.0.1` | Interface the console considers its own.                        |
| `port`                | host port   | Informational — the port your app listens on.                   |
| `requestLogSize`      | `500`       | Ring buffer capacity for the request log.                       |
| `logSize`             | `500`       | Ring buffer capacity for captured console log entries.          |
| `config`              | —           | App config surfaced in the Environment panel; object or getter. |
| `pollIntervalMs`      | `2000`      | Sampling/polling interval.                                      |
| `enabled`             | env-based   | Force activation (`true`) or deactivation (`false`).            |
| `maskSecrets`         | `true`      | Redact values under secret-matching keys in all panel output.   |
| `inactivityTimeoutMs` | `60000`     | Stop background samplers after this idle period.                |
| `confirmTtlMs`        | `60000`     | Lifetime of a mutation confirmation nonce.                      |
| `heapSnapshotDir`     | OS tmpdir   | Directory for captured `.heapsnapshot` files.                   |

The returned server exposes `mark(name)` to record bootstrap timing (visible on
the Startup Timeline), `addLogSource({ level, message })` to push external
logger entries into the Logs panel, and `shutdown()` to stop all timers.

```ts
const { middleware, server } = nodeui({
  path: '/console',
  config: { region: 'eu-west', build: '1.2.3' },
});

server.addLogSource({ level: 'info', message: 'db connected' });
```

## Panels

| Panel          | What it shows                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Health         | Status (ok/degraded/critical/unknown), uptime, pid, node version, lag snapshot                                          |
| Memory         | Heap used/total, RSS, external, system free/total, heap sparkline                                                       |
| CPU            | Total/user/system process CPU percent, sparkline                                                                        |
| Event-loop lag | Current/max/avg lag in ms, sample count, sparkline                                                                      |
| Heap snapshot  | One-click V8 snapshot capture (behind a confirmation nonce)                                                             |
| Startup        | Timing marks (e.g. `nodeui.init`, `listening`) from app bootstrap                                                       |
| Requests       | Recent HTTP requests (method, path, status, duration, time) plus a live chart of requests/interval, latency, and errors |
| Environment    | Selected `process.env` variables, secret-masked by the masking pattern                                                  |
| Routes         | Declared routes with method, path, and handler name from your app's router                                              |
| Logs           | `console.log`/`warn`/`error`/`info` captured via console interception                                                   |

## API

Served at `{NODEUI_PATH}/api` (default `/nodeui/api`). Every endpoint returns an
envelope: `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code",
"message" } }`. All payloads are secret-masked before serialization.

| Method | Route            | Description                                                    |
| ------ | ---------------- | -------------------------------------------------------------- |
| GET    | `/config`        | Effective configuration (activation, panels, masking pattern). |
| GET    | `/health`        | Health panel data.                                             |
| GET    | `/memory`        | Memory panel data.                                             |
| GET    | `/cpu`           | CPU panel data.                                                |
| GET    | `/event-loop`    | Event-loop lag panel data.                                     |
| GET    | `/heap-snapshot` | Snapshot support + last captured snapshot.                     |
| GET    | `/startup`       | Startup timing marks.                                          |
| GET    | `/requests`      | Request log (last 100 of the ring buffer).                     |
| GET    | `/env`           | Environment variables (secret-masked).                         |
| GET    | `/routes`        | Routes discovered from the app's Express router.               |
| GET    | `/logs`          | Console log entries (ring buffer).                             |
| GET    | `/live`          | SSE stream; `?panels=env,routes,logs,metrics` filters updates. |
| POST   | `/confirmations` | Issue a single-use nonce for a mutating action.                |
| POST   | `/heap-snapshot` | Capture a snapshot; requires `x-nodeui-confirm: <nonce>`.      |

The console UI itself is served at `{NODEUI_PATH}/` (SPA with a fallback to
`index.html`). Providers are lazy: a panel starts sampling on its first request
and stops after `NODEUI_INACTIVITY_TIMEOUT_MS` (default 60000) of inactivity.

## Configuration (env vars)

| Variable                       | Default     | Description                                            |
| ------------------------------ | ----------- | ------------------------------------------------------ |
| `NODEUI_ENABLED`               | unset       | `true` forces activation (even in production).         |
| `NODEUI_HOST`                  | `127.0.0.1` | Interface the console considers its own.               |
| `NODEUI_PORT`                  | host port   | Informational — console mounts on the host app's path. |
| `NODEUI_PATH`                  | `/nodeui`   | URL path prefix for the console + API.                 |
| `NODEUI_REQUEST_LOG_SIZE`      | `500`       | Ring buffer capacity for the request log.              |
| `NODEUI_LOG_SIZE`              | `500`       | Ring buffer capacity for captured console log entries. |
| `NODEUI_POLL_INTERVAL_MS`      | `2000`      | Sampling/polling interval.                             |
| `NODEUI_INACTIVITY_TIMEOUT_MS` | `60000`     | Stop sampling a provider after this idle period.       |
| `NODEUI_CONFIRM_TTL_MS`        | `60000`     | Lifetime of a confirmation nonce.                      |
| `NODEUI_HEAP_SNAPSHOT_DIR`     | OS tmpdir   | Directory for captured `.heapsnapshot` files.          |

## Safety model

- **Activation:** dev `NODE_ENV` or `NODEUI_ENABLED=true`; fails closed in
  production. `NODEUI_ENABLED=false` force-disables everywhere, even in dev.
- **Loopback-only:** non-loopback requests are rejected with 403.
- **Secret masking:** values under keys matching
  `TOKEN|KEY|SECRET|PASSWORD` are redacted in all panel output. Matching is a
  conservative substring match (so `apiKey` and `accessKeyId` are caught too);
  over-matching is intentional and safe.
- **Read-only default:** the only mutating action is the heap snapshot, which
  requires an explicit nonce confirmation issued by the API.
- **Zero-cost when disabled:** the middleware is a no-op passthrough; no
  timers, no hooks.

See [SECURITY.md](SECURITY.md) for the full security policy and the private
reporting process.

## Benchmarks

Local, synthetic overhead measurement of the middleware on a loopback HTTP
server (`scripts/bench.mjs`, Node 22, Express 5, 5000 requests per scenario).

```
Scenario                          mean    p50    p95    p99    rps
--------------------------------------------------------------------
baseline (no nodeui)              4.12  3.53  7.55 12.66    243
nodeui enabled                    3.92  3.44  7.93 13.11    255
nodeui disabled (fail-closed)     3.12  2.84  3.84  8.33    321
```

The enabled path records each request on `finish` (method, path, status,
duration) into a bounded ring buffer; the disabled path is a bare `next()`.
Overhead is within run-to-run noise for ordinary apps. Re-run anytime with
`npm run bench`. These numbers are indicative, not a guarantee — measure in
your own environment.

## FAQ / troubleshooting

**Why is the console only reachable from my machine?**
By default `NODEUI_HOST` is `127.0.0.1` and non-loopback requests are rejected
with `403`. This is deliberate: a developer console that can run arbitrary
snapshot mutations must not be exposed on a network interface. To make it
reachable from another host you must explicitly set `NODEUI_HOST` (NodeUI logs
a warning when you do). If you need remote access, put an authenticated
reverse proxy in front instead.

**The console is disabled in production — how do I enable it?**
Activation fails closed: in `NODE_ENV=production` the console is off unless
`NODEUI_ENABLED=true`. Prefer leaving it off; if you must enable it, combine
it with loopback binding and your own access control.

**My env vars show `[REDACTED]`.**
Values under keys matching `token|key|secret|password|credential` are masked
by default. Matching is a conservative substring check, so camelCase keys like
`apiKey` are caught too; set `maskSecrets: false` only if you understand the
tradeoff.

**The Routes panel says "No Express router captured yet".**
The router is captured from the first request that passes through the app.
Send at least one request to your own routes, then refresh. Route discovery is
cached per router instance, so routes registered dynamically after the first
fetch appear on the next process start.

**The Logs panel is missing my logger output.**
NodeUI intercepts `console.*` (not third-party loggers) and offers
`server.addLogSource({ level, message })` as an explicit adapter — wire your
logger to that method to include its entries. Console interception patches the
global `console` while a log-viewer client is active; if your app also patches
`console` (e.g. pino, winston, or a test runner), NodeUI detects the external
wrapper and leaves it intact when it stops, so your interceptor is never
clobbered.

**The console shows as "disabled" but I'm not in production.**
Check for a `NODE_ENV=production` value inherited from your shell or
orchestrator, or a `NODEUI_ENABLED=false` that force-disables it. Set
`NODEUI_ENABLED=true` (or `enabled: true`) to force it on.

**Heap snapshot capture returns a `409 confirmation-required`.**
Mutating actions need a fresh nonce: `POST {path}/api/confirmations`, then
repeat the request with an `x-nodeui-confirm: <nonce>` header. The UI does
this automatically via the confirmation dialog.

**Does it work with NestJS?**
Yes — `NodeUIModule.register()` mounts the same core middleware on `*` and
shares the underlying Express router for the Routes panel.

**What Node versions are supported?**
`>= 18`. The packages ship dual CommonJS and ESM builds with a single
`exports` map.

## Development

```bash
npm install
npm run lint        # ESLint
npm run format      # Prettier
npm run typecheck   # tsc --noEmit across all packages
npm test            # Vitest: core unit + adapter integration + UI smoke
npm run build       # core -> adapters -> UI (UI bundle lands in core/static)
npm run bench       # middleware overhead benchmark
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions, the panel
contribution guide, and the release process. Maintainers publish with
`npm run release:check` followed by `npm run publish`.

## License

Apache-2.0 — see [LICENSE](LICENSE).
