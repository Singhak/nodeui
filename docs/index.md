---
layout: home
hero:
  name: NodeUI
  text: The local-only developer console for Node.js
  tagline: An embedded, zero-infrastructure dashboard for Express, Fastify, NestJS, Koa, Hapi, Hono and plain node:http.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/Singhak/nodeui
features:
  - title: Embedded
    details: A React UI and REST/SSE endpoints mounted inside your existing app. No extra servers, no cloud, no containers.
  - title: Local and secure
    details: Loopback-only by default, automatic secret masking, and fail-closed in production.
  - title: Everything in one place
    details: Requests, queries (with N+1 detection), errors, outgoing calls, logs, routes, memory, CPU, event-loop lag and heap snapshots.
  - title: Request correlation
    details: Outgoing calls, queries and log lines are attributed to the request that caused them, shown as a per-request timeline.
  - title: Low overhead
    details: Bounded ring buffers and samplers that sleep when idle. Use capture lazy for zero cost until you look.
  - title: Extensible
    details: Add your own panels, export to OpenTelemetry, attach with no code changes, or let an AI agent read it over MCP.
---

## Quick start

```bash
npm install --save-dev @singhak/nodeui-express
```

```typescript
import { nodeui } from '@singhak/nodeui-express';

const { middleware, server } = nodeui();
app.use(middleware); // before your routes
app.listen(3000, '127.0.0.1', () => server.mark('listening'));
```

Then open `http://127.0.0.1:3000/nodeui`.
