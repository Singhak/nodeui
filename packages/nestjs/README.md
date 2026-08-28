# @nodeui/nestjs

NestJS module adapter for the NodeUI developer console. Registers the core
middleware for every route, serving the bundled React console and its API under
`{path}` (default `/nodeui`) and recording app requests in the request-log
panel.

## Install

```bash
npm install @nodeui/nestjs
```

Peer dependencies: `@nestjs/common`, `@nestjs/core`, `reflect-metadata`,
`rxjs`.

## Usage

```ts
import { Module } from '@nestjs/common';
import { NodeUIModule } from '@nodeui/nestjs';

@Module({ imports: [NodeUIModule.register()] })
export class AppModule {}
```

```ts
// main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NodeUIService } from '@nodeui/nestjs';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000, '127.0.0.1');
  app.get(NodeUIService).mark('listening');
}

void bootstrap();
```

Open `http://127.0.0.1:3000/nodeui` for the console and
`http://127.0.0.1:3000/nodeui/api/config` for the API.

## NodeUIService

Injectable handle to the underlying server:

- `mark(name)` — record a startup timing mark.
- `config` — the effective configuration.
- `shutdown()` — stop all sampling and timers.

## Options

`NodeUIModule.register(options?)` accepts any `@nodeui/core` `NodeUIOptions`.
See the `@nodeui/core` README for the configuration table and safety model.

## Development

```bash
npm run typecheck
npm test
npm run build
```
