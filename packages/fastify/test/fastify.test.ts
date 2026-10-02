import Fastify, { type FastifyInstance } from 'fastify';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nodeui } from '../src/index';

const apps: FastifyInstance[] = [];

async function makeApp(options?: Parameters<typeof nodeui>[0]) {
  const app = Fastify();
  apps.push(app);
  const ui = nodeui({ enabled: true, ...options });
  await app.register(ui);
  app.get('/hello', async () => ({ hello: 'world' }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  return { app, ui, port };
}

function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers, agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close().catch(() => undefined)));
});

describe('@singhak/nodeui-fastify', () => {
  it('attributes logs from async handlers to their request', async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(nodeui({ enabled: true }));
    app.get('/work', async () => {
      await new Promise((r) => setTimeout(r, 5));
      console.log('inside fastify handler');
      return 'ok';
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    await get(port, '/nodeui/api/logs');
    await get(port, '/work');
    const requests = JSON.parse((await get(port, '/nodeui/api/requests')).body).data.entries;
    const logs = JSON.parse((await get(port, '/nodeui/api/logs')).body).data.entries;
    const id = requests.find((e: { path: string }) => e.path === '/work').id;
    const entry = logs.find((e: { message: string }) => e.message === 'inside fastify handler');
    expect(entry.requestId).toBe(id);
  });

  it('records route errors in the errors panel', async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(nodeui({ enabled: true }));
    app.get('/fail/:id', async () => {
      throw new Error('fail 3');
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    await get(port, '/fail/1');
    await get(port, '/fail/2');
    const res = await get(port, '/nodeui/api/errors');
    const data = JSON.parse(res.body).data;
    expect(data.total).toBe(2);
    expect(data.groups[0]).toMatchObject({ count: 2, lastRoute: '/fail/:id' });
  });

  it('serves the config envelope', async () => {
    const { port } = await makeApp();
    const res = await get(port, '/nodeui/api/config');
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.data.path).toBe('/nodeui');
  });

  it('keeps the host app working', async () => {
    const { port } = await makeApp();
    const res = await get(port, '/hello');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ hello: 'world' });
  });

  it('records app requests but not console calls', async () => {
    const { port } = await makeApp();
    await get(port, '/hello');
    const res = await get(port, '/nodeui/api/requests');
    const entries = JSON.parse(res.body).data.entries as Array<{ path: string; status: number }>;
    expect(entries.some((e) => e.path === '/hello' && e.status === 200)).toBe(true);
    expect(entries.some((e) => e.path.startsWith('/nodeui'))).toBe(false);
  });

  it('lists Fastify routes in the routes panel', async () => {
    const { port } = await makeApp();
    const res = await get(port, '/nodeui/api/routes');
    expect(res.status).toBe(200);
    const routes = JSON.parse(res.body).data.routes as Array<{ method: string; path: string }>;
    expect(routes).toContainEqual(expect.objectContaining({ method: 'GET', path: '/hello' }));
  });

  it('rejects a non-loopback Host header with 403', async () => {
    const { port } = await makeApp();
    const res = await get(port, '/nodeui/api/config', { Host: 'evil.example.com' });
    expect(res.status).toBe(403);
  });

  it('is disabled in production and leaves the app alone', async () => {
    const { port } = await makeApp({ enabled: undefined, env: { NODE_ENV: 'production' } });
    const res = await get(port, '/nodeui/api/config');
    expect(res.status).toBe(404);
    const hello = await get(port, '/hello');
    expect(hello.status).toBe(200);
  });

  it('shuts the server down when the app closes', async () => {
    const app = Fastify();
    const ui = nodeui({ enabled: true });
    const spy = vi.spyOn(ui.server, 'shutdown');
    await app.register(ui);
    await app.ready();
    await app.close();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
