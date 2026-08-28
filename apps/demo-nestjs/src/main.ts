import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NodeUIService } from '@singhak/nodeui-nestjs';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3001);
  const host = '127.0.0.1';
  await app.listen(port, host);
  app.get(NodeUIService).mark('listening');
  app
    .get(NodeUIService)
    .addLogSource({ level: 'info', message: 'demo-nestjs listening on port ' + port });
  console.log(`[demo-nestjs] listening on http://${host}:${port}`);
}

void bootstrap();
