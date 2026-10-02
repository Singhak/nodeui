# @singhak/nodeui-fastify

Fastify plugin adapter for the NodeUI developer console. Serves the bundled React
console and its API under `{path}` (default `/nodeui`), records app requests in
the request-log panel and lists your Fastify routes in the routes panel.

Supports Fastify 4 and 5.

## Install

```bash
npm install @singhak/nodeui-fastify
```

## Usage

```ts
import Fastify from 'fastify';
import { nodeui } from '@singhak/nodeui-fastify';

const app = Fastify();
const ui = nodeui();

// Register before your routes so they appear in the routes panel.
await app.register(ui);

app.get('/hello', async () => ({ hello: 'world' }));

await app.listen({ port: 3000, host: '127.0.0.1' });
ui.server.mark('listening');
```

Open `http://127.0.0.1:3000/nodeui` for the console and
`http://127.0.0.1:3000/nodeui/api/config` for the API.

The plugin is not encapsulated (equivalent to `fastify-plugin`), shuts the
server down on `app.close()`, and does nothing when NodeUI is disabled (for
example when `NODE_ENV=production`).

## Options

`nodeui(options?)` accepts any `@singhak/nodeui-core` `NodeUIOptions` (path, host
allow-lists, auth token, plugins, health checks, etc.). See the
`@singhak/nodeui-core` README for the full configuration table and safety model.

## Development

```bash
npm run typecheck
npm test
npm run build
```
