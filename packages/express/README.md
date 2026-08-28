# @singhak/nodeui-express

Express middleware adapter for the NodeUI developer console. Mounts the core
middleware, serving the bundled React console and its API under `{path}`
(default `/nodeui`) and recording app requests in the request-log panel.

## Install

```bash
npm install @singhak/nodeui-express
```

## Usage

```ts
import express from 'express';
import { nodeui } from '@singhak/nodeui-express';

const app = express();
const { middleware, server } = nodeui();

app.use(express.json());
app.use(middleware);

app.get('/hello', (_req, res) => res.json({ hello: 'world' }));

app.listen(3000, '127.0.0.1', () => {
  server.mark('listening');
});
```

Open `http://127.0.0.1:3000/nodeui` for the console and
`http://127.0.0.1:3000/nodeui/api/config` for the API.

## Options

`nodeui(options?)` accepts any `@singhak/nodeui-core` `NodeUIOptions` (env overrides,
path, request-log size, poll interval, etc.). See the `@singhak/nodeui-core` README for
the full configuration table and safety model.

## Development

```bash
npm run typecheck
npm test
npm run build
```
