# Getting started

**Requirements:** Node.js 18 or newer. Works with CommonJS and ESM.

**1. Install the adapter for your framework** (it pulls in `@singhak/nodeui-core`):

```bash
npm install --save-dev @singhak/nodeui-express   # or -fastify / -nestjs / -koa / -hapi / -hono / -http
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

**Complete minimal example** (Express, copy and run):

```typescript
import express from 'express';
import { nodeui } from '@singhak/nodeui-express';

const app = express();
const { middleware, errorHandler, server } = nodeui();

app.use(middleware); // 1. before your routes
app.get('/', (_req, res) => res.send('hello'));
app.use(errorHandler); // 2. after your routes (feeds the Errors panel)

app.listen(3000, '127.0.0.1', () => server.mark('listening'));
// open http://127.0.0.1:3000/nodeui
```

**3. Start your app in development and open the console:**

```
http://127.0.0.1:<your-port>/nodeui
```

Use `127.0.0.1` or `localhost`; other hostnames are rejected unless you add them to `allowedHosts`. CPU, memory and event-loop sampling starts when you open the console and sleeps after a minute idle. Outgoing calls, queries and logs are captured from startup (see [`capture`](/guide/capture)), so you can open the console after a problem and still see what led to it.

**Check it works:** `curl http://127.0.0.1:3000/nodeui/api/health` should return `{"ok":true,...}`. If you get a 404 or an HTML page from your own app, the middleware is mounted after your routes or the path is different.

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

**Setup problems and fixes:**

| Symptom                                        | Likely cause and fix                                                                                                 |
| :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| `/nodeui` returns 404                          | Middleware mounted after your routes, or `NODE_ENV=production`. Mount it first, or check the startup warning.        |
| `403 Forbidden`                                | You used a non-loopback host or IP. Use `127.0.0.1` / `localhost`, or set `allowedHosts` / `allowedRemoteAddresses`. |
| Reachable in Docker only from inside           | Publish `127.0.0.1:3000:3000` and set `allowedRemoteAddresses` for the Docker bridge (see the Docker guide).         |
| Console loads but Requests is empty            | No traffic yet, or the middleware is mounted too late. Send a request, then refresh.                                 |
| Routes panel says "No Express router captured" | Express routes appear after the first request. Koa and `node:http` need `server.setRoutes([...])`.                   |
| `Cannot find module` in a production image     | Dev dependency was pruned. Use the conditional `import()` shown above.                                               |

**Not working?** Check the FAQ below, and look at the startup log: NodeUI prints a warning whenever it is inactive-by-config or exposed more widely than loopback.

## What makes it easy to use

- **Three lines to start.** Install the adapter, mount it once, open `/nodeui`. No agents, collectors or dashboards to host.
- **One dependency.** The console UI ships inside `@singhak/nodeui-core`, so UI and API versions can never drift apart.
- **Your framework, same idea.** Express, Fastify, NestJS, Koa, Hapi, Hono and plain `node:http` each have a small adapter. Can't touch the code? `npx @singhak/nodeui-cli attach -- node server.js` attaches without changes.
- **Safe by default.** Loopback-only, off in `NODE_ENV=production`, secrets masked, and mutating actions (like heap snapshots) ask for confirmation.
- **Useful before you configure anything.** Health, requests, errors, queries, logs and runtime panels work out of the box; everything in the options table is optional.
- **Answers a question, not just a chart.** Slow route? Open Requests or Endpoints. N+1 query? Queries flags it. Blocked event loop or leak? Runtime and the Diagnosis card point at it.
- **Look back after a problem.** Outgoing calls, queries and logs are captured from startup, so you can open the console after something went wrong.
- **Try it first.** `npm run demo:express` gives you a populated console in under a minute (see [Try the Demos](./demos)).

**Not sure where to start?** Open **Overview** (is it healthy?), then **Requests** or **Endpoints** (what is slow?), then **Errors** and **Queries** (why?). Reach for Runtime and Profiler only when those point to CPU, memory or event-loop trouble.
