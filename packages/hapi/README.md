# @singhak/nodeui-hapi

Hapi plugin adapter for the NodeUI developer console. Serves the console and API under `{path}` (default `/nodeui`), records app requests with their route pattern, lists your route table, and sends handler exceptions to the Errors panel.

## Install

```bash
npm install @singhak/nodeui-hapi
```

## Usage

```ts
import Hapi from '@hapi/hapi';
import { nodeui } from '@singhak/nodeui-hapi';

const server = Hapi.server({ port: 3000, host: '127.0.0.1' });
const ui = nodeui();

await server.register(ui.plugin);
server.route({ method: 'GET', path: '/hello', handler: () => ({ hello: 'world' }) });

await server.start();
ui.server.mark('listening');
```

Open `http://127.0.0.1:3000/nodeui` for the console and
`http://127.0.0.1:3000/nodeui/api/config` for the API.

Supports Hapi 21. Register the plugin before your routes. Boom client errors (4xx) are not recorded as errors.

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
