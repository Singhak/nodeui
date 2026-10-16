# Spring Boot Has BootUI. Quarkus Has Dev UI. Node.js Finally Has NodeUI.

### A local-only developer console for Express, Fastify, NestJS, Koa, Hapi and Hono. Two lines of code, no Docker, no Prometheus, no cloud.

*Suggested tags: Node.js, JavaScript, Backend, Performance, Developer Tools*

---

Every Node.js developer knows this moment.

An endpoint is slow. Or memory climbs until the container dies. Or one request fails and you can't tell why. So you start the usual ritual: sprinkle `console.log`, open `node --inspect`, remember that `clinic.js` exists, wonder whether you should "just set up Grafana", and an hour later you still haven't answered the first question.

Developers on other stacks don't live like this. Spring Boot has Spring Boot Admin. Quarkus ships a Dev UI. You start the app and there is a page that tells you what's going on inside it.

Node never had that. I recently found **NodeUI**, and it has changed how I debug my backends. This article is a tour of what it does, how to set it up (it takes about a minute), and where it should *not* be used.

> **Heads-up:** NodeUI is a *runtime developer console for your Node.js app*, not a UI component library. The name confuses people.

---

## What is NodeUI?

NodeUI is an embedded dashboard that mounts inside your existing HTTP server at `/nodeui`. You install an adapter for your framework, add one line, start your app, and open `http://127.0.0.1:3000/nodeui`.

That's the whole setup. There is no separate server, no agent, no database, no telemetry leaving your machine. The React UI and the REST/SSE endpoints it talks to ship inside the package.

It's built to be **local-only and safe by default**:

- It turns itself **off** when `NODE_ENV=production`.
- It only answers loopback requests (`127.0.0.1` / `::1`) and rejects everything else with a 403.
- Secrets (`TOKEN`, `KEY`, `PASSWORD`, `DATABASE_URL`, JWTs, `postgres://user:pass@host` and so on) are redacted as `[REDACTED]`, including inside log lines.

---

## Setup in 60 seconds

Pick the adapter for your framework. For Express:

```bash
npm install --save-dev @singhak/nodeui-express
```

```typescript
import express from 'express';
import { nodeui } from '@singhak/nodeui-express';

const app = express();
const { middleware, server, errorHandler } = nodeui();

app.use(middleware); // before your routes, so requests get recorded

app.get('/api/users', (req, res) => res.json({ users: ['Alice', 'Bob'] }));

app.use(errorHandler); // after your routes, feeds the Errors panel

app.listen(3000, '127.0.0.1', () => server.mark('listening'));
```

Open `http://127.0.0.1:3000/nodeui`. Done.

Other frameworks are just as short:

```typescript
// Fastify
await app.register(nodeui());

// NestJS
@Module({ imports: [NodeUIModule.register()] })
export class AppModule {}

// Koa
app.use(nodeui().middleware);

// Hapi
await server.register(nodeui().plugin);

// Hono (Node runtime)
app.use('*', nodeui().middleware);

// Plain node:http, Next.js custom server, Restify
nodeui().attach(httpServer);
```

Don't want to touch your code at all? The CLI can preload it:

```bash
npx @singhak/nodeui-cli attach -- node server.js
```

---

## What you get

Here are the panels I use most.

### 1. Overview: "Is my app healthy right now?"

KPI tiles for status, uptime, requests/sec, error rate, p95 latency, heap, CPU and event-loop lag, plus live charts, a status-code breakdown, your slowest routes, dependency checks and recent errors.

*(Screenshot: Overview, dark theme. Use `docs/screenshots/overview-dark.png` from the repo.)*

You can add dependency checks to the Health panel in one line:

```typescript
nodeui({
  healthChecks: {
    postgres: () => pool.query('select 1'),
    redis: () => redis.ping(),
  },
});
```

### 2. Requests, with a per-request waterfall

Every request is listed with p50/p95/p99, status and method filters, search and sortable columns. Click one and a drawer shows the matched route pattern (`/users/:id`), query, headers and, if you opt in, size-capped bodies.

What makes this useful is **request correlation**. Using `AsyncLocalStorage`, NodeUI attributes outgoing HTTP calls, database queries and log lines to the request that caused them. So instead of guessing, you see a waterfall: *this request took 480 ms, 400 ms of it was one outgoing call, and it logged this warning on the way.*

From the same drawer you can **Copy as curl / fetch / autocannon** or **Replay** the request with edits.

### 3. Queries: N+1 detection without an APM

`pg` and `mysql2` are instrumented automatically. Prisma, Sequelize and TypeORM take one small hook:

```typescript
const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
server.trackPrisma(prisma);
```

The Queries panel flags slow statements and marks **N+1 suspects** (the same statement repeated 5+ times within a single request). Query parameter values are never recorded.

### 4. Errors, grouped

Instead of a wall of stack traces, failures are grouped by type, message shape and origin, with counts, the stack and a link to the request that triggered them. `/crash/123` and `/crash/456` collapse into a single entry.

### 5. Runtime: memory, CPU, event loop, heap snapshots

Live heap, RSS, CPU and event-loop lag. When you suspect a leak, open **Heap Snapshot**, click, confirm, and load the `.heapsnapshot` into Chrome DevTools. Because a heap dump contains every secret in memory, the file is written owner-only (`0600`) and the action needs a single-use confirmation token. There is also a CPU **Profiler** that records a profile under load and shows it as a flame graph.

### 6. "Grafana for local"

