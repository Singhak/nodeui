# Architecture

NodeUI embeds into your application pipeline without external processes. The adapter for your framework mounts the core engine under a prefix (default `/nodeui`); the browser talks to it over REST and Server-Sent Events.

```text
Browser (http://127.0.0.1:3000/nodeui)
   ▲  JSON + SSE
   │
┌──┴─────────────────────────────────────────────────────────────┐
│ Your Node.js app (Express, Fastify, NestJS, Koa, Hapi, Hono…)  │
│                                                                │
│  Routes & middleware ──► NodeUI adapter (/nodeui/*)            │
│                              │                                 │
│        ┌─────────────────────▼───────────────────────┐         │
│        │ @singhak/nodeui-core                        │         │
│        │  Safety gate (loopback, Host/Origin, env)   │         │
│        │  REST & SSE handlers ─► Secret masker       │         │
│        │  Ring buffers (requests, logs, queries…)    │         │
│        │  Lazy samplers (CPU, event loop, memory)    │         │
│        │  Static server (embedded React SPA)         │         │
│        └─────────────────────────────────────────────┘         │
└────────────────────────────────────────────────────────────────┘
```

Every request passes the safety gate first, and every response passes the secret masker.

## Why the UI is embedded, not a separate package

The console ships **inside `@singhak/nodeui-core`** (`static/`) instead of as its own npm package. The UI and the REST API it calls change together, so a separate package could be installed at a mismatched version and break silently; embedding makes that impossible and keeps installation to one dependency.

To serve the console from your own host or gateway, use the exported path:

```typescript
import { uiAssetsDir } from '@singhak/nodeui-core';

const dir = uiAssetsDir(); // …/node_modules/@singhak/nodeui-core/static
```

The UI derives its API base from the URL it is served at (`<prefix>/` talks to `<prefix>/api`), so it works under any prefix. The `nodeui` CLI uses exactly this for its multi-service dashboard.

## Packages

| Package                   | Description                                                              |
| :------------------------ | :----------------------------------------------------------------------- |
| `@singhak/nodeui-core`    | Framework-neutral engine, REST/SSE provider registry, static SPA server. |
| `@singhak/nodeui-express` | Middleware adapter for Express.                                          |
| `@singhak/nodeui-fastify` | Plugin adapter for Fastify 4 / 5.                                        |
| `@singhak/nodeui-nestjs`  | Dynamic module for NestJS (Express or Fastify platform).                 |
| `@singhak/nodeui-koa`     | Middleware adapter for Koa 2 / 3.                                        |
| `@singhak/nodeui-hapi`    | Plugin adapter for Hapi 21.                                              |
| `@singhak/nodeui-hono`    | Middleware adapter for Hono on Node.js.                                  |
| `@singhak/nodeui-http`    | Plain `node:http` adapter (also Next.js custom servers, Restify).        |
| `@singhak/nodeui-cli`     | `npx` command: attach without code changes, dashboard, MCP server.       |
