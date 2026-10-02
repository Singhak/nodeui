<div align="center">

# ⚡ NodeUI

### **The Local-Only Developer Console & Observability Suite for Node.js**

_An embedded, zero-infrastructure developer dashboard for Express, Fastify, NestJS, Koa, Hapi, Hono and plain Node — inspired by Spring Boot Admin & Quarkus Dev UI._

<br/>

[![npm version](https://img.shields.io/npm/v/@singhak/nodeui-express?color=6366f1&label=version&style=flat-square)](https://www.npmjs.com/package/@singhak/nodeui-express)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D%2018.0.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Framework-Express%20%7C%20Fastify%20%7C%20NestJS%20%7C%20Koa%20%7C%20Hapi%20%7C%20Hono-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

<br/>

[**How to use**](#-how-to-use-it-in-your-app) •
[**Key Features**](#-key-features) •
[**Framework Setup**](#-framework-integrations) •
[**Panels**](#-interactive-panels) •
[**Architecture**](#-architecture) •
[**Safety Model**](#-security--safety-model) •
[**Configuration**](#-configuration) •
[**FAQ**](#-faq--troubleshooting)

</div>

---

## 🎯 Overview

Spring Boot has **BootUI** and Quarkus has **Dev UI**, but Node.js developers have long had to stitch together `node --inspect`, Chrome DevTools, `clinic.js`, and ad-hoc `console.log` statements.

**NodeUI** fills that whitespace:

- 📦 **Embedded**: Bundled React UI + REST/SSE telemetry endpoints mounted directly inside your existing HTTP app.
- 🚀 **Zero Frontend Setup**: No external servers, no cloud telemetry, no docker containers to spin up.
- 🔒 **Local & Secure**: Loopback-only by default, automatic secret masking, and strict fail-closed safety in production.
- ⚡ **Low Overhead**: Lazy samplers that sleep when idle and bounded in-memory ring buffers. Disabled, the middleware is a plain `next()`; enabled, expect a fraction of a millisecond per request (see [Benchmarks](#-benchmarks--performance)).

---

## ✨ Key Features

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 NodeUI Hub                                  │
├──────────────────────┬──────────────────────┬───────────────────────────────┤
│ 🩺 Live Health & CPU │ 📈 Real-time Traffic │ 📸 V8 Heap Snapshots          │
│ Uptime, RSS, heap,   │ Latency distribution │ On-demand heap capture with   │
│ event-loop lag ms    │ RPS & error rates    │ 1-click single-use nonces     │
├──────────────────────┼──────────────────────┼───────────────────────────────┤
│ 🛣️ Route Discovery   │ 🔐 Secret Masking    │ 📜 Console Interception       │
│ Auto-scanned Express, │ Redacts tokens, keys │ In-memory ring buffer of      │
│ Fastify & Nest routes │ passwords in all API │ live logs with level filters  │
└──────────────────────┴──────────────────────┴───────────────────────────────┘
```

- **📊 Built-in Panels**: Health (with dependency checks), Requests, Queries, Errors, Outgoing HTTP calls, Runtime (Memory, CPU, Event-loop lag, Heap Snapshots), Routes, Logs, Environment, Startup Timeline and Metrics.
- **🔗 Request Correlation**: Outgoing HTTP calls and log lines are attributed to the request that caused them (via `AsyncLocalStorage`) and shown as a per-request timeline.
- **🔍 Request Detail (opt-in)**: Matched route pattern (`/users/:id`), query, headers and size-capped bodies, with credentials always redacted. See `captureRequestDetail`.
- **🧩 Plugin Panels**: Add your own panels (queues, cache stats, feature flags) with a few lines — see [Custom panels](#-custom-panels-plugins).
- **🐳 Docker-friendly**: Allow-list the Docker bridge or a dev hostname without opening the console to the world.
- **⚡ Server-Sent Events (SSE)**: Live streaming metrics directly to sparkline charts.
- **🛡️ Production Fail-Closed**: Automatically disabled in `NODE_ENV=production` unless explicitly overridden.
- **⏱️ Startup Profiling**: Mark and measure critical initialization phases with `server.mark('label')`.

---

## 📦 Packages in Monorepo

| Package                                       | Version  | Description                                                                            |
| :-------------------------------------------- | :------- | :------------------------------------------------------------------------------------- |
| [`@singhak/nodeui-core`](packages/core)       | `v0.5.0` | Framework-neutral observability engine, REST/SSE provider registry, static SPA server. |
| [`@singhak/nodeui-express`](packages/express) | `v0.5.0` | Middleware adapter for Express applications.                                           |
| [`@singhak/nodeui-fastify`](packages/fastify) | `v0.5.0` | Plugin adapter for Fastify 4 / 5 applications.                                         |
| [`@singhak/nodeui-nestjs`](packages/nestjs)   | `v0.5.0` | Dynamic module adapter for NestJS applications (Express or Fastify platform).          |
| [`@singhak/nodeui-koa`](packages/koa)         | `v0.5.0` | Middleware adapter for Koa 2 / 3.                                                      |
| [`@singhak/nodeui-hapi`](packages/hapi)       | `v0.5.0` | Plugin adapter for Hapi 21.                                                            |
| [`@singhak/nodeui-hono`](packages/hono)       | `v0.5.0` | Middleware adapter for Hono on Node.js (`@hono/node-server`).                          |
| [`@singhak/nodeui-http`](packages/http)       | `v0.5.0` | Plain `node:http` adapter, also for Next.js custom servers and Restify.                |
| [`@singhak/nodeui-cli`](packages/cli)         | `v0.5.0` | `npx` command: attach without code changes, multi-service dashboard, MCP server.       |
| [`apps/ui`](apps/ui)                          | —        | React + Vite single-page console embedded into core static build.                      |
| [`apps/demo-express`](apps/demo-express)      | —        | Sandbox Express verification server.                                                   |
| [`apps/demo-nestjs`](apps/demo-nestjs)        | —        | Sandbox NestJS verification server.                                                    |

### Why the UI is embedded, not a separate package

The console ships **inside `@singhak/nodeui-core`** (`static/`) instead of as its own npm package. The UI and the REST API it calls change together, so a separate `nodeui-ui` could be installed at a mismatched version and break silently; embedding makes that impossible and keeps installation to one dependency. `apps/ui` is therefore a private workspace, built into `packages/core/static` (CI fails if that bundle is stale).

To serve the console from your own host or gateway, use the exported path:

```typescript
import { uiAssetsDir } from '@singhak/nodeui-core';

const dir = uiAssetsDir(); // …/node_modules/@singhak/nodeui-core/static
```

The UI derives its API base from the URL it is served at (`<prefix>/` talks to `<prefix>/api`), so it works under any prefix. The `nodeui` CLI uses exactly this for its multi-service dashboard.

---

## 📸 What It Looks Like

The Express demo (`apps/demo-express`) running with generated traffic. The **Overview** answers "is the app healthy right now?" with KPI tiles (status, uptime, req/s, error rate, p95, heap, CPU, event-loop lag), live charts with hover values, status-code breakdown, slowest routes, dependency checks and recent errors.

![NodeUI Overview (dark)](docs/screenshots/overview-dark.png)

Light theme (follows your OS setting, with a toggle in the header):

![NodeUI Overview (light)](docs/screenshots/overview-light.png)

**Requests** view: p50/p95/p99, error rate, status/method filters, search, sortable columns and a detail drawer with the matched route, headers, captured body and _Copy as curl_ (credentials and secret-looking body fields show as `[REDACTED]`).

![NodeUI Requests](docs/screenshots/requests.png)

**Errors** view: failures grouped by type, message shape and origin, with counts, the stack and the linked request.

![NodeUI Errors](docs/screenshots/errors.png)

**Queries** view: SQL statements with duration and rows, flagging slow statements and N+1 suspects (the same statement repeated within one request).

![NodeUI Queries](docs/screenshots/queries.png)

Notice that secrets are masked everywhere: `DATABASE_URL`, `JWT_SECRET` and `STRIPE_API_KEY` show as `[REDACTED]`, and the log line `token=abc123` is scrubbed to `token=[REDACTED]`. Use the sidebar to switch between Overview, Requests, Outgoing, Logs, Environment, Routes, Runtime and your own plugin panels; the Pause button freezes the display so you can read it.

---

## 🧭 How to Use It in Your App

**1. Install the adapter for your framework** (it pulls in `@singhak/nodeui-core`):

```bash
npm install --save-dev @singhak/nodeui-express   # or -fastify / -nestjs
```

Installing as a dev dependency is fine: the console is off when `NODE_ENV=production`, so guard the import if you prune dev dependencies in production images (see step 2).

**2. Mount it once, before your routes.**

```typescript
// Express
import { nodeui } from '@singhak/nodeui-express';
const { middleware, server } = nodeui();
app.use(middleware); // must come before your routes so requests are recorded
app.listen(3000, '127.0.0.1', () => server.mark('listening'));
```

```typescript
// Fastify (register before your routes so they appear in the Routes panel)
import { nodeui } from '@singhak/nodeui-fastify';
await app.register(nodeui());
```

```typescript
// NestJS
@Module({ imports: [NodeUIModule.register()] })
export class AppModule {}
```

If the package is a dev dependency only, load it conditionally:

```typescript
if (process.env.NODE_ENV !== 'production') {
  const { nodeui } = await import('@singhak/nodeui-express');
  app.use(nodeui().middleware);
}
```

**3. Start your app in development and open the console:**

```
http://127.0.0.1:<your-port>/nodeui
```

Use `127.0.0.1` or `localhost`; other hostnames are rejected unless you add them to `allowedHosts`. Panels start sampling when you open them and sleep after a minute idle. Open the **Logs** and **Outgoing** panels _before_ the activity you want to inspect, because they only capture while active.

**4. Make it more useful (all optional):**

| I want to...                                  | Do this                                                                       |
| :-------------------------------------------- | :---------------------------------------------------------------------------- |
| See DB / Redis status in Health               | `healthChecks: { db: () => pool.query('select 1') }`                          |
| Add my own panel (queues, flags, cache stats) | `plugins: [{ id: 'queues', get: async () => ({ ok: true, data: ... }) }]`     |
| Mark startup phases                           | `server.mark('db-connected')` → shows in the Startup panel                    |
| See app config in the Environment panel       | `config: { port: 3000, feature: 'x' }` (secrets are masked)                   |
| Use it from Docker                            | `allowedRemoteAddresses: ['172.16.0.0/12']` and publish `127.0.0.1:3000:3000` |
| Protect it with a token                       | `authToken: '...'` then open `/nodeui/?token=...` once                        |
| See Nest logger output                        | `app.useLogger(app.get(NodeUILogger))`                                        |
| Turn it off locally                           | `NODEUI_ENABLED=false`                                                        |

**5. Take a heap snapshot** (leak hunting): open **Heap Snapshot**, click the button, confirm. The file is written owner-only and its path is shown; load it in Chrome DevTools → Memory. It contains every secret in memory, so delete it afterwards.

**Not working?** Check the FAQ below, and look at the startup log: NodeUI prints a warning whenever it is inactive-by-config or exposed more widely than loopback.

---

## 🚀 Try the Demos

Run the built-in demo playgrounds in under a minute:

```bash
# Clone and install
git clone https://github.com/Singhak/nodeui.git
cd nodeui
npm install
npm run build

# Start Express Demo -> Open http://127.0.0.1:3000/nodeui
npm run demo:express

# OR Start NestJS Demo -> Open http://127.0.0.1:3001/nodeui
npm run demo:nestjs
```

Set `DEMO_TRAFFIC=1` for a self-generating stream of requests, errors and outgoing calls so every panel has live data (PowerShell: `$env:DEMO_TRAFFIC=1; npm run demo:express`). Both demos exercise the 0.4.0 features: grouped **Errors** (`/crash/:id` collapses into one entry with a count), **Queries** with an N+1 (`/orders`) and a slow statement (`/report`), a failing **outgoing** call (`/flaky`), route patterns (`/users/:id`), request detail with a masked body and "Copy as curl" (`POST /orders`), and a per-request timeline in the Requests drawer. The Express demo also shows `persist` (stop it and start it again; the history comes back), `healthChecks`, a custom `plugins` panel and a curated `env`; the NestJS demo shows `NodeUILogger` and the error interceptor.

> Body capture needs NodeUI to see the stream before your body parser: register `middleware` before `express.json()`. Nest parses request bodies before module middleware runs, so there only headers, query and response bodies are captured.

---

## 💻 Framework Integrations

### 1. Express

```bash
npm install @singhak/nodeui-express
```

```typescript
import express from 'express';
import { nodeui } from '@singhak/nodeui-express';

const app = express();

// Initialize NodeUI
const { middleware, server, errorHandler } = nodeui({
  path: '/nodeui', // Optional: defaults to /nodeui
});

app.use(middleware);

app.get('/api/users', (req, res) => {
  res.json({ users: ['Alice', 'Bob'] });
});

// Register after your routes to feed the Errors panel (it calls next(err) untouched)
app.use(errorHandler);

app.listen(3000, '127.0.0.1', () => {
  // Record startup mark for the Startup Timeline panel
  server.mark('listening');
  console.log('🚀 Server listening at http://127.0.0.1:3000');
  console.log('📊 NodeUI Dashboard at http://127.0.0.1:3000/nodeui');
});
```

---

### 2. NestJS

```bash
npm install @singhak/nodeui-nestjs
```

```typescript
import { Module } from '@nestjs/common';
import { NodeUIModule } from '@singhak/nodeui-nestjs';

@Module({
  imports: [
    NodeUIModule.register({
      path: '/nodeui',
      maskSecrets: true,
    }),
  ],
})
export class AppModule {}
```

---

### 3. Fastify

```bash
npm install @singhak/nodeui-fastify
```

```typescript
import Fastify from 'fastify';
import { nodeui } from '@singhak/nodeui-fastify';

const app = Fastify();
await app.register(nodeui());
await app.listen({ port: 3000, host: '127.0.0.1' });
```

### 4. Koa, Hapi, Hono and plain `node:http`

```typescript
// Koa
app.use(nodeui().middleware); // @singhak/nodeui-koa
// Hapi
await server.register(nodeui().plugin); // @singhak/nodeui-hapi
// Hono (Node runtime)
app.use('*', nodeui().middleware); // @singhak/nodeui-hono
// Next.js custom server, Restify, raw node:http
nodeui().attach(httpServer); // @singhak/nodeui-http
```

See each package's README for details. NestJS also works on the Fastify platform. Next.js route handlers and Edge runtimes expose no Node request/response and are not supported.

> NestJS tip: to see Nest's own `Logger` output in the Logs panel (Nest writes to `process.stdout`, not `console`), use
> `app.useLogger(app.get(NodeUILogger))` from `@singhak/nodeui-nestjs`.

---

## 🔌 Attach without code changes, and many services at once

```bash
npx @singhak/nodeui-cli attach -- node server.js      # console on your app's own port
npx @singhak/nodeui-cli dashboard api=http://127.0.0.1:3000 worker=http://127.0.0.1:3001
```

`attach` preloads NodeUI into the process you start (it cannot attach to one that is already running). `dashboard` is a loopback page that shows health, error rate and p95 for several consoles and opens each through a proxy.

### Let an AI agent read it (MCP)

```json
{
  "mcpServers": {
    "nodeui": { "command": "npx", "args": ["@singhak/nodeui-cli", "mcp", "http://127.0.0.1:3000"] }
  }
}
```

`nodeui mcp` is a read-only [MCP](https://modelcontextprotocol.io) server: an overview digest, grouped errors, requests joined with their queries/outgoing calls/logs, and more. It reads the console API, so data is already masked and no confirmation-gated action is reachable.

See [`packages/cli`](packages/cli) for options and limits.

## 🗄️ Database queries

`pg` and `mysql2` are instrumented automatically (resolved from your app's `node_modules`) while the **Queries** panel is open. Parameter values are never recorded.

```typescript
// Prisma: enable query events, then subscribe
const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
server.trackPrisma(prisma);

// Sequelize / TypeORM / anything else
const sequelize = new Sequelize(url, {
  benchmark: true,
  logging: (sql, ms) => server.recordQuery({ system: 'sequelize', sql, durationMs: Number(ms) }),
});
```

Statements repeated 5 or more times within a single request are flagged as **N+1** suspects.

---

## 🔭 OpenTelemetry export

NodeUI can forward what it records to any OTLP/HTTP collector (Jaeger, Grafana Tempo, the OpenTelemetry Collector, ...) so it complements rather than replaces your tracing stack. No OpenTelemetry SDK is required.

```typescript
nodeui({ otlp: 'http://localhost:4318' });
// or: { otlp: { endpoint: 'https://collector.example/v1/traces', serviceName: 'api', headers: { authorization: '...' } } }
```

Each incoming request becomes a `SERVER` span; its outgoing HTTP calls and database queries are `CLIENT` child spans in the same trace. Statements and URLs are masked, query parameters are never included. Enabling export keeps the outgoing and query instrumentation running, and NodeUI warns if the endpoint is not local, because telemetry then leaves your machine.

---

## 💾 Persistence

By default everything lives in memory and disappears on restart. Pass `persist` to keep recent requests, outgoing calls, queries and errors across restarts (handy with `--watch` / nodemon):

```typescript
nodeui({ persist: '.nodeui/journal.ndjson' });
// or: { persist: { file: '.nodeui/journal.ndjson', maxBytes: 10_000_000 } }
```

The journal is append-only NDJSON written asynchronously in batches (never on the request path), created with mode `0600`, passed through secret masking before it is written, and rotated to `<file>.1` at `maxBytes` (default 5 MiB). It contains whatever the console records (paths, queries, headers, bodies if enabled), so **add it to `.gitignore`**. Logs are not persisted.

### Limitations

- **Single writer.** The journal is meant for one process. Several processes (cluster, pm2, replicas) appending to the same file can interleave lines, so give each process its own file (for example include `process.pid` in the name).
- **Crash window.** Writes are batched every ~250 ms and flushed on `server.shutdown()`. A hard crash or `kill -9` can lose the last fraction of a second; a torn last line is skipped on load.
- **Bounded history.** Only the current file and one rotated generation (`<file>.1`) are kept, so disk use stays under about twice `maxBytes`. Older activity is dropped, and what is restored is still capped by the in-memory ring-buffer sizes (`requestLogSize`, `outgoingLogSize`, `queryLogSize`).
- **Whole-file replay.** The journal is read fully into memory at startup. That is fine at the default 5 MiB; raising `maxBytes` far beyond tens of MiB slows startup.
- **No querying.** It is a replay log, not a database: you cannot search or aggregate past sessions from the UI, only see what was restored into the live panels.
- **Not everything is saved.** Logs, the per-second metrics chart, startup marks and heap snapshots are not persisted. Error counts reflect only the retained window.
- **Masked at write time.** Secrets are masked before they reach disk, but changing masking rules later does not rewrite old lines. Bodies and headers are only in the file if you enabled them.
- **Needs a writable path.** If the file or directory cannot be written, persistence silently does nothing so the host app is never affected.

### Why a file and not SQLite?

NodeUI supports Node 18+ and avoids native dependencies. `better-sqlite3` needs prebuilt binaries (problematic on some Alpine, Windows and CI images), and the built-in `node:sqlite` module requires Node 22.13+ and is still experimental. An append-only file covers the actual need (replay recent activity after a restart) with zero install cost. SQLite would help with multi-process sharing, querying older history and exact retention limits, so it is a candidate for an **optional backend** on Node versions that ship `node:sqlite`; it is not implemented yet.

---

## 🧩 Custom Panels (Plugins)

Any object with an `id` and a `get()` becomes a panel. The UI renders arrays of objects as a table and objects as key/value rows.

```typescript
nodeui({
  plugins: [
    {
      id: 'queues', // lowercase letters, digits, "-"
      title: 'Job Queues',
      get: async () => ({ ok: true, data: await queue.getJobCounts() }),
    },
  ],
  // Show database / cache status in the Health panel:
  healthChecks: {
    postgres: () => pool.query('select 1'),
    redis: () => redis.ping(),
  },
});
```

Plugin output goes through the same secret masking as built-in panels. A `get()` that throws is reported as a `provider-failed` error instead of breaking the console.

---

## 🐳 Docker, proxies and hostnames

The console is loopback-only. If your app runs in a container, the browser's requests arrive from the Docker bridge, not from `127.0.0.1`. Allow that explicitly (and keep a token on):

```typescript
nodeui({
  allowedRemoteAddresses: ['172.16.0.0/12'], // Docker bridge networks (exact IPs and IPv4 CIDRs)
  allowedHosts: ['dev.myapp.test'], // extra Host header names, e.g. a local reverse proxy
  authToken: process.env.NODEUI_TOKEN, // open /nodeui/?token=... once; an HttpOnly cookie keeps you signed in
});
```

Publish the port on loopback only (`-p 127.0.0.1:3000:3000`). Requests carrying `X-Forwarded-*` headers are rejected unless `trustProxy: true`.

---

## 🖥️ Interactive Panels

| Panel             | Icon | Metric / Capability    | Details                                                                                                                                                                                                   |
| :---------------- | :--: | :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Health**        |  🩺  | System state & uptime  | Shows `ok`/`degraded`/`critical`, Node.js version, PID, uptime, and current lag.                                                                                                                          |
| **Memory**        |  🧠  | Heap & RSS telemetry   | Visualizes Heap used, Heap total, RSS, External memory, and system-level RAM with live sparklines.                                                                                                        |
| **CPU**           |  ⚡  | Process utilization    | Tracks User CPU %, System CPU %, and aggregate process CPU load over time.                                                                                                                                |
| **Event Loop**    |  ⏱️  | Lag sampling           | Monitors event-loop execution delay (current, peak max, average).                                                                                                                                         |
| **Heap Snapshot** |  📸  | Memory leak inspection | One-click trigger for V8 `.heapsnapshot` generation protected by single-use nonces.                                                                                                                       |
| **Requests**      |  🌐  | Traffic & Latency      | Live HTTP metrics grouped by route pattern, status breakdown, p50/p95/p99, and a request drawer with query, headers, optional bodies, Copy as curl and a correlated timeline.                             |
| **Queries**       |  🗄️  | Database statements    | `pg` and `mysql2` are captured automatically; Prisma via `server.trackPrisma(prisma)`; Sequelize/TypeORM via `server.recordQuery()`. Flags slow queries and N+1 patterns, never records parameter values. |
| **Errors**        |  ⚠️  | Failure grouping       | Errors grouped by type, message shape and origin with counts, stack trace and linked request. Express: `app.use(errorHandler)` after your routes; Fastify and Nest are automatic.                         |
| **Outgoing**      |  📤  | Outbound HTTP calls    | `http`/`https` (axios, got, node-fetch) and global `fetch` calls with status, duration and failures.                                                                                                      |
| **Routes**        |  🛣️  | Router introspection   | Automatic discovery of declared routes, HTTP verbs, paths, and controller handler names.                                                                                                                  |
| **Logs**          |  📜  | Console capture        | Real-time stream of `console.log`, `info`, `warn`, `error` with search and log level filters.                                                                                                             |
| **Environment**   |  🔐  | Configuration auditor  | Inspects `process.env` and custom configs with automatic secret redaction.                                                                                                                                |
| **Startup**       |  ⏳  | Boot profiling         | Visual sequence diagram of initialization timestamps and `server.mark()` milestones.                                                                                                                      |

---

## 🏗️ Architecture

NodeUI embeds seamlessly into your application pipeline without external processes:

```mermaid
flowchart TB
    subgraph HostApp["Node.js Application (Express / Fastify / NestJS)"]
        Router["Application Routes & Middleware"]
        NodeUIMW["NodeUI Middleware (/nodeui/*)"]

        subgraph CoreEngine["@singhak/nodeui-core"]
            SafetyGate["Safety Gate (Loopback & Env Check)"]
            SecretMasker["Secret Masker"]
            RingBuffer["In-Memory Ring Buffers (Logs & Requests)"]
            Samplers["Lazy Telemetry Samplers (CPU, Event Loop, Memory)"]
            StaticServer["Static Asset Server (React SPA)"]
            RESTAPI["REST & SSE Endpoint Handlers"]
        end
    end

    Browser["Developer Browser (http://127.0.0.1:3000/nodeui)"]

    Router --> NodeUIMW
    NodeUIMW --> SafetyGate
    SafetyGate --> RESTAPI
    SafetyGate --> StaticServer
    RESTAPI --> RingBuffer
    RESTAPI --> Samplers
    RESTAPI --> SecretMasker
    StaticServer --> Browser
    RESTAPI -.->|SSE & JSON Stream| Browser
```

---

## 🔒 Security & Safety Model

> [!IMPORTANT]
> NodeUI is engineered specifically for **local development environments**. A suite of built-in safeguards prevents accidental production exposure.

- **🚫 Fail-Closed in Production**: NodeUI turns completely off when `NODE_ENV=production` unless explicitly forced via `NODEUI_ENABLED=true`.
- **🏠 Loopback Binding Only**: Incoming requests from non-loopback addresses (`!127.0.0.1` and `!::1`) are immediately rejected with `403 Forbidden`.
- **🌐 DNS-Rebinding & CSRF Defence**: The `Host` and `Origin` headers must be loopback names (or allow-listed); proxied (`X-Forwarded-*`) requests are rejected by default. Responses carry CSP, `nosniff` and frame-deny headers.
- **🔑 Optional Access Token**: Set `authToken` / `NODEUI_TOKEN` to require a token (header, or a one-time `?token=` login that sets an HttpOnly cookie).
- **🛡️ Aggressive Secret Redaction**: Values under keys such as `TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `AUTH`, `COOKIE`, `DSN`, `DATABASE_URL`, plus credentials embedded in text (`postgres://user:pass@host`, bearer tokens, JWTs, `password=...` — including log lines) are replaced with `[REDACTED]`. Applies to REST and the live stream. Set `maskSecrets: false` to opt out.
- **📸 Private Heap Dumps**: Snapshots are written owner-only (`0600`) into a private directory. A heap dump contains every secret in memory; delete them when done.
- **🔑 Nonce-Gated Mutating Actions**: Heavy operations like V8 Heap Snapshots require a two-step challenge: request a single-use confirmation nonce via `POST /confirmations`, then submit with `x-nodeui-confirm` header.
- **⚡ Negligible Cost When Disabled**: When inactive, the middleware is a direct `next()` passthrough without event listeners or timers.
- **🧾 Credentials Never Stored**: `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, `x-api-key` and any header or query key that looks secret are redacted at capture time, even with `maskSecrets: false`. Request/response bodies are off by default.

---

## ⚙️ Configuration

### Programmatic Options

Passed to `nodeui(options)` or `NodeUIModule.register(options)`:

| Option                   | Type                                                       | Default                                                             | Description                                                                                                   |
| :----------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------ |
| `path`                   | `string`                                                   | `'/nodeui'`                                                         | Base route prefix where console UI and API are mounted.                                                       |
| `host`                   | `string`                                                   | `'127.0.0.1'`                                                       | Allowed host interface for incoming requests.                                                                 |
| `enabled`                | `boolean`                                                  | `env-based`                                                         | Explicitly enable (`true`) or disable (`false`) console.                                                      |
| `maskSecrets`            | `boolean`                                                  | `true`                                                              | Automatically redact sensitive environment and config values.                                                 |
| `requestLogSize`         | `number`                                                   | `500`                                                               | In-memory capacity for HTTP request logs.                                                                     |
| `captureRequestDetail`   | `boolean \| { query, headers, bodies, maxBodyBytes }`      | `{ query: true, headers: true, bodies: false, maxBodyBytes: 4096 }` | What extra detail is recorded per request. `false` records none. Textual bodies only, masked and size-capped. |
| `queryLogSize`           | `number`                                                   | `200`                                                               | In-memory capacity for recorded database queries.                                                             |
| `slowQueryMs`            | `number`                                                   | `100`                                                               | Queries at or above this duration are flagged slow.                                                           |
| `persist`                | `string \| { file, maxBytes }`                             | `off`                                                               | Journal recent activity to an NDJSON file and restore it on restart. See [Persistence](#-persistence).        |
| `otlp`                   | `string \| { endpoint, serviceName, headers, intervalMs }` | `off`                                                               | Export spans to an OTLP/HTTP collector. See [OpenTelemetry export](#-opentelemetry-export).                   |
| `logSize`                | `number`                                                   | `500`                                                               | In-memory capacity for captured console messages.                                                             |
| `pollIntervalMs`         | `number`                                                   | `2000`                                                              | Sampler collection interval for CPU and event-loop lag.                                                       |
| `inactivityTimeoutMs`    | `number`                                                   | `60000`                                                             | Idling timeout before background samplers pause.                                                              |
| `confirmTtlMs`           | `number`                                                   | `60000`                                                             | Expiration window for mutation confirmation nonces.                                                           |
| `heapSnapshotDir`        | `string`                                                   | `<tmp>/nodeui-heap`                                                 | Destination directory where `.heapsnapshot` files are written.                                                |
| `allowedHosts`           | `string[]`                                                 | `[]`                                                                | Extra `Host` header names accepted besides loopback names.                                                    |
| `allowedOrigins`         | `string[]`                                                 | `[]`                                                                | Extra `Origin` values accepted for cross-origin calls.                                                        |
| `allowedRemoteAddresses` | `string[]`                                                 | `[]`                                                                | Extra client IPs / IPv4 CIDRs accepted (e.g. Docker bridge).                                                  |
| `trustProxy`             | `boolean`                                                  | `false`                                                             | Accept requests carrying `X-Forwarded-*` headers.                                                             |
| `authToken`              | `string`                                                   | `undefined`                                                         | Require this token (`Authorization: Bearer`, cookie or `?token=`).                                            |
| `maxSseClients`          | `number`                                                   | `10`                                                                | Concurrent live-stream connections allowed.                                                                   |
| `plugins`                | `NodeUIProvider[]`                                         | `[]`                                                                | Custom panels.                                                                                                |
| `healthChecks`           | `Record<string, () => unknown>`                            | `{}`                                                                | Dependency checks shown in the Health panel.                                                                  |
| `outgoingLogSize`        | `number`                                                   | `200`                                                               | Capacity of the outgoing HTTP call buffer.                                                                    |
| `config`                 | `object \| fn`                                             | `undefined`                                                         | Custom metadata object or getter to display in the Environment panel.                                         |

### Environment Variables

| Variable                       | Default             | Purpose                                                      |
| :----------------------------- | :------------------ | :----------------------------------------------------------- |
| `NODEUI_ENABLED`               | `unset`             | Set to `true` to force-enable (or `false` to force-disable). |
| `NODEUI_PATH`                  | `/nodeui`           | Prefix for web UI and API.                                   |
| `NODEUI_HOST`                  | `127.0.0.1`         | Loopback address validation target.                          |
| `NODEUI_POLL_INTERVAL_MS`      | `2000`              | Polling sampling rate in milliseconds.                       |
| `NODEUI_INACTIVITY_TIMEOUT_MS` | `60000`             | Inactivity timer before providers stop background polling.   |
| `NODEUI_REQUEST_LOG_SIZE`      | `500`               | Capacity of the request circular buffer.                     |
| `NODEUI_LOG_SIZE`              | `500`               | Capacity of the console log circular buffer.                 |
| `NODEUI_OTLP_ENDPOINT`         | `unset`             | OTLP/HTTP collector base URL (e.g. `http://localhost:4318`). |
| `NODEUI_PERSIST_FILE`          | `unset`             | Journal file for persistence across restarts.                |
| `NODEUI_CAPTURE_BODIES`        | `false`             | `true` records masked request/response bodies.               |
| `NODEUI_CONFIRM_TTL_MS`        | `60000`             | Nonce validity duration.                                     |
| `NODEUI_HEAP_SNAPSHOT_DIR`     | `<tmp>/nodeui-heap` | Snapshot output directory.                                   |
| `NODEUI_TOKEN`                 | `unset`             | Require this access token.                                   |
| `NODEUI_ALLOWED_HOSTS`         | `unset`             | Comma-separated extra `Host` names.                          |
| `NODEUI_ALLOWED_ORIGINS`       | `unset`             | Comma-separated extra `Origin` values.                       |
| `NODEUI_ALLOWED_REMOTE`        | `unset`             | Comma-separated client IPs / IPv4 CIDRs.                     |
| `NODEUI_TRUST_PROXY`           | `false`             | `true` accepts `X-Forwarded-*` requests.                     |
| `NODEUI_MAX_SSE_CLIENTS`       | `10`                | Concurrent live streams.                                     |

---

## 📡 REST & SSE API Reference

All JSON endpoints return an envelope format:

```json
{
  "ok": true,
  "data": { ... }
}
```

| Method | Endpoint             | Description                                                       |
| :----- | :------------------- | :---------------------------------------------------------------- |
| `GET`  | `/api/health`        | Overall health state, PID, uptime, Node version, and current lag. |
| `GET`  | `/api/memory`        | Process memory stats (RSS, heapUsed, heapTotal, external).        |
| `GET`  | `/api/cpu`           | Process CPU percentages (total, user, system).                    |
| `GET`  | `/api/event-loop`    | Current, maximum, and average event-loop lag times.               |
| `GET`  | `/api/requests`      | Recent HTTP traffic buffer and aggregate metrics.                 |
| `GET`  | `/api/outgoing`      | Recent outgoing HTTP calls with status and duration.              |
| `GET`  | `/api/queries`       | Recent database queries with slow and N+1 flags.                  |
| `GET`  | `/api/errors`        | Grouped errors with counts, stacks and last request.              |
| `GET`  | `/api/routes`        | Introspected Express / Fastify / NestJS routes.                   |
| `GET`  | `/api/logs`          | Captured console logs buffer with timestamp and level.            |
| `GET`  | `/api/env`           | Masked environment variables and app configurations.              |
| `GET`  | `/api/startup`       | Startup timeline marks registered via `server.mark()`.            |
| `GET`  | `/api/metrics`       | Per-second request and error buckets for the last minute.         |
| `GET`  | `/api/config`        | Effective (non-secret) configuration, panel list and plugin meta. |
| `GET`  | `/api/<plugin-id>`   | Output of each registered custom panel (`plugins` option).        |
| `GET`  | `/api/live`          | **Server-Sent Events (SSE)** real-time metric stream.             |
| `POST` | `/api/confirmations` | Issues a single-use cryptographic token for mutating actions.     |
| `POST` | `/api/heap-snapshot` | Takes a V8 heap snapshot (requires `x-nodeui-confirm` header).    |

---

## 📊 Benchmarks & Performance

`npm run bench` (`scripts/bench.mjs`) runs scenarios in **alternating rounds** so machine drift hits each one equally, and reports the median across rounds plus the min–max spread. Sample run: Node 24, Express 5, 7 rounds × 3,000 requests, concurrency 8, trivial JSON handler, loopback.

| Scenario                        |     p50 (min–max)     |    p95    |    p99    | Throughput  |  p50 vs baseline   |
| :------------------------------ | :-------------------: | :-------: | :-------: | :---------: | :----------------: |
| **Baseline** _(no NodeUI)_      | `1.57 ms` (1.33–2.03) | `2.04 ms` | `2.75 ms` | `4,864 rps` |         —          |
| **Enabled** _(default capture)_ | `1.74 ms` (1.55–2.11) | `2.32 ms` | `3.30 ms` | `4,459 rps` |     `+0.18 ms`     |
| **Enabled + body capture**      | `1.80 ms` (1.62–4.89) | `2.39 ms` | `4.13 ms` | `4,280 rps` |     `+0.24 ms`     |
| **Disabled** _(fail-closed)_    | `1.54 ms` (1.34–1.98) | `1.89 ms` | `2.79 ms` | `5,081 rps` | `−0.03 ms` (noise) |

> [!NOTE]
> On a handler that does no work, enabling NodeUI costs roughly 0.2 ms per request (about 10% here); the absolute cost is what matters and it is fixed, not proportional, so it shrinks relative to real handlers. Differences inside the min–max spread are noise. NodeUI is meant for local development and staging, not as a production APM; re-run `npm run bench` on your hardware.

---

## ❓ FAQ / Troubleshooting

<details>
<summary><b>Why is the console only reachable from my local machine?</b></summary>
<br/>
By default, NodeUI binds strictly to <code>127.0.0.1</code> and rejects non-loopback requests with <code>403 Forbidden</code>. This is a crucial security barrier so sensitive runtime data and heap snapshots are never exposed to local networks or the public internet. If you need remote access for internal teams, place an authenticated reverse proxy in front of the application.
</details>

<details>
<summary><b>Why does the Routes panel show "No Express router captured yet"?</b></summary>
<br/>
NodeUI discovers Express routes lazily upon receiving the first request through the app router (Fastify routes are collected as they are registered). Trigger any request against your backend API endpoints, then refresh the NodeUI dashboard.
</details>

<details>
<summary><b>How do I forward custom logger messages (Winston, Pino) to NodeUI?</b></summary>
<br/>
NodeUI automatically captures native <code>console.log/info/warn/error</code>. For external loggers, use the provided helper method on the server instance:
<pre><code class="language-ts">server.addLogSource({ level: 'info', message: 'User logged in successfully' });
</code></pre>
</details>

<details>
<summary><b>Why are my environment variables showing as <code>[REDACTED]</code>?</b></summary>
<br/>
Keys containing terms like <code>KEY</code>, <code>SECRET</code>, <code>TOKEN</code>, <code>PASSWORD</code>, or <code>AUTH</code> are automatically masked for safety. You can disable masking by passing <code>maskSecrets: false</code> in your configuration options.
</details>

<details>
<summary><b>How does heap snapshot capture work with confirmation nonces?</b></summary>
<br/>
Capturing heap snapshots is a mutating action. When triggered from the UI, a confirmation modal automatically requests a single-use nonce from <code>POST /nodeui/api/confirmations</code> and passes it in the <code>x-nodeui-confirm</code> header to <code>POST /nodeui/api/heap-snapshot</code>.
</details>

---

## 🛠️ Development & Monorepo Scripts

```bash
npm install              # Install all workspace dependencies
npm run build            # Build core -> adapters -> UI bundle
npm run test             # Run Vitest test suites across all packages
npm run typecheck        # Run TypeScript typechecks
npm run lint             # Lint with ESLint
npm run format           # Format code with Prettier
npm run bench            # Run middleware performance benchmark
npm run demo:express     # Launch Express sandbox app
npm run demo:nestjs      # Launch NestJS sandbox app
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full contribution conventions and [SECURITY.md](SECURITY.md) for our security reporting policy.

---

## 📄 License

Distributed under the **Apache-2.0 License**. See [LICENSE](LICENSE) for more details.

<div align="center">
<sub>Built with ❤️ for the Node.js developer community.</sub>
</div>
