import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { normalizeReplayRequest, ReplayError } from '../src/replay';
import { createNodeUI, type NodeUIServer } from '../src/server';

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
}

async function withApp(
  fn: (base: string, server: NodeUIServer, seen: Seen[], http: Server) => Promise<void>,
): Promise<void> {
  const server = createNodeUI({});
  const seen: Seen[] = [];
  const httpServer = createServer((req, res) => {
    server.middleware()(req, res, () => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ echoed: Buffer.concat(chunks).toString('utf8') }));
      });
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  try {
    await fn(base, server, seen, httpServer);
  } finally {
    server.shutdown();
    httpServer.closeAllConnections?.();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

async function nonce(base: string): Promise<string> {
  const res = await fetch(base + '/nodeui/api/confirmations', { method: 'POST' });
  return ((await res.json()) as { data: { nonce: string } }).data.nonce;
}

function post(base: string, body: unknown, confirm?: string): Promise<Response> {
  return fetch(base + '/nodeui/api/replay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(confirm ? { 'x-nodeui-confirm': confirm } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('replay input validation', () => {
  it('accepts well-formed requests and normalises them', () => {
    const r = normalizeReplayRequest({
      method: 'post',
      path: '/a?b=1',
      headers: {
        'X-Test': '1',
        Host: 'evil.test',
        'Content-Length': '5',
        Authorization: '[REDACTED]',
      },
      body: 'x',
    });
    expect(r.method).toBe('POST');
    expect(r.headers).toEqual({ 'x-test': '1' });
  });

  it.each([
    [{ path: '//evil.test/x' }],
    [{ path: 'http://evil.test/' }],
    [{ path: '/with space' }],
    [{ path: '/ok', method: 'TRACE' }],
    [{ path: '/ok', headers: { 'x-a': 'a\r\nInjected: 1' } }],
  ])('rejects %j', (input) => {
    expect(() => normalizeReplayRequest(input)).toThrow(ReplayError);
  });
});

describe('POST /api/replay', () => {
  it('needs a confirmation nonce', async () => {
    await withApp(async (base) => {
      await fetch(base + '/seed');
      const res = await post(base, { method: 'GET', path: '/seed' });
      expect(res.status).toBe(409);
    });
  });

  it('refuses until the app address is known', async () => {
    await withApp(async (base) => {
      const res = await post(base, { method: 'GET', path: '/x' }, await nonce(base));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('no-target');
    });
  });

  it('re-sends an edited request to the app and returns its response', async () => {
    await withApp(async (base, _server, seen) => {
      await fetch(base + '/seed');
      const res = await post(
        base,
        {
          method: 'POST',
          path: '/orders?x=1',
          headers: { 'content-type': 'text/plain', 'x-custom': 'yes' },
          body: 'hello',
        },
        await nonce(base),
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as {
        data: { status: number; body: string; durationMs: number; binary: boolean };
      };
      expect(data.status).toBe(201);
      expect(JSON.parse(data.body)).toEqual({ echoed: 'hello' });
      expect(data.binary).toBe(false);
      const replayed = seen.find((s) => s.url === '/orders?x=1');
      expect(replayed?.method).toBe('POST');
      expect(replayed?.headers['x-custom']).toBe('yes');
      expect(replayed?.headers['x-nodeui-replay']).toBe('1');
      expect(replayed?.body).toBe('hello');

      // The replay goes through the app, so it shows up in the Requests log too.
      const log = (await (await fetch(base + '/nodeui/api/requests')).json()) as {
        data: { entries: Array<{ path: string }> };
      };
      expect(log.data.entries.some((e) => e.path === '/orders')).toBe(true);
    });
  });

  it('rejects an invalid path before consuming the nonce', async () => {
    await withApp(async (base) => {
      await fetch(base + '/seed');
      const n = await nonce(base);
      const bad = await post(base, { method: 'GET', path: '//evil.test' }, n);
      expect(bad.status).toBe(400);
      const ok = await post(base, { method: 'GET', path: '/seed' }, n);
      expect(ok.status).toBe(200);
    });
  });
});
