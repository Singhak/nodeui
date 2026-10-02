/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON-RPC assertions */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { createNodeUI, type NodeUIServer } from '@singhak/nodeui-core';
import { afterEach, describe, expect, it } from 'vitest';
import { serveMcp } from '../src/mcp';

const servers: Server[] = [];
const uis: NodeUIServer[] = [];

async function service(): Promise<{
  ui: NodeUIServer;
  base: string;
  hit(p: string): Promise<void>;
}> {
  const ui = createNodeUI({ enabled: true });
  uis.push(ui);
  const mw = ui.middleware();
  const app = createServer((req, res) =>
    mw(req, res, () => {
      if (req.url === '/boom') {
        ui.recordError(new Error('db exploded for user 42'));
        res.writeHead(500).end('x');
        return;
      }
      res.writeHead(200).end('ok');
    }),
  );
  servers.push(app);
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  const port = (app.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/nodeui`;
  return {
    ui,
    base,
    hit: async (p) => {
      await (await fetch(`http://127.0.0.1:${port}${p}`)).text();
    },
  };
}

function client(services: Array<{ name: string; base: string }>) {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: any[] = [];
  const waiters: Array<(m: any) => void> = [];
  let buf = '';
  output.on('data', (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      const w = waiters.shift();
      if (w) w(msg);
      else lines.push(msg);
    }
  });
  const next = (): Promise<any> =>
    lines.length > 0 ? Promise.resolve(lines.shift()) : new Promise((r) => waiters.push(r));
  const server = serveMcp({ services, input, output });
  let id = 0;
  return {
    server,
    async rpc(method: string, params?: object): Promise<any> {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })}\n`);
      return next();
    },
    notify(method: string) {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    },
    end() {
      input.end();
      return server.done;
    },
  };
}

afterEach(async () => {
  for (const ui of uis.splice(0)) ui.shutdown();
  for (const s of servers.splice(0)) {
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

describe('mcp server', () => {
  it('handshakes and lists read-only tools', async () => {
    const a = await service();
    const c = client([{ name: 'api', base: a.base }]);
    const init = await c.rpc('initialize', { protocolVersion: '2024-11-05' });
    expect(init.result.protocolVersion).toBe('2024-11-05');
    expect(init.result.capabilities.tools).toBeDefined();
    c.notify('notifications/initialized');
    const list = await c.rpc('tools/list');
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'nodeui_overview',
        'nodeui_errors',
        'nodeui_request',
        'nodeui_queries',
      ]),
    );
    expect(list.result.tools.every((t: any) => t.annotations.readOnlyHint)).toBe(true);
    expect(names.some((n: string) => /heap|snapshot|confirm/.test(n))).toBe(false);
    expect((await c.rpc('ping')).result).toEqual({});
    expect((await c.rpc('nope')).error.code).toBe(-32601);
    await c.end();
  });

  it('digests problems and joins a request to its errors', async () => {
    const a = await service();
    await a.hit('/ok');
    await a.hit('/boom');
    const c = client([{ name: 'api', base: a.base }]);
    await c.rpc('initialize');
    const overview = await c.rpc('tools/call', { name: 'nodeui_overview', arguments: {} });
    const text: string = overview.result.content[0].text;
    expect(text).toContain('# api');
    expect(text).toContain('db exploded for user 42');
    expect(text).toContain('/boom');

    const reqs = await c.rpc('tools/call', {
      name: 'nodeui_requests',
      arguments: { minStatus: 500 },
    });
    const parsed = JSON.parse(reqs.result.content[0].text);
    expect(parsed.entries).toHaveLength(1);
    const one = await c.rpc('tools/call', {
      name: 'nodeui_request',
      arguments: { id: parsed.entries[0].id },
    });
    expect(JSON.parse(one.result.content[0].text).request.path).toBe('/boom');

    const missing = await c.rpc('tools/call', { name: 'nodeui_request', arguments: { id: 9999 } });
    expect(missing.result.isError).toBe(true);
    await c.end();
  });

  it('needs a service name when several are configured, and reports unreachable ones', async () => {
    const a = await service();
    const c = client([
      { name: 'api', base: a.base },
      { name: 'down', base: 'http://127.0.0.1:1/nodeui' },
    ]);
    await c.rpc('initialize');
    const noName = await c.rpc('tools/call', { name: 'nodeui_errors', arguments: {} });
    expect(noName.result.isError).toBe(true);
    expect(noName.result.content[0].text).toContain('api, down');
    const down = await c.rpc('tools/call', {
      name: 'nodeui_errors',
      arguments: { service: 'down' },
    });
    expect(down.result.isError).toBe(true);
    expect(down.result.content[0].text).toContain('cannot reach down');
    const ok = await c.rpc('tools/call', { name: 'nodeui_errors', arguments: { service: 'api' } });
    expect(ok.result.isError).toBeUndefined();
    await c.end();
  });
});
