/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON assertions */
import Boom from '@hapi/boom';
import Hapi, { type Server } from '@hapi/hapi';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeui } from '../src/index';

const servers: Server[] = [];

async function makeServer(options?: Parameters<typeof nodeui>[0]) {
  const ui = nodeui({ enabled: true, ...options });
  const server = Hapi.server({ port: 0, host: '127.0.0.1' });
  servers.push(server);
  await server.register(ui.plugin);
  server.route({ method: 'GET', path: '/users/{id}', handler: (r) => ({ id: r.params.id }) });
  server.route({
    method: 'GET',
    path: '/boom',
    handler: () => {
      throw new Error('boom 1');
    },
  });
  server.route({
    method: 'GET',
    path: '/missing',
    handler: () => {
      throw Boom.notFound('nope');
    },
  });
  server.route({
    method: 'GET',
    path: '/log',
    handler: async () => {
      await new Promise((r) => setTimeout(r, 5));
      console.log('inside handler');
      return 'ok';
    },
  });
  await server.start();
  const base = server.info.uri;
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
  return { ui, server, get };
}

afterEach(async () => {
  while (servers.length) await servers.pop()?.stop({ timeout: 100 });
});

describe('@singhak/nodeui-hapi', () => {
  it('serves the console API and static UI', async () => {
    const { get } = await makeServer();
    const config = await get('/nodeui/api/config');
    expect(config.status).toBe(200);
    expect(config.json.data.enabled).toBe(true);
    const html = await get('/nodeui/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('<div id="root"></div>');
  });

  it('records requests with route patterns and fills the routes panel', async () => {
    const { get } = await makeServer();
    await get('/users/1');
    await get('/users/2');
    await get('/nodeui/api/config');
    const requests = await get('/nodeui/api/requests');
    expect(requests.json.data.total).toBe(2);
    expect(requests.json.data.entries.map((e: { route: string }) => e.route)).toEqual([
      '/users/{id}',
      '/users/{id}',
    ]);
    const routes = await get('/nodeui/api/routes');
    expect(JSON.stringify(routes.json.data)).toContain('/users/{id}');
    expect(JSON.stringify(routes.json.data)).not.toContain('/nodeui');
  });

  it('records handler exceptions but not Boom client errors', async () => {
    const { get } = await makeServer();
    expect((await get('/boom')).status).toBe(500);
    expect((await get('/missing')).status).toBe(404);
    const errors = await get('/nodeui/api/errors');
    expect(errors.json.data.total).toBe(1);
    expect(errors.json.data.groups[0]).toMatchObject({ message: 'boom 1' });
  });

  it('attributes logs to the request across async handler work', async () => {
    const { get } = await makeServer();
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

  it('does nothing when disabled', async () => {
    const { get } = await makeServer({ enabled: false });
    expect((await get('/users/9')).status).toBe(200);
    expect((await get('/nodeui/api/config')).status).toBe(404);
  });
});
