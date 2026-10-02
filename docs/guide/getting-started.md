# Getting started

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

**3. Start your app in development and open the console:**

```
http://127.0.0.1:<your-port>/nodeui
```

Use `127.0.0.1` or `localhost`; other hostnames are rejected unless you add them to `allowedHosts`. CPU, memory and event-loop sampling starts when you open the console and sleeps after a minute idle. Outgoing calls, queries and logs are captured from startup (see [`capture`](/guide/capture)), so you can open the console after a problem and still see what led to it.

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
