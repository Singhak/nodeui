import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { nodeui } from '../src/index';

function makeApp(options?: Parameters<typeof nodeui>[0]) {
  const app = express();
  const { middleware, server } = nodeui(options);
  app.use(middleware);
  app.get('/hello', (_req, res) => {
    res.json({ hello: 'world' });
  });
  return { app, server };
}

describe('@nodeui/express', () => {
  it('serves the config envelope under /nodeui/api', async () => {
    const { app, server } = makeApp();
    const res = await request(app).get('/nodeui/api/config');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.path).toBe('/nodeui');
    expect(res.body.data.enabled).toBe(true);
    server.shutdown();
  });

  it('serves all panels', async () => {
    const { app, server } = makeApp();
    for (const panel of [
      'health',
      'memory',
      'cpu',
      'event-loop',
      'heap-snapshot',
      'startup',
      'requests',
    ]) {
      const res = await request(app).get(`/nodeui/api/${panel}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }
    server.shutdown();
  });

  it('keeps the host app working alongside the console', async () => {
    const { app, server } = makeApp();
    const res = await request(app).get('/hello');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hello: 'world' });
    server.shutdown();
  });

  it('records app requests but not its own API calls', async () => {
    const { app, server } = makeApp();
    await request(app).get('/hello');
    await request(app).get('/hello');
    await request(app).get('/nodeui/api/config');
    const res = await request(app).get('/nodeui/api/requests');
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.entries.map((e) => e.path)).toEqual(['/hello', '/hello']);
    server.shutdown();
  });

  it('fails closed in production', async () => {
    const { app, server } = makeApp({ env: { NODE_ENV: 'production' } });
    const consoleRes = await request(app).get('/nodeui/api/config');
    expect(consoleRes.status).toBe(404);
    const appRes = await request(app).get('/hello');
    expect(appRes.status).toBe(200);
    server.shutdown();
  });

  it('exposes startup marks via server.mark()', async () => {
    const { app, server } = makeApp();
    server.mark('booted');
    const res = await request(app).get('/nodeui/api/startup');
    expect(res.body.data.marks.map((m: { name: string }) => m.name)).toEqual([
      'nodeui.init',
      'booted',
    ]);
    server.shutdown();
  });
});