This is the part that surprised me. NodeUI keeps an in-memory metrics history (one hour at 1 s resolution, eight hours at 10 s) with:

- throughput, p50–p99 latency, concurrency, event loop, memory, CPU and GC
- drag-to-zoom and a shared crosshair
- a **latency heatmap**, which shows things percentiles hide. A single slow route shows up as a thin bright band that a p95 line would smooth away.
- markers for your own events: `server.annotate('deployed v2')`

You get Grafana-style charts without running Prometheus or Docker. And if you *do* have Grafana, `GET /nodeui/api/prometheus` can be scraped.

### 7. Load tests and CI budgets

Record a run while `autocannon`, `k6` or `wrk` fire at your app (or click **Generate load**), pin a baseline, and compare runs with better/worse deltas. This turns "did my refactor make it slower?" into a measurement instead of a feeling.

You can also fail CI on a regression:

```bash
npx @singhak/nodeui-cli check --run latest --max-p99 300 --max-regression 10 http://127.0.0.1:3000
```

It exits non-zero when a budget is broken.

### 8. Alerts

```typescript
nodeui({ alerts: [{ metric: 'p99', threshold: 300 }] });
```

A banner shows on every view while a rule is firing. Handy when you leave the app running during a long local load test.

### 9. Your own panels

Anything with an `id` and a `get()` becomes a panel: queues, cache stats, feature flags.

```typescript
nodeui({
  plugins: [
    {
      id: 'queues',
      title: 'Job Queues',
      get: async () => ({ ok: true, data: await queue.getJobCounts() }),
    },
  ],
});
```

Plugin output goes through the same secret masking as the built-in panels, and a `get()` that throws is reported as an error instead of breaking the console.

---

## What about the overhead?

I was skeptical, so I read the benchmark numbers. They come from the project's own `npm run bench` script (Node 24, Express 5, trivial JSON handler, loopback), so run it on your hardware before trusting them:

- Baseline (no NodeUI): p50 **1.57 ms**
- Enabled: p50 **1.74 ms**, about **+0.18 ms** per request
- Disabled (fail-closed): within noise of the baseline

That is a fixed cost, not a proportional one, so against a real handler that talks to a database it shrinks to nothing. Capture hooks cost a few microseconds per outgoing call. If you want zero cost until you actually look, set `capture: 'lazy'`.

It also plays well with other tooling. It only restores functions it still owns, and the project tests it side by side with the real `@opentelemetry/instrumentation-http`. If you're already on OpenTelemetry, NodeUI can export spans to any OTLP/HTTP collector (Jaeger, Tempo, the OTel Collector) with `nodeui({ otlp: 'http://localhost:4318' })`, with no OTel SDK required.

---

## A bonus: let your AI assistant read it

NodeUI includes a read-only [MCP](https://modelcontextprotocol.io) server, so an AI coding agent can inspect your running app:

```json
{
  "mcpServers": {
    "nodeui": {
      "command": "npx",
      "args": ["@singhak/nodeui-cli", "mcp", "http://127.0.0.1:3000"]
    }
  }
}
```

The agent gets an overview digest, grouped errors, and requests joined with their queries, outgoing calls and logs. Since it reads the already-masked console API, secrets stay masked and no confirmation-gated action is reachable. "Why is `/orders` slow?" becomes a question your assistant can answer from real data instead of guessing from source code.

---

## Working in Docker

Inside a container, the browser's requests arrive from the Docker bridge rather than `127.0.0.1`, so they would be rejected. Allow that explicitly and keep a token on:

```typescript
nodeui({
  allowedRemoteAddresses: ['172.16.0.0/12'],
  authToken: process.env.NODEUI_TOKEN,
});
```

Then publish the port on loopback only (`-p 127.0.0.1:3000:3000`).

---

## When NOT to use it

I want to be upfront, because the maintainers are:

- **It is not a production APM.** It is off in production by default and stores history in memory. In production, use Prometheus or OpenTelemetry. NodeUI complements them for the development loop.
- **Next.js route handlers and Edge runtimes aren't supported**, since they don't expose Node's request/response objects. Custom Next servers work through the `http` adapter.
- **Persistence is simple.** An opt-in append-only file (`persist`) restores recent activity after a restart, which is handy with `nodemon`, but it is a replay log, not a database.
- Compatibility with Sentry and Datadog agents is, per the docs, not yet verified.

---

## Why I like it

Three reasons.

**1. It removes friction.** The best debugging tool is the one you actually open. When it costs two lines and a browser tab, you use it for small questions too, not just during incidents.

**2. It's honest about its scope.** Loopback-only, fail-closed in production, secrets masked by default, dangerous actions gated behind confirmation. It feels designed by someone who has worried about leaking a heap dump.

**3. It's one dependency.** The UI ships inside `@singhak/nodeui-core`, so you can't end up with a UI and API at mismatched versions.

If you've ever envied the Spring or Quarkus crowd for having a built-in dev console, give it a try:

```bash
npm install --save-dev @singhak/nodeui-express   # or -fastify / -nestjs / -koa / -hapi / -hono / -http
```

- Docs: https://singhak.github.io/nodeui/
- GitHub: https://github.com/Singhak/nodeui
- npm: https://www.npmjs.com/org/singhak

The repo includes Express and NestJS demos. Run `DEMO_TRAFFIC=1 npm run demo:express` and every panel fills with live data in under a minute.

If you try it, I'd like to hear which panel you reach for first. For me it's the request waterfall.

---

*If this was useful, a clap or a follow helps other Node developers find it.*
