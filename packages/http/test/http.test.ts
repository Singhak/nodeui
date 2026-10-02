/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON assertions */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeui } from '../src/index';

const servers: Server[] = [];

async function makeApp(options?: Parameters<typeof nodeui>[0]) {
  const ui = nodeui({ enabled: true, ...options });
  const seen: string[] = [];
  const app = createServer((req, res) => {
    seen.push(req.url ?? '');
    if (req.url === '/boom') {
      ui.server.recordError(new Error('boom 1'));
      res.writeHead(500).end('boom');
      return;
    }
    void (async () => {
      await new Promise((r) => setTimeout(r, 5));
      console.log(`handling ${req.url}`);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    })();
  });
  const detach = ui.attach(app);
  servers.push(app);
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
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
  return { ui, get, seen, detach };
}

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop();
    s?.closeAllConnections?.();
    await new Promise<void>((r) => s?.close(() => r()));
  }
});

describe('@singhak/nodeui-http', () => {
  it('serves the console without exposing it to the app handler', async () => {
    const { get, seen } = await makeApp();
    const config = await get('/nodeui/api/config');
    expect(config.status).toBe(200);
    expect(config.json.data.enabled).toBe(true);
    expect((await get('/nodeui/')).text).toContain('<div id="root"></div>');
    expect(seen).toEqual([]);
  });

  it('records app requests and attributes logs to them', async () => {
    const { get } = await makeApp();
    await get('/nodeui/api/logs');
    await get('/a');
    await get('/nodeui/api/config');
    const requests = await get('/nodeui/api/requests');
    expect(requests.json.data.total).toBe(1);
    const id = requests.json.data.entries[0].id;
    const logs = await get('/nodeui/api/logs');
    const entry = logs.json.data.entries.find(
      (e: { message: string }) => e.message === 'handling /a',
    );
    expect(entry.requestId).toBe(id);
  });

  it('accepts manually recorded errors', async () => {
    const { get } = await makeApp();
    expect((await get('/boom')).status).toBe(500);
    expect((await get('/nodeui/api/errors')).json.data.groups[0].message).toBe('boom 1');
  });

  it('detaches cleanly and does nothing when disabled', async () => {
    const attached = await makeApp();
    attached.detach();
    expect((await attached.get('/nodeui/api/config')).status).toBe(200); // handled by the app now
    expect(attached.seen).toContain('/nodeui/api/config');

    const off = await makeApp({ enabled: false });
    expect((await off.get('/x')).status).toBe(200);
    expect(off.seen).toContain('/x');
  });
});
