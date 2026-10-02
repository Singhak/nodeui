import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Controller, Get, HttpException, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeUILogger, NodeUIModule, NodeUIService, type NodeUIOptions } from '../src/index';

const apps: INestApplication[] = [];

async function createApp(options?: NodeUIOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [NodeUIModule.register(options)],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  apps.push(app);
  return app;
}

@Controller()
class BoomController {
  @Get('boom')
  boom(): never {
    throw new Error('boom 1');
  }

  @Get('missing')
  missing(): never {
    throw new HttpException('nope', 404);
  }
}

@Module({ controllers: [BoomController] })
class BoomModule {}

afterEach(async () => {
  while (apps.length) {
    const app = apps.pop();
    if (app) await app.close();
  }
});

describe('@singhak/nodeui-nestjs', () => {
  it('serves the console API under /nodeui/api', async () => {
    const app = await createApp();
    const res = await request(app.getHttpServer()).get('/nodeui/api/config');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.path).toBe('/nodeui');
    expect(res.body.data.enabled).toBe(true);
  });

  it('serves the health panel', async () => {
    const app = await createApp();
    const res = await request(app.getHttpServer()).get('/nodeui/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.nodeVersion).toMatch(/^v/);
  });

  it('records startup marks through the injectable NodeUIService', async () => {
    const app = await createApp();
    const service = app.get(NodeUIService);
    service.mark('booted');
    const res = await request(app.getHttpServer()).get('/nodeui/api/startup');
    expect(res.body.ok).toBe(true);
    expect(res.body.data.marks.map((m: { name: string }) => m.name)).toEqual([
      'nodeui.init',
      'booted',
    ]);
  });

  it('fails closed in production', async () => {
    const app = await createApp({ env: { NODE_ENV: 'production' } });
    const res = await request(app.getHttpServer()).get('/nodeui/api/config');
    expect(res.status).toBe(404);
  });
});

describe('NodeUIErrorInterceptor', () => {
  it('records 5xx handler errors but not client errors', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NodeUIModule.register(), BoomModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    apps.push(app);
    const http = request(app.getHttpServer());
    expect((await http.get('/boom')).status).toBe(500);
    expect((await http.get('/missing')).status).toBe(404);
    const res = await http.get('/nodeui/api/errors');
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.groups[0]).toMatchObject({ name: 'Error', source: 'request' });
  });
});

describe('NodeUILogger', () => {
  it('mirrors Nest log lines into the logs panel', async () => {
    const app = await createApp();
    const logger = app.get(NodeUILogger);
    logger.log('hello from nest', 'Ctx');
    logger.error('kaboom');
    const res = await request(app.getHttpServer()).get('/nodeui/api/logs');
    const messages = (res.body.data.entries as Array<{ level: string; message: string }>).map(
      (e) => `${e.level}:${e.message}`,
    );
    expect(messages).toContain('info:hello from nest Ctx');
    expect(messages).toContain('error:kaboom');
  });
});
