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

describe('@singhak/nodeui-express', () => {
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

  it('records the matched route pattern for parameterised routes', async () => {
    const { app, server } = makeApp();
    app.get('/users/:name', (_req, res) => {
      res.json({ ok: true });
    });
    await request(app).get('/users/alice');
    await request(app).get('/users/bob');
    const res = await request(app).get('/nodeui/api/requests');
    expect(res.body.data.entries.map((e) => e.route)).toEqual(['/users/:name', '/users/:name']);
    expect(res.body.data.summary.routes[0].path).toBe('/users/:name');
    server.shutdown();
  });

  it('records errors passed through the error handler', async () => {
    const { server, middleware, errorHandler } = nodeui();
    const app = express();
    app.use(middleware);
    app.get('/boom/:id', () => {
      throw new Error('boom 7');
    });
    app.use(errorHandler);
    app.use(((_err, _req, res, _next) => {
      res.status(500).json({ failed: true });
    }) as express.ErrorRequestHandler);
    await request(app).get('/boom/7');
    await request(app).get('/boom/8');
    const res = await request(app).get('/nodeui/api/errors');
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.groups).toHaveLength(1);
    expect(res.body.data.groups[0]).toMatchObject({
      count: 2,
      lastRoute: '/boom/:id',
      source: 'request',
    });
    expect(res.body.data.groups[0].lastRequestId).toBeGreaterThan(0);
    server.shutdown();
  });

  it('does not record client errors', async () => {
    const { server, middleware, errorHandler } = nodeui();
    const app = express();
    app.use(middleware);
    app.get('/missing', (_req, _res, next) => {
      next(Object.assign(new Error('nope'), { status: 404 }));
    });
    app.use(errorHandler);
    app.use(((_err, _req, res, _next) => {
      res.status(404).end();
    }) as express.ErrorRequestHandler);
    await request(app).get('/missing');
    const res = await request(app).get('/nodeui/api/errors');
    expect(res.body.data.total).toBe(0);
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
