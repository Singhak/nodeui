import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createNodeUI, serializeEnvelope, type NodeUIOptions } from '../src/server';
import { OutgoingProvider } from '../src/providers/outgoing';
import {
  hostnameFromHostHeader,
  maskSecrets,
  maskSecretText,
  matchesAddress,
  SECRET_KEY_PATTERN,
} from '../src/safety';
import type { NodeUIProvider } from '../src/types';

interface Ctx {
  base: string;
  port: number;
}

async function withServer(options: NodeUIOptions, fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const server = createNodeUI({ env: { NODE_ENV: 'development' }, ...options });
  const http: Server = createServer((req, res) => {
    server.middleware()(req, res, () => {
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as AddressInfo).port;
  try {
    await fn({ base: `http://127.0.0.1:${port}`, port });
  } finally {
    server.shutdown();
    http.closeAllConnections?.();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
}

/** `fetch` cannot override Host, so use node:http for header-spoofing tests. */
function rawGet(
  port: number,
  path: string,
  headers: Record<string, string>,
  method = 'GET',
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('secret masking', () => {
  it('masks auth-style keys the old pattern missed', () => {
    for (const key of ['AUTHORIZATION', 'AUTH_HEADER', 'Cookie', 'DATABASE_URL', 'SENTRY_DSN']) {
      expect(key).toMatch(SECRET_KEY_PATTERN);
    }
    expect('PWD').not.toMatch(SECRET_KEY_PATTERN);
    expect('NODE_ENV').not.toMatch(SECRET_KEY_PATTERN);
  });

  it('scrubs credentials embedded in text', () => {
    expect(maskSecretText('connecting to postgres://app:s3cr3t@db:5432/x')).toBe(
      'connecting to postgres://app:[REDACTED]@db:5432/x',
    );
    expect(maskSecretText('header Authorization: Bearer abc.def.ghi')).not.toContain('abc.def');
    expect(maskSecretText('login failed password=hunter2 user=bob')).toBe(
      'login failed password=[REDACTED] user=bob',
    );
    expect(maskSecretText('{"apiToken":"xyz123","ok":true}')).not.toContain('xyz123');
    expect(maskSecretText('plain message')).toBe('plain message');
  });

  it('masks log text inside payloads', () => {
    const out = maskSecrets({ entries: [{ level: 'info', message: 'token=abc123 ready' }] });
    expect(JSON.stringify(out)).not.toContain('abc123');
  });

  it('serializeEnvelope can skip masking', () => {
    const json = serializeEnvelope({ ok: true, data: { token: 'visible' } }, false);
    expect(json).toContain('visible');
  });

  it('honours maskSecrets:false end to end and masks by default', async () => {
    const env = { NODE_ENV: 'development', MY_SECRET: 'topsecretvalue' };
    await withServer({ env }, async ({ base }) => {
      const text = await (await fetch(`${base}/nodeui/api/env`)).text();
      expect(text).not.toContain('topsecretvalue');
    });
    await withServer({ env, maskSecrets: false }, async ({ base }) => {
      const text = await (await fetch(`${base}/nodeui/api/env`)).text();
      expect(text).toContain('topsecretvalue');
    });
  });

  it('masks secrets in the live SSE stream', async () => {
    const env = { NODE_ENV: 'development', MY_SECRET: 'ssevalue99' };
    await withServer({ env, pollIntervalMs: 50 }, async ({ base }) => {
      const controller = new AbortController();
      const res = await fetch(`${base}/nodeui/api/live?panels=env`, { signal: controller.signal });
      const reader = res.body?.getReader();
      const { value } = (await reader?.read()) ?? { value: undefined };
      const text = new TextDecoder().decode(value);
      expect(text).toContain('"panel":"env"');
      expect(text).not.toContain('ssevalue99');
      controller.abort();
    });
  });
});

describe('address helpers', () => {
  it('matches exact IPs and IPv4 CIDRs', () => {
    expect(matchesAddress('172.17.0.1', ['172.16.0.0/12'])).toBe(true);
    expect(matchesAddress('::ffff:172.17.0.1', ['172.17.0.1'])).toBe(true);
    expect(matchesAddress('10.1.2.3', ['172.16.0.0/12'])).toBe(false);
    expect(matchesAddress(undefined, ['0.0.0.0/0'])).toBe(false);
  });

  it('parses Host headers', () => {
    expect(hostnameFromHostHeader('LocalHost:3000')).toBe('localhost');
    expect(hostnameFromHostHeader('[::1]:3000')).toBe('::1');
    expect(hostnameFromHostHeader(undefined)).toBeNull();
  });
});

describe('request guard', () => {
  it('rejects a DNS-rebinding Host header', async () => {
    await withServer({}, async ({ port }) => {
      const bad = await rawGet(port, '/nodeui/api/config', { Host: 'evil.example.com' });
      expect(bad.status).toBe(403);
      const good = await rawGet(port, '/nodeui/api/config', { Host: `localhost:${port}` });
      expect(good.status).toBe(200);
    });
  });

  it('accepts extra hosts via allowedHosts', async () => {
    await withServer({ allowedHosts: ['dev.myapp.test'] }, async ({ port }) => {
      const res = await rawGet(port, '/nodeui/api/config', { Host: 'dev.myapp.test' });
      expect(res.status).toBe(200);
    });
  });

  it('rejects cross-origin requests and accepts same-origin', async () => {
    await withServer({}, async ({ port }) => {
      const cross = await rawGet(
        port,
        '/nodeui/api/confirmations',
        { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example.com' },
        'POST',
      );
      expect(cross.status).toBe(403);
      const same = await rawGet(
        port,
        '/nodeui/api/confirmations',
        { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` },
        'POST',
      );
      expect(same.status).toBe(200);
    });
  });

  it('rejects forwarded (proxied) requests unless trustProxy is set', async () => {
    await withServer({}, async ({ port }) => {
      const res = await rawGet(port, '/nodeui/api/config', { 'X-Forwarded-For': '203.0.113.9' });
      expect(res.status).toBe(403);
    });
    await withServer({ trustProxy: true }, async ({ port }) => {
      const res = await rawGet(port, '/nodeui/api/config', { 'X-Forwarded-For': '203.0.113.9' });
      expect(res.status).toBe(200);
    });
  });

  it('sets security headers on API and static responses', async () => {
    await withServer({}, async ({ port }) => {
      const api = await rawGet(port, '/nodeui/api/config', {});
      expect(api.headers['x-content-type-options']).toBe('nosniff');
      expect(api.headers['x-frame-options']).toBe('DENY');
      const page = await rawGet(port, '/nodeui/', {});
      expect(String(page.headers['content-security-policy'])).toContain("default-src 'self'");
    });
  });

  it('requires a token when configured, and trades ?token= for a cookie', async () => {
    await withServer({ authToken: 'letmein' }, async ({ port }) => {
      const anon = await rawGet(port, '/nodeui/api/config', {});
      expect(anon.status).toBe(401);

      const bearer = await rawGet(port, '/nodeui/api/config', { Authorization: 'Bearer letmein' });
      expect(bearer.status).toBe(200);

      const wrong = await rawGet(port, '/nodeui/api/config', { Authorization: 'Bearer nope' });
      expect(wrong.status).toBe(401);

      const login = await rawGet(port, '/nodeui/?token=letmein', {});
      expect(login.status).toBe(302);
      const cookie = String(login.headers['set-cookie']);
      expect(cookie).toContain('nodeui_token=letmein');
      expect(cookie).toContain('HttpOnly');

      const viaCookie = await rawGet(port, '/nodeui/api/config', {
        Cookie: 'nodeui_token=letmein',
      });
      expect(viaCookie.status).toBe(200);
    });
  });

  it('applies the token to the live stream as well', async () => {
    await withServer({ authToken: 'letmein' }, async ({ port }) => {
      const res = await rawGet(port, '/nodeui/api/live', {});
      expect(res.status).toBe(401);
    });
  });
});

describe('sse limits and provider failures', () => {
  it('caps concurrent live streams', async () => {
    await withServer({ maxSseClients: 1, pollIntervalMs: 1000 }, async ({ base }) => {
      const a = new AbortController();
      const first = await fetch(`${base}/nodeui/api/live?panels=startup`, { signal: a.signal });
      expect(first.status).toBe(200);
      const second = await fetch(`${base}/nodeui/api/live?panels=startup`);
      expect(second.status).toBe(429);
      a.abort();
    });
  });

  it('turns a throwing provider into an error envelope instead of crashing', async () => {
    const bad: NodeUIProvider = {
      id: 'explodes',
      get: () => {
        throw new Error('boom');
      },
    };
    await withServer({ plugins: [bad], pollIntervalMs: 50 }, async ({ base }) => {
      const res = await fetch(`${base}/nodeui/api/explodes`);
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('provider-failed');
      expect(body.error.message).toBe('boom');

      const controller = new AbortController();
      const live = await fetch(`${base}/nodeui/api/live?panels=explodes`, {
        signal: controller.signal,
      });
      const { value } = (await live.body?.getReader().read()) ?? { value: undefined };
      expect(new TextDecoder().decode(value)).toContain('provider-failed');
      controller.abort();
    });
  });
});

describe('plugins', () => {
  const queues: NodeUIProvider<{ waiting: number }> = {
    id: 'queues',
    title: 'Queues',
    get: () => ({ ok: true, data: { waiting: 3 } }),
  };

  it('serves custom panels and lists them in config', async () => {
    await withServer({ plugins: [queues] }, async ({ base }) => {
      const panel = (await (await fetch(`${base}/nodeui/api/queues`)).json()) as {
        data: { waiting: number };
      };
      expect(panel.data.waiting).toBe(3);
      const config = (await (await fetch(`${base}/nodeui/api/config`)).json()) as {
        data: { plugins: Array<{ id: string; title: string }>; panels: string[] };
      };
      expect(config.data.plugins).toEqual([{ id: 'queues', title: 'Queues' }]);
      expect(config.data.panels).toContain('queues');
    });
  });

  it('rejects ids that collide with built-ins or are malformed', () => {
    const make = (id: string): NodeUIProvider => ({ id, get: () => ({ ok: true, data: 1 }) });
    expect(() => createNodeUI({ plugins: [make('health')] })).toThrow(/invalid or already taken/);
    expect(() => createNodeUI({ plugins: [make('Bad Id')] })).toThrow(/invalid or already taken/);
    expect(() => createNodeUI({ plugins: [make('config')] })).toThrow(/invalid or already taken/);
    expect(() => createNodeUI({ plugins: [make('a'), make('a')] })).toThrow(/already taken/);
  });
});

describe('setRoutes', () => {
  it('feeds the routes panel without an Express router', async () => {
    await withServer({}, async ({ base }) => {
      // route source is attached lazily via server API; use a fresh server here
      expect(base).toContain('127.0.0.1');
    });
    const server = createNodeUI({ env: { NODE_ENV: 'development' } });
    server.setRoutes([{ method: 'GET', path: '/x', handler: 'h' }]);
    const http = createServer((req, res) => void server.handle(req, res));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const port = (http.address() as AddressInfo).port;
    try {
      const body = (await (await fetch(`http://127.0.0.1:${port}/nodeui/api/routes`)).json()) as {
        data: { routes: unknown[] };
      };
      expect(body.data.routes).toEqual([{ method: 'GET', path: '/x', handler: 'h' }]);
    } finally {
      server.shutdown();
      http.closeAllConnections?.();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});

describe('outgoing http tracking', () => {
  it('records http.request and fetch calls while active and restores afterwards', async () => {
    const target = createServer((req, res) => {
      res.writeHead(req.url === '/fail' ? 503 : 200).end('x');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const port = (target.address() as AddressInfo).port;
    const provider = new OutgoingProvider(50);
    const originalRequest = (await import('node:http')).default.request;
    provider.start();
    try {
      await new Promise<void>((resolve, reject) => {
        const r = httpRequest(`http://127.0.0.1:${port}/a?secret=1`, (res) => {
          res.resume();
          res.on('end', resolve);
        });
        r.on('error', reject);
        r.end();
      });
      await fetch(`http://127.0.0.1:${port}/fail`);
      await new Promise((r) => setTimeout(r, 50));

      const result = provider.get();
      const entries = result.data.entries;
      expect(entries.length).toBeGreaterThanOrEqual(2);
      const viaHttp = entries.find((e) => e.url.endsWith('/a'));
      expect(viaHttp?.status).toBe(200);
      expect(viaHttp?.url).not.toContain('secret');
      const viaFetch = entries.find((e) => e.url.endsWith('/fail'));
      expect(viaFetch?.status).toBe(503);
      expect(result.data.failed).toBeGreaterThanOrEqual(1);
    } finally {
      provider.stop();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
    expect((await import('node:http')).default.request).toBe(originalRequest);
  });

  it('records connection errors', async () => {
    const provider = new OutgoingProvider(50);
    provider.start();
    try {
      await new Promise<void>((resolve) => {
        const r = httpRequest('http://127.0.0.1:1/none', () => resolve());
        r.on('error', () => resolve());
        r.end();
      });
      await new Promise((r) => setTimeout(r, 20));
      const entry = provider.get().data.entries[0];
      expect(entry?.status).toBeNull();
      expect(entry?.error).toBeTruthy();
    } finally {
      provider.stop();
    }
  });
});
