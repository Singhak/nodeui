# @singhak/nodeui-http

Plain `node:http` adapter for the NodeUI developer console: works with raw servers, Restify, micro and **Next.js custom servers**. It wraps the server's `request` event, so it is framework-independent.

## Install

```bash
npm install @singhak/nodeui-http
```

## Usage

```ts
import { createServer } from 'node:http';
import { nodeui } from '@singhak/nodeui-http';

const ui = nodeui();
const httpServer = createServer((req, res) => {
  res.end('hello');
});

ui.attach(httpServer);
httpServer.listen(3000, '127.0.0.1', () => ui.server.mark('listening'));
```

Open `http://127.0.0.1:3000/nodeui` for the console and
`http://127.0.0.1:3000/nodeui/api/config` for the API.

Next.js: use it in a [custom server](https://nextjs.org/docs/pages/guides/custom-server):

```ts
const app = next({ dev: true });
const handle = app.getRequestHandler();
await app.prepare();
const httpServer = createServer((req, res) => handle(req, res));
ui.attach(httpServer);
```

Next.js route handlers and the Edge runtime do not expose a Node request/response and are **not supported**. This level knows nothing about your router: set `req.nodeuiRoute = '/users/:id'` if you want grouped routes, and call `ui.server.recordError(err)` from your error handling.

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
