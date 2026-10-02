# Framework integrations

## 1. Express

```bash
npm install @singhak/nodeui-express
```

```typescript
import express from 'express';
import { nodeui } from '@singhak/nodeui-express';

const app = express();

// Initialize NodeUI
const { middleware, server, errorHandler } = nodeui({
  path: '/nodeui', // Optional: defaults to /nodeui
});

app.use(middleware);

app.get('/api/users', (req, res) => {
  res.json({ users: ['Alice', 'Bob'] });
});

// Register after your routes to feed the Errors panel (it calls next(err) untouched)
app.use(errorHandler);

app.listen(3000, '127.0.0.1', () => {
  // Record startup mark for the Startup Timeline panel
  server.mark('listening');
  console.log('🚀 Server listening at http://127.0.0.1:3000');
  console.log('📊 NodeUI Dashboard at http://127.0.0.1:3000/nodeui');
});
```

## 2. NestJS

```bash
npm install @singhak/nodeui-nestjs
```

```typescript
import { Module } from '@nestjs/common';
import { NodeUIModule } from '@singhak/nodeui-nestjs';

@Module({
  imports: [
    NodeUIModule.register({
      path: '/nodeui',
      maskSecrets: true,
    }),
  ],
})
export class AppModule {}
```

## 3. Fastify

```bash
npm install @singhak/nodeui-fastify
```

```typescript
import Fastify from 'fastify';
import { nodeui } from '@singhak/nodeui-fastify';

const app = Fastify();
await app.register(nodeui());
await app.listen({ port: 3000, host: '127.0.0.1' });
```

## 4. Koa, Hapi, Hono and plain `node:http`

```typescript
// Koa
app.use(nodeui().middleware); // @singhak/nodeui-koa
// Hapi
await server.register(nodeui().plugin); // @singhak/nodeui-hapi
// Hono (Node runtime)
app.use('*', nodeui().middleware); // @singhak/nodeui-hono
// Next.js custom server, Restify, raw node:http
nodeui().attach(httpServer); // @singhak/nodeui-http
```

See each package's README for details. NestJS also works on the Fastify platform. Next.js route handlers and Edge runtimes expose no Node request/response and are not supported.

> NestJS tip: to see Nest's own `Logger` output in the Logs panel (Nest writes to `process.stdout`, not `console`), use
> `app.useLogger(app.get(NodeUILogger))` from `@singhak/nodeui-nestjs`.
