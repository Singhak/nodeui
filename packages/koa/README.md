# @singhak/nodeui-koa

Koa middleware adapter for the NodeUI developer console. Serves the console and API under `{path}` (default `/nodeui`), records app requests with their `@koa/router` route pattern, and sends thrown errors to the Errors panel.

## Install

```bash
npm install @singhak/nodeui-koa
```

## Usage

```ts
import Koa from 'koa';
import { nodeui } from '@singhak/nodeui-koa';

const app = new Koa();
const { middleware, server } = nodeui();

app.use(middleware); // register first so every request is recorded
app.use(async (ctx) => {
  ctx.body = { hello: 'world' };
});

app.listen(3000, '127.0.0.1', () => server.mark('listening'));
```

Open `http://127.0.0.1:3000/nodeui` for the console and
`http://127.0.0.1:3000/nodeui/api/config` for the API.

Supports Koa 2 and 3. Errors are re-thrown untouched after being recorded (client errors with a 4xx `status` are ignored). Koa has no route table, so the Routes panel stays empty unless you call `server.setRoutes(...)` yourself.

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
