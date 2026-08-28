import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeUI, type NodeUIOptions, type NodeUIServer } from '../src/server';

async function withServer(
  options: NodeUIOptions,
  fn: (base: string, server: NodeUIServer, httpServer: Server) => Promise<void>,
): Promise<void> {
  const server = createNodeUI(options);
  const httpServer = createServer((req, res) => {
    server.middleware()(req, res, () => {
      if (req.url === '/hello') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ hello: 'world' }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await fn(base, server, httpServer);
  } finally {
    server.shutdown();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

describe('nodeui e2e', () => {
  it('fails closed in production while the host app keeps working', async () => {
    await withServer({ env: { NODE_ENV: 'production' } }, async (base, server) => {
      expect(server.active).toBe(false);
      const consoleRes = await fetch(base + '/nodeui/api/config');
      expect(consoleRes.status).toBe(404);
      const appRes = await fetch(base + '/hello');
      expect(appRes.status).toBe(200);
      expect(await appRes.json()).toEqual({ hello: 'world' });
    });
  });

  it('activates in production when NODEUI_ENABLED=true', async () => {
    await withServer(
      { env: { NODE_ENV: 'production', NODEUI_ENABLED: 'true' } },
      async (base, server) => {
        expect(server.active).toBe(true);
        const res = await fetch(base + '/nodeui/api/config');
        expect(res.status).toBe(200);
      },
    );
  });

  it('runs the full heap snapshot mutation flow with nonce confirmation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nodeui-e2e-heap-'));
    await withServer({ heapSnapshotDir: dir }, async (base) => {
      const issued = await fetch(base + '/nodeui/api/confirmations', { method: 'POST' });
      const { data } = (await issued.json()) as { data: { nonce: string } };

      const taken = await fetch(base + '/nodeui/api/heap-snapshot', {
        method: 'POST',
        headers: { 'x-nodeui-confirm': data.nonce },
      });
      expect(taken.status).toBe(200);
      const takenBody = (await taken.json()) as { data: { fileName: string; filePath: string } };
      expect(existsSync(takenBody.data.filePath)).toBe(true);
      expect(takenBody.data.fileName).toMatch(/^nodeui-heap-/);

      const panel = await fetch(base + '/nodeui/api/heap-snapshot');
      const panelBody = (await panel.json()) as { data: { lastSnapshot: { fileName: string } } };
      expect(panelBody.data.lastSnapshot.fileName).toBe(takenBody.data.fileName);
    });
  });

  it('rejects a replayed confirmation nonce', async () => {
    await withServer({}, async (base) => {
      const issued = await fetch(base + '/nodeui/api/confirmations', { method: 'POST' });
      const { data } = (await issued.json()) as { data: { nonce: string } };
      await fetch(base + '/nodeui/api/heap-snapshot', {
        method: 'POST',
        headers: { 'x-nodeui-confirm': data.nonce },
      });
      const replay = await fetch(base + '/nodeui/api/heap-snapshot', {
        method: 'POST',
        headers: { 'x-nodeui-confirm': data.nonce },
      });
      expect(replay.status).toBe(409);
    });
  });

  it('logs app requests but not nodeui API traffic', async () => {
    await withServer({}, async (base) => {
      await fetch(base + '/hello');
      await fetch(base + '/nodeui/api/config');
      await fetch(base + '/hello');
      const res = await fetch(base + '/nodeui/api/requests');
      const body = (await res.json()) as {
        data: { total: number; entries: Array<{ path: string }> };
      };
      expect(body.data.total).toBe(2);
      expect(body.data.entries.map((e) => e.path)).toEqual(['/hello', '/hello']);
    });
  });

  it('starts sampling lazily and stops after inactivity', async () => {
    const inactivityTimeoutMs = 80;
    await withServer({ inactivityTimeoutMs, pollIntervalMs: 10 }, async (base, server) => {
      expect(server.isProviderActive('memory')).toBe(false);

      await fetch(base + '/nodeui/api/memory');
      expect(server.isProviderActive('memory')).toBe(true);

      await new Promise((r) => setTimeout(r, inactivityTimeoutMs + 40));
      expect(server.isProviderActive('memory')).toBe(false);

      await fetch(base + '/nodeui/api/memory');
      expect(server.isProviderActive('memory')).toBe(true);
    });
  });
});
