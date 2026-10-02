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

async function scenario(
  capture: 'always' | 'lazy' | undefined,
): Promise<{ outgoing: number; logs: number }> {
  const upstream = createServer((_req, res) => res.end('ok'));
  const upstreamBase = await listen(upstream);
  const nodeui = createNodeUI({
    env: { NODE_ENV: 'development' },
    ...(capture ? { capture } : {}),
  });
  const app = createServer((req, res) => {
    nodeui.middleware()(req, res, () => {
      void (async () => {
        console.log('before-panel-opened');
        await fetch(upstreamBase + '/dep');
        res.writeHead(200).end('done');
      })();
    });
  });
  const base = await listen(app);
  try {
    // Traffic happens BEFORE any panel is opened.
    await fetch(base + '/work');
    const get = async (p: string): Promise<{ data: { entries: Array<{ url?: string }> } }> =>
      (await fetch(base + p)).json() as Promise<{ data: { entries: Array<{ url?: string }> } }>;
    return {
      outgoing: (await get('/nodeui/api/outgoing')).data.entries.filter((e) =>
        e.url?.endsWith('/dep'),
      ).length,
      logs: (await get('/nodeui/api/logs')).data.entries.length,
    };
  } finally {
    nodeui.shutdown();
    app.close();
    upstream.close();
  }
}

describe('capture mode', () => {
  it("'always' (default) records activity from before a panel was opened", async () => {
    const result = await scenario(undefined);
    expect(result.outgoing).toBe(1);
    expect(result.logs).toBeGreaterThan(0);
  });

  it("'lazy' records nothing until a panel is opened", async () => {
    const result = await scenario('lazy');
    expect(result).toEqual({ outgoing: 0, logs: 0 });
  });

  it('restores console on shutdown', () => {
    const before = console.log;
    const nodeui = createNodeUI({ env: { NODE_ENV: 'development' } });
    expect(console.log).not.toBe(before);
    nodeui.shutdown();
    expect(console.log).toBe(before);
  });

  it('rejects an unknown capture value', () => {
    expect(() => createNodeUI({ env: { NODEUI_CAPTURE: 'sometimes' } })).toThrow(/capture/);
  });

  it('stays inert when the console is disabled', () => {
    const before = console.log;
    const nodeui = createNodeUI({ env: { NODE_ENV: 'production' } });
    expect(console.log).toBe(before);
    nodeui.shutdown();
  });
});
