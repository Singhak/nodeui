# @singhak/nodeui-hono

Hono middleware adapter (Node.js runtime) for the NodeUI developer console. Serves the console and API under `{path}` (default `/nodeui`), records app requests with their route pattern, and records errors that reach Hono's `onError`.

## Install

```bash
npm install @singhak/nodeui-hono
```

## Usage

```ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { nodeui } from '@singhak/nodeui-hono';

const app = new Hono();
const ui = nodeui();

app.use('*', ui.middleware); // register first so every request is recorded
app.get('/hello', (c) => c.json({ hello: 'world' }));
ui.setApp(app); // feeds the Routes panel

serve({ fetch: app.fetch, port: 3000, hostname: '127.0.0.1' }, () => ui.server.mark('listening'));
```

Open `http://127.0.0.1:3000/nodeui` for the console and
`http://127.0.0.1:3000/nodeui/api/config` for the API.

Requires `@hono/node-server` (>= 1.19), which exposes the Node `IncomingMessage`/`ServerResponse` the safety checks need. On other runtimes (Workers, Deno, Bun) the middleware is a pass-through.

## Options

`nodeui(options?)` accepts any `@singhak/nodeui-core` `NodeUIOptions` (path, host
allow-lists, auth token, plugins, health checks, request detail, persistence,
OTLP export, etc.). See the `@singhak/nodeui-core` README for the full
configuration table and safety model.

## Development

```bash
npm run typecheck
npm test
npm run build
```
