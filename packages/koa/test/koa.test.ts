import Koa from 'koa';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeui } from '../src/index';

const servers: Server[] = [];

function makeApp(options?: Parameters<typeof nodeui>[0]) {
  const ui = nodeui({ enabled: true, ...options });
  const app = new Koa();
  app.silent = true;
  app.use(ui.middleware);
  app.use(async (ctx, next) => {
    if (ctx.path.startsWith('/users/')) {
      (ctx as unknown as { _matchedRoute: string })._matchedRoute = '/users/:id';
      ctx.body = { id: ctx.path.split('/')[2] };
      return;
    }
    if (ctx.path === '/boom') throw new Error('boom 1');
    if (ctx.path === '/missing') ctx.throw(404, 'nope');
    if (ctx.path === '/log') {
      console.log('inside handler');
      ctx.body = 'ok';
      return;
    }
    await next();
  });
  const server = createServer(app.callback());
  servers.push(server);
  return { ui, server };
}

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop();
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }
});

describe('@singhak/nodeui-koa', () => {
  it('serves the console API and static UI', async () => {
    const { ui, server } = makeApp();
    const config = await request(server).get('/nodeui/api/config');
    expect(config.status).toBe(200);
    expect(config.body.data.enabled).toBe(true);
    const html = await request(server).get('/nodeui/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('<div id="root"></div>');
    ui.server.shutdown();
  });

  it('records app requests with the matched route pattern but not its own API calls', async () => {
    const { ui, server } = makeApp();
    await request(server).get('/users/1');
    await request(server).get('/users/2');
    await request(server).get('/nodeui/api/config');
    const res = await request(server).get('/nodeui/api/requests');
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.entries.map((e: { route: string }) => e.route)).toEqual([
      '/users/:id',
      '/users/:id',
    ]);
    ui.server.shutdown();
  });

  it('records thrown errors (not client errors) and keeps the app response', async () => {
    const { ui, server } = makeApp();
    expect((await request(server).get('/boom')).status).toBe(500);
    expect((await request(server).get('/missing')).status).toBe(404);
    const res = await request(server).get('/nodeui/api/errors');
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.groups[0]).toMatchObject({ name: 'Error', message: 'boom 1' });
    ui.server.shutdown();
  });

  it('attributes logs to the request', async () => {
    const { ui, server } = makeApp();
    await request(server).get('/nodeui/api/logs'); // activates the lazy log capture
    await request(server).get('/log');
    const requests = await request(server).get('/nodeui/api/requests');
    const logs = await request(server).get('/nodeui/api/logs');
    const id = requests.body.data.entries.find((e: { path: string }) => e.path === '/log').id;
    const entry = logs.body.data.entries.find(
      (e: { message: string }) => e.message === 'inside handler',
    );
    expect(entry.requestId).toBe(id);
    ui.server.shutdown();
  });

  it('is a pass-through when disabled', async () => {
    const { ui, server } = makeApp({ enabled: false });
    expect((await request(server).get('/users/9')).status).toBe(200);
    expect((await request(server).get('/nodeui/api/config')).status).toBe(404);
    ui.server.shutdown();
  });

  it('fails closed in production', async () => {
    const ui = nodeui({ env: { NODE_ENV: 'production' } });
    expect(ui.server.active).toBe(false);
    ui.server.shutdown();
  });
});
