import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { validateLoadTest } from '../src/providers/load-gen';
import { createNodeUI } from '../src/server';

describe('validateLoadTest', () => {
  it('applies defaults and normalises the request', () => {
    const c = validateLoadTest({ path: '/hello', method: 'get' });
    expect(c).toMatchObject({
      method: 'GET',
      path: '/hello',
      connections: 10,
      durationSec: 10,
      name: '',
    });
  });

  it.each([
    [{ path: '//evil.test' }, /path/],
    [{ path: '/x', method: 'TRACE' }, /method/i],
    [{ path: '/x', connections: 0 }, /connections/],
    [{ path: '/x', connections: 5000 }, /connections/],
    [{ path: '/x', durationSec: 0 }, /duration/],
    [{ path: '/x', durationSec: 3600 }, /duration/],
    [{ path: '/x', maxRequests: 0 }, /maxRequests/],
    [{ path: '/x', method: 'POST', body: 'x'.repeat(70_000) }, /64 kB/],
  ])('rejects %j', (input, message) => {
    expect(() => validateLoadTest(input)).toThrow(message);
  });
});

describe('load generator over HTTP', () => {
  it('needs a nonce, fires real load from a worker and saves a re-runnable run', async () => {
    let hits = 0;
    let marked = 0;
    const server = createNodeUI({});
    const http = createServer((req, res) => {
      server.middleware()(req, res, () => {
        if (req.url?.startsWith('/work')) {
          hits += 1;
          if (req.headers['x-nodeui-loadtest'] === '1') marked += 1;
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('ok');
          return;
        }
        res.end('ok');
      });
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/nodeui/api`;
    const root = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    try {
      const post = (path: string, body: unknown, nonce?: string) =>
        fetch(base + path, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(nonce ? { 'x-nodeui-confirm': nonce } : {}),
          },
          body: JSON.stringify(body),
        });
      const nonce = async () =>
        ((await (await post('/confirmations', {})).json()) as { data: { nonce: string } }).data
          .nonce;

      // unknown app address -> refused
      const early = await post(
        '/loadtest/start',
        { path: '/work', connections: 2, durationSec: 1 },
        await nonce(),
      );
      expect(early.status).toBe(400);
      expect(((await early.json()) as { error: { message: string } }).error.message).toMatch(
        /Send one first/,
      );

      await fetch(root + '/work'); // teach the server where the app listens
      const body = {
        path: '/work',
        connections: 4,
        durationSec: 1,
        maxRequests: 300,
        name: 'smoke',
      };
      expect((await post('/loadtest/start', body)).status).toBe(409); // no nonce
      const started = await post('/loadtest/start', body, await nonce());
      expect(started.status).toBe(200);
      expect((await post('/loadtest/start', body, await nonce())).status).toBe(400); // already running

      let status = {
        state: 'running',
        sent: 0,
        completed: 0,
        runId: undefined as number | undefined,
      };
      for (let i = 0; i < 60 && status.state === 'running'; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        status = ((await (await fetch(base + '/loadtest')).json()) as { data: typeof status }).data;
      }
      expect(status.state).toBe('done');
      expect(status.completed).toBe(300);
      expect(hits).toBeGreaterThanOrEqual(300);
      expect(marked).toBe(300);

      const runs = (await (await fetch(base + '/runs')).json()) as {
        data: {
          runs: Array<{
            id: number;
            name: string;
            summary: { requests: number };
            loadTest?: { path: string; connections: number };
          }>;
        };
      };
      const run = runs.data.runs.find((r) => r.id === status.runId);
      expect(run?.name).toBe('smoke');
      expect(run?.summary.requests).toBeGreaterThanOrEqual(300);
      expect(run?.loadTest).toMatchObject({ path: '/work', connections: 4 });
    } finally {
      server.shutdown();
      http.closeAllConnections?.();
      await new Promise<void>((r) => http.close(() => r()));
    }
  }, 15_000);

  it('can be stopped early and keeps the partial run', async () => {
    const server = createNodeUI({});
    const http = createServer((req, res) => {
      server.middleware()(req, res, () => {
        res.end('ok');
      });
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/nodeui/api`;
    try {
      await fetch(`http://127.0.0.1:${(http.address() as AddressInfo).port}/seed`);
      const issued = (await (await fetch(base + '/confirmations', { method: 'POST' })).json()) as {
        data: { nonce: string };
      };
      await fetch(base + '/loadtest/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nodeui-confirm': issued.data.nonce },
        body: JSON.stringify({ path: '/seed', connections: 2, durationSec: 30 }),
      });
      await new Promise((r) => setTimeout(r, 300));
      await fetch(base + '/loadtest/stop', { method: 'POST' });
      let state = 'running';
      for (let i = 0; i < 40 && state === 'running'; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        state = ((await (await fetch(base + '/loadtest')).json()) as { data: { state: string } })
          .data.state;
      }
      expect(state).toBe('done');
    } finally {
      server.shutdown();
      http.closeAllConnections?.();
      await new Promise<void>((r) => http.close(() => r()));
    }
  }, 15_000);
});
