import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeUIModule, NodeUIService, type NodeUIOptions } from '../src/index';

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
