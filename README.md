<div align="center">

# ⚡ NodeUI

### **The Local-Only Developer Console & Observability Suite for Node.js**

_An embedded, zero-cost developer dashboard for Express and NestJS — inspired by Spring Boot Admin & Quarkus Dev UI._

<br/>

[![npm version](https://img.shields.io/npm/v/@singhak/nodeui-express?color=6366f1&label=version&style=flat-square)](https://www.npmjs.com/package/@singhak/nodeui-express)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D%2018.0.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Framework-Express%20%7C%20NestJS-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
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
- ⚡ **Zero-Overhead**: Lazy samplers that sleep when idle, and non-blocking in-memory ring buffers.

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
│ Auto-scanned Express │ Redacts tokens, keys │ In-memory ring buffer of      │
│ & NestJS router tree │ passwords in all API │ live logs with level filters  │
└──────────────────────┴──────────────────────┴───────────────────────────────┘
```

- **📊 12 Built-in Panels**: Memory, CPU, Event-loop lag, Health (with dependency checks), HTTP Requests, Outgoing HTTP calls, Routes, Logs, Environment, Startup Timeline, Metrics and Heap Snapshots.
- **🧩 Plugin Panels**: Add your own panels (queues, cache stats, feature flags) with a few lines — see [Custom panels](#-custom-panels-plugins).
- **🐳 Docker-friendly**: Allow-list the Docker bridge or a dev hostname without opening the console to the world.
- **⚡ Server-Sent Events (SSE)**: Live streaming metrics directly to sparkline charts.
- **🛡️ Production Fail-Closed**: Automatically disabled in `NODE_ENV=production` unless explicitly overridden.
- **⏱️ Startup Profiling**: Mark and measure critical initialization phases with `server.mark('label')`.

---

## 📦 Packages in Monorepo

| Package                                       | Version  | Description                                                                            |
| :-------------------------------------------- | :------- | :------------------------------------------------------------------------------------- |
| [`@singhak/nodeui-core`](packages/core)       | `v0.3.1` | Framework-neutral observability engine, REST/SSE provider registry, static SPA server. |
| [`@singhak/nodeui-express`](packages/express) | `v0.3.1` | Middleware adapter for Express applications.                                           |
| [`@singhak/nodeui-fastify`](packages/fastify) | `v0.3.1` | Plugin adapter for Fastify 4 / 5 applications.                                         |
| [`@singhak/nodeui-nestjs`](packages/nestjs)   | `v0.3.1` | Dynamic module adapter for NestJS applications.                                        |
| [`apps/ui`](apps/ui)                          | —        | React + Vite single-page console embedded into core static build.                      |
| [`apps/demo-express`](apps/demo-express)      | —        | Sandbox Express verification server.                                                   |
| [`apps/demo-nestjs`](apps/demo-nestjs)        | —        | Sandbox NestJS verification server.                                                    |

---

## 📸 What It Looks Like

The Express demo (`apps/demo-express`) running with generated traffic. The **Overview** answers "is the app healthy right now?" with KPI tiles (status, uptime, req/s, error rate, p95, heap, CPU, event-loop lag), live charts with hover values, status-code breakdown, slowest routes, dependency checks and recent errors.

![NodeUI Overview (dark)](docs/screenshots/overview-dark.png)

Light theme (follows your OS setting, with a toggle in the header):

![NodeUI Overview (light)](docs/screenshots/overview-light.png)

**Requests** view: p50/p95/p99, error rate, status/method filters, search, sortable columns and a detail drawer with _Copy as curl_.

![NodeUI Requests](docs/screenshots/requests.png)

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

Set `DEMO_TRAFFIC=1` for a self-generating stream of requests, errors and outgoing calls so every panel has live data (PowerShell: `$env:DEMO_TRAFFIC=1; npm run demo:express`). The Express demo also shows `healthChecks`, a custom `plugins` panel and a curated `env`; the NestJS demo shows `NodeUILogger`.

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
const { middleware, server } = nodeui({
  path: '/nodeui', // Optional: defaults to /nodeui
});

app.use(middleware);

app.get('/api/users', (req, res) => {
  res.json({ users: ['Alice', 'Bob'] });
});

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

> NestJS tip: to see Nest's own `Logger` output in the Logs panel (Nest writes to `process.stdout`, not `console`), use
> `app.useLogger(app.get(NodeUILogger))` from `@singhak/nodeui-nestjs`.

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

| Panel             | Icon | Metric / Capability    | Details                                                                                              |
| :---------------- | :--: | :--------------------- | :--------------------------------------------------------------------------------------------------- |
| **Health**        |  🩺  | System state & uptime  | Shows `ok`/`degraded`/`critical`, Node.js version, PID, uptime, and current lag.                     |
| **Memory**        |  🧠  | Heap & RSS telemetry   | Visualizes Heap used, Heap total, RSS, External memory, and system-level RAM with live sparklines.   |
| **CPU**           |  ⚡  | Process utilization    | Tracks User CPU %, System CPU %, and aggregate process CPU load over time.                           |
| **Event Loop**    |  ⏱️  | Lag sampling           | Monitors event-loop execution delay (current, peak max, average).                                    |
| **Heap Snapshot** |  📸  | Memory leak inspection | One-click trigger for V8 `.heapsnapshot` generation protected by single-use nonces.                  |
| **Requests**      |  🌐  | Traffic & Latency      | Live HTTP metrics: request rates, status breakdown, latency histogram, and request ring buffer.      |
| **Outgoing**      |  📤  | Outbound HTTP calls    | `http`/`https` (axios, got, node-fetch) and global `fetch` calls with status, duration and failures. |
| **Routes**        |  🛣️  | Router introspection   | Automatic discovery of declared routes, HTTP verbs, paths, and controller handler names.             |
| **Logs**          |  📜  | Console capture        | Real-time stream of `console.log`, `info`, `warn`, `error` with search and log level filters.        |
| **Environment**   |  🔐  | Configuration auditor  | Inspects `process.env` and custom configs with automatic secret redaction.                           |
| **Startup**       |  ⏳  | Boot profiling         | Visual sequence diagram of initialization timestamps and `server.mark()` milestones.                 |

---

## 🏗️ Architecture

NodeUI embeds seamlessly into your application pipeline without external processes:

```mermaid
flowchart TB
    subgraph HostApp["Node.js Application (Express / NestJS)"]
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
- **⚡ Zero Overhead When Disabled**: When inactive, the middleware is a direct, zero-overhead `next()` passthrough without active event listeners or timers.

---

## ⚙️ Configuration

### Programmatic Options

Passed to `nodeui(options)` or `NodeUIModule.register(options)`:

| Option                   | Type                            | Default             | Description                                                           |
| :----------------------- | :------------------------------ | :------------------ | :-------------------------------------------------------------------- |
| `path`                   | `string`                        | `'/nodeui'`         | Base route prefix where console UI and API are mounted.               |
| `host`                   | `string`                        | `'127.0.0.1'`       | Allowed host interface for incoming requests.                         |
| `enabled`                | `boolean`                       | `env-based`         | Explicitly enable (`true`) or disable (`false`) console.              |
| `maskSecrets`            | `boolean`                       | `true`              | Automatically redact sensitive environment and config values.         |
| `requestLogSize`         | `number`                        | `500`               | In-memory capacity for HTTP request logs.                             |
| `logSize`                | `number`                        | `500`               | In-memory capacity for captured console messages.                     |
| `pollIntervalMs`         | `number`                        | `2000`              | Sampler collection interval for CPU and event-loop lag.               |
| `inactivityTimeoutMs`    | `number`                        | `60000`             | Idling timeout before background samplers pause.                      |
| `confirmTtlMs`           | `number`                        | `60000`             | Expiration window for mutation confirmation nonces.                   |
| `heapSnapshotDir`        | `string`                        | `<tmp>/nodeui-heap` | Destination directory where `.heapsnapshot` files are written.        |
| `allowedHosts`           | `string[]`                      | `[]`                | Extra `Host` header names accepted besides loopback names.            |
| `allowedOrigins`         | `string[]`                      | `[]`                | Extra `Origin` values accepted for cross-origin calls.                |
| `allowedRemoteAddresses` | `string[]`                      | `[]`                | Extra client IPs / IPv4 CIDRs accepted (e.g. Docker bridge).          |
| `trustProxy`             | `boolean`                       | `false`             | Accept requests carrying `X-Forwarded-*` headers.                     |
| `authToken`              | `string`                        | `undefined`         | Require this token (`Authorization: Bearer`, cookie or `?token=`).    |
| `maxSseClients`          | `number`                        | `10`                | Concurrent live-stream connections allowed.                           |
| `plugins`                | `NodeUIProvider[]`              | `[]`                | Custom panels.                                                        |
| `healthChecks`           | `Record<string, () => unknown>` | `{}`                | Dependency checks shown in the Health panel.                          |
| `outgoingLogSize`        | `number`                        | `200`               | Capacity of the outgoing HTTP call buffer.                            |
| `config`                 | `object \| fn`                  | `undefined`         | Custom metadata object or getter to display in the Environment panel. |

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
| `GET`  | `/api/routes`        | Introspected Express / NestJS router map.                         |
| `GET`  | `/api/logs`          | Captured console logs buffer with timestamp and level.            |
| `GET`  | `/api/env`           | Masked environment variables and app configurations.              |
| `GET`  | `/api/startup`       | Startup timeline marks registered via `server.mark()`.            |
| `GET`  | `/api/live`          | **Server-Sent Events (SSE)** real-time metric stream.             |
| `POST` | `/api/confirmations` | Issues a single-use cryptographic token for mutating actions.     |
| `POST` | `/api/heap-snapshot` | Takes a V8 heap snapshot (requires `x-nodeui-confirm` header).    |

---

## 📊 Benchmarks & Performance

Synthetic latency and throughput overhead testing (`scripts/bench.mjs`, Node 22, Express 5, 5,000 requests per scenario):

| Scenario                                | Mean Latency |    p50    |    p95    |    p99     | Throughput |
| :-------------------------------------- | :----------: | :-------: | :-------: | :--------: | :--------: |
| **Baseline** _(No NodeUI)_              |  `4.12 ms`   | `3.53 ms` | `7.55 ms` | `12.66 ms` | `243 rps`  |
| **NodeUI Enabled** _(Recording active)_ |  `3.92 ms`   | `3.44 ms` | `7.93 ms` | `13.11 ms` | `255 rps`  |
| **NodeUI Disabled** _(Fail-closed)_     |  `3.12 ms`   | `2.84 ms` | `3.84 ms` | `8.33 ms`  | `321 rps`  |

> [!TIP]
> Memory and CPU overhead are practically negligible under typical development and local staging workloads.

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
NodeUI discovers routes lazily upon receiving the first request through the app router. Trigger any request against your backend API endpoints, then refresh the NodeUI dashboard.
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
