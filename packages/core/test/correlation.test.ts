import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createNodeUI } from '../src/server';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
}

describe('request correlation', () => {
  it('attributes outgoing calls and logs to the originating request', async () => {
    const upstream = createServer((_req, res) => res.writeHead(200).end('ok'));
    const upstreamBase = await listen(upstream);
    const nodeui = createNodeUI({ env: { NODE_ENV: 'development' } });
    const app = createServer((req, res) => {
      nodeui.middleware()(req, res, () => {
        void (async () => {
          await new Promise((r) => setTimeout(r, 5));
          console.log(`handling ${req.url}`);
          await fetch(upstreamBase + '/dep');
          res.writeHead(200).end('done');
        })();
      });
    });
    const base = await listen(app);
    try {
      // Activate the lazy outgoing + logs providers.
      await fetch(base + '/nodeui/api/outgoing');
      await fetch(base + '/nodeui/api/logs');
      await Promise.all([fetch(base + '/a'), fetch(base + '/b')]);
      await new Promise((r) => setTimeout(r, 30));

      const get = async (p: string) =>
        (await (await fetch(base + p)).json()) as { data: { entries: unknown[] } };
      const requests = (await get('/nodeui/api/requests')).data.entries as Array<{
        id: number;
        path: string;
      }>;
      const outgoing = (await get('/nodeui/api/outgoing')).data.entries as Array<{
        requestId?: number;
      }>;
      const logs = (await get('/nodeui/api/logs')).data.entries as Array<{
        message: string;
        requestId?: number;
      }>;
      for (const path of ['/a', '/b']) {
        const id = requests.find((r) => r.path === path)?.id;
        expect(id).toBeDefined();
        expect(outgoing.filter((o) => o.requestId === id)).toHaveLength(1);
        expect(logs.find((l) => l.message === `handling ${path}`)?.requestId).toBe(id);
      }
    } finally {
      nodeui.shutdown();
      app.closeAllConnections?.();
      upstream.closeAllConnections?.();
      await new Promise<void>((r) => app.close(() => r()));
      await new Promise<void>((r) => upstream.close(() => r()));
    }
  });
});
