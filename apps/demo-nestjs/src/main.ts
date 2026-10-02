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
    const paths = ['/hello', '/users/42', '/hello'];
    let i = 0;
    setInterval(
      () => void fetch(`http://${host}:${port}${paths[i++ % paths.length]}`),
      250,
    ).unref();
  }
}

void bootstrap();
