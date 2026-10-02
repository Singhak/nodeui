/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON assertions */
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createNodeUI } from '@singhak/nodeui-core';
import { afterEach, describe, expect, it } from 'vitest';
import { startDashboard, type Dashboard } from '../src/dashboard';

const servers: Server[] = [];
const dashboards: Dashboard[] = [];

async function service(options: { token?: string } = {}) {
  const ui = createNodeUI({ enabled: true, authToken: options.token });
  const mw = ui.middleware();
  const app = createServer((req, res) =>
    mw(req, res, () => {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('app');
    }),
  );
  servers.push(app);
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  return { ui, port: (app.address() as AddressInfo).port };
}

afterEach(async () => {
  for (const d of dashboards.splice(0)) await d.close();
  for (const s of servers.splice(0)) {
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

describe('dashboard', () => {
  it('lists services with live status, including unreachable ones', async () => {
    const a = await service();
    await fetch(`http://127.0.0.1:${a.port}/hello`);
    const d = await startDashboard({
      port: 0,
      services: [
        { name: 'api', base: `http://127.0.0.1:${a.port}/nodeui` },
        { name: 'ghost', base: 'http://127.0.0.1:1/nodeui' },
      ],
    });
    dashboards.push(d);
    const body = (await (await fetch(`http://127.0.0.1:${d.port}/api/services`)).json()) as any;
    const [api, ghost] = body.data;
    expect(api).toMatchObject({ name: 'api', up: true, requests: 1 });
    expect(ghost).toMatchObject({ name: 'ghost', up: false });
    expect(ghost.reason).toContain('cannot reach');
    const page = await (await fetch(`http://127.0.0.1:${d.port}/`)).text();
    expect(page).toContain('NodeUI services');
    a.ui.shutdown();
  });

  it('serves each console and proxies its API, adding the service token', async () => {
    const a = await service({ token: 'secret' });
    const d = await startDashboard({
      port: 0,
      services: [{ name: 'api', base: `http://127.0.0.1:${a.port}/nodeui`, token: 'secret' }],
    });
    dashboards.push(d);
    const base = `http://127.0.0.1:${d.port}/s/api`;
    const redirect = await fetch(base, { redirect: 'manual' });
    expect(redirect.status).toBe(308);
    expect(await (await fetch(`${base}/`)).text()).toContain('<div id="root"></div>');
    // The service itself refuses a call without its token.
    const direct = await fetch(`http://127.0.0.1:${a.port}/nodeui/api/config`);
    expect(direct.status).toBe(401);
    const proxied = (await (await fetch(`${base}/api/config`)).json()) as any;
    expect(proxied.ok).toBe(true);
    expect(proxied.data.enabled).toBe(true);
    // A cross-origin browser request is refused by the dashboard's own guard.
    const evil = await fetch(`${base}/api/confirmations`, {
      method: 'POST',
      headers: { origin: 'http://evil.example' },
    });
    expect(evil.status).toBe(403);
    a.ui.shutdown();
  });

  it('answers 404 for unknown services and 502 when a service is down', async () => {
    const d = await startDashboard({
      port: 0,
      services: [{ name: 'down', base: 'http://127.0.0.1:1/nodeui' }],
    });
    dashboards.push(d);
    expect((await fetch(`http://127.0.0.1:${d.port}/s/nope/`)).status).toBe(404);
    const res = await fetch(`http://127.0.0.1:${d.port}/s/down/api/config`);
    expect(res.status).toBe(502);
  });

  it('rejects requests with a foreign Host header (DNS rebinding)', async () => {
    const d = await startDashboard({
      port: 0,
      services: [{ name: 'x', base: 'http://127.0.0.1:1/nodeui' }],
    });
    dashboards.push(d);
    const status = await new Promise<number>((resolve) => {
      const r = request(
        { host: '127.0.0.1', port: d.port, path: '/', headers: { host: 'evil.example' } },
        (m) => {
          m.resume();
          resolve(m.statusCode ?? 0);
        },
      );
      r.end();
    });
    expect(status).toBe(403);
  });
});
