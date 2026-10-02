/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON assertions */
import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeui } from '../src/index';

const servers: ServerType[] = [];

async function makeApp(options?: Parameters<typeof nodeui>[0]) {
  const ui = nodeui({ enabled: true, ...options });
  const app = new Hono();
  app.use('*', ui.middleware);
  app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }));
  app.get('/boom', () => {
    throw new Error('boom 1');
  });
  app.get('/missing', () => {
    throw new HTTPException(404, { message: 'nope' });
  });
  app.get('/log', async (c) => {
    await new Promise((r) => setTimeout(r, 5));
    console.log('inside handler');
    return c.text('ok');
  });
  ui.setApp(app);
  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s));
  });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => {
    const res = await fetch(base + path);
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, text, json };
  };
  return { ui, get };
}

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop();
    s?.closeAllConnections?.();
    await new Promise<void>((r) => s?.close(() => r()));
  }
});

describe('@singhak/nodeui-hono', () => {
  it('serves the console API and static UI', async () => {
    const { get } = await makeApp();
    const config = await get('/nodeui/api/config');
    expect(config.status).toBe(200);
    expect(config.json.data.enabled).toBe(true);
    const html = await get('/nodeui/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('<div id="root"></div>');
  });

  it('records requests with route patterns and fills the routes panel', async () => {
    const { get } = await makeApp();
    await get('/users/1');
    await get('/users/2');
    await get('/nodeui/api/config');
    const requests = await get('/nodeui/api/requests');
    expect(requests.json.data.total).toBe(2);
    expect(requests.json.data.entries.map((e: { route: string }) => e.route)).toEqual([
      '/users/:id',
      '/users/:id',
    ]);
    const routes = await get('/nodeui/api/routes');
    expect(JSON.stringify(routes.json.data)).toContain('/users/:id');
  });

  it('records thrown errors but not HTTPException client errors', async () => {
    const { get } = await makeApp();
    expect((await get('/boom')).status).toBe(500);
    expect((await get('/missing')).status).toBe(404);
    const errors = await get('/nodeui/api/errors');
    expect(errors.json.data.total).toBe(1);
    expect(errors.json.data.groups[0]).toMatchObject({ message: 'boom 1' });
  });

  it('attributes logs to the request', async () => {
    const { get } = await makeApp();
    await get('/nodeui/api/logs');
    await get('/log');
    const requests = await get('/nodeui/api/requests');
    const logs = await get('/nodeui/api/logs');
    const id = requests.json.data.entries.find((e: { path: string }) => e.path === '/log').id;
    const entry = logs.json.data.entries.find(
      (e: { message: string }) => e.message === 'inside handler',
    );
    expect(entry.requestId).toBe(id);
  });

  it('passes through when disabled or when not on the Node runtime', async () => {
    const { get } = await makeApp({ enabled: false });
    expect((await get('/users/9')).status).toBe(200);
    expect((await get('/nodeui/api/config')).status).toBe(404);

    const ui = nodeui({ enabled: true });
    const app = new Hono();
    app.use('*', ui.middleware);
    app.get('/x', (c) => c.text('ok'));
    expect((await app.request('/x')).status).toBe(200); // no node bindings: pass-through
    ui.server.shutdown();
  });
});
