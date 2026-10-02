# @singhak/nodeui-cli

Command line for NodeUI: attach the console to **any Node app without changing its code**, watch **several services from one page**, and (soon) expose the data to AI agents.

```bash
npx @singhak/nodeui-cli attach -- node server.js
npx @singhak/nodeui-cli attach -- npm run dev
npx @singhak/nodeui-cli dashboard api=http://127.0.0.1:3000 worker=http://127.0.0.1:3001
```

## `attach`

Runs your command with a small preload (`NODE_OPTIONS=--require …`) that wraps `http.Server` / `https.Server`. The console is served on **your app's own port** under `/nodeui`, and the terminal prints the URL once the app is listening:

```
[nodeui] console: http://127.0.0.1:3000/nodeui/
```

| Option             | Effect                                           |
| ------------------ | ------------------------------------------------ |
| `--path <prefix>`  | console path (default `/nodeui`)                 |
| `--token <secret>` | require an access token                          |
| `--persist <file>` | journal that survives restarts                   |
| `--otlp <url>`     | export spans to an OTLP/HTTP collector           |
| `--bodies`         | capture request/response bodies (masked, capped) |
| `--force`          | attach even when `NODE_ENV=production`           |

What you get: requests, outgoing calls, logs, errors, health, memory/CPU/event loop, and queries from `pg`/`mysql2`. What you do not: route **patterns** and the route table for frameworks that expose them only through an adapter (Express still gets `req.route` patterns; Fastify, Koa, Hapi and Hono need their adapter), and Prisma (`server.trackPrisma`) or other manual hooks.

Notes and limits:

- It does not attach to an already running process; start the app through the CLI. Node cannot inject code into a process that is already running.
- Do not combine it with a NodeUI adapter in the same app: requests would be recorded twice.
- Production stays fail-closed: with `NODE_ENV=production` nothing is attached unless you pass `--force`. The usual loopback, Host and Origin checks apply.
- Child processes inherit `NODE_OPTIONS`, so tools that fork workers (e.g. `npm run dev`) attach in each Node process that creates an HTTP server.

## `dashboard`

One loopback page that lists several running consoles with health, request count, error rate, p95 and error groups, and opens any of them through a proxy at `/s/<name>/`:

```bash
nodeui dashboard --port 4000 api=http://127.0.0.1:3000 billing=http://127.0.0.1:3100/nodeui?token=secret
```

- A service entry is `name=url` or just `url`; the console path defaults to `/nodeui`; `?token=` is the service's access token and is sent as a bearer header by the proxy (never put into the page).
- The dashboard is loopback-only, rejects foreign `Host` and `Origin` headers, and strips cookies/origin when proxying so each service's own checks still apply.
- Each service keeps its own data; the dashboard stores nothing.

## Programmatic use

```ts
import { startDashboard, parseTarget } from '@singhak/nodeui-cli';

const dashboard = await startDashboard({ services: [parseTarget('api=http://127.0.0.1:3000')] });
```
