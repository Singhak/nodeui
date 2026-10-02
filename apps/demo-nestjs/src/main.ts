import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NodeUILogger, NodeUIService } from '@singhak/nodeui-nestjs';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Mirror Nest's own logger into the NodeUI Logs panel.
  app.useLogger(app.get(NodeUILogger));
  const port = Number(process.env.PORT ?? 3001);
  const host = '127.0.0.1';
  await app.listen(port, host);
  app.get(NodeUIService).mark('listening');
  console.log(`[demo-nestjs] listening on http://${host}:${port}  ->  console at /nodeui`);

  if (process.env.DEMO_TRAFFIC === '1') {
    const paths = ['/hello', '/users/42', '/orders', 'POST /orders', '/crash/42', '/crash/43'];
    let i = 0;
    setInterval(() => {
      const path = paths[i++ % paths.length]!;
      const post = path.startsWith('POST ');
      void fetch(`http://${host}:${port}${path.replace('POST ', '')}`, {
        method: post ? 'POST' : 'GET',
        headers: post ? { 'content-type': 'application/json' } : undefined,
        body: post ? JSON.stringify({ customer: 'Ada', password: 'hunter2' }) : undefined,
      }).catch(() => undefined);
    }, 250).unref();
  }
}

void bootstrap();
