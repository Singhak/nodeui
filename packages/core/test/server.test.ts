import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createNodeUI,
  serializeEnvelope,
  type NodeUIOptions,
  type NodeUIServer,
} from '../src/server';
import type { PanelId } from '../src/types';

const ALL_PANELS: PanelId[] = [
  'health',
  'memory',
  'cpu',
  'event-loop',
  'heap-snapshot',
  'startup',
  'requests',
  'env',
  'routes',
  'logs',
  'metrics',
];

interface TestContext {
  base: string;
  server: NodeUIServer;
  httpServer: Server;
}

async function withServer(
  options: NodeUIOptions,
  fn: (ctx: TestContext) => Promise<void>,
): Promise<void> {
  const server = createNodeUI({ env: { NODE_ENV: 'development' }, ...options });
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
  const ctx: TestContext = { base: `http://127.0.0.1:${address.port}`, server, httpServer };
  try {
    await fn(ctx);
  } finally {
    server.shutdown();
    httpServer.closeAllConnections?.();
    httpServer.closeIdleConnections?.();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

async function getJson(base: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
}

describe('createNodeUI server', () => {
  it('serves the config envelope with activation metadata', async () => {
    await withServer({}, async ({ base }) => {
      const { status, body } = await getJson(base, '/nodeui/api/config');
      expect(status).toBe(200);
      const envelope = body as { ok: boolean; data: { enabled: boolean; path: string } };
      expect(envelope.ok).toBe(true);
      expect(envelope.data.enabled).toBe(true);
      expect(envelope.data.path).toBe('/nodeui');
    });
  });

  it.each(ALL_PANELS.filter((p) => p !== 'routes'))(
    'serves the %s panel with a successful envelope',
    async (panel) => {
      await withServer({}, async ({ base }) => {
        const { status, body } = await getJson(base, `/nodeui/api/${panel}`);
        expect(status).toBe(200);
        const envelope = body as { ok: boolean; data: unknown };
        expect(envelope.ok).toBe(true);
        expect(envelope.data).toBeDefined();
      });
    },
  );

  it('reports activation reason from NODE_ENV', async () => {
    await withServer({}, async ({ base }) => {
      const { body } = await getJson(base, '/nodeui/api/config');
      const envelope = body as { data: { activationReason: string } };
      expect(envelope.data.activationReason).toContain('NODE_ENV');
    });
  });

  it('fails closed in production when not explicitly enabled', async () => {
    await withServer({ env: { NODE_ENV: 'production' } }, async ({ base, server }) => {
      expect(server.active).toBe(false);
      const res = await fetch(base + '/nodeui/api/config');
      expect(res.status).toBe(404);
    });
  });

  it('stays active in production when NODEUI_ENABLED=true', async () => {
    await withServer(
      { env: { NODE_ENV: 'production', NODEUI_ENABLED: 'true' } },
      async ({ base, server }) => {
        expect(server.active).toBe(true);
        const { status } = await getJson(base, '/nodeui/api/config');
        expect(status).toBe(200);
      },
    );
  });

  it('returns 404 envelope for unknown API routes', async () => {
    await withServer({}, async ({ base }) => {
      const { status, body } = await getJson(base, '/nodeui/api/nope');
      expect(status).toBe(404);
      const envelope = body as { ok: boolean; error: { code: string } };
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe('not-found');
    });
  });

  it('requires a confirmation nonce for heap snapshots', async () => {
    await withServer(
      { heapSnapshotDir: mkdtempSync(join(tmpdir(), 'nodeui-srv-heap-')) },
      async ({ base }) => {
        const denied = await fetch(base + '/nodeui/api/heap-snapshot', { method: 'POST' });
        expect(denied.status).toBe(409);
        const deniedBody = (await denied.json()) as { ok: boolean; error: { code: string } };
        expect(deniedBody.ok).toBe(false);
        expect(deniedBody.error.code).toBe('confirmation-required');

        const issued = await fetch(base + '/nodeui/api/confirmations', { method: 'POST' });
        expect(issued.status).toBe(200);
        const issuedBody = (await issued.json()) as { ok: boolean; data: { nonce: string } };
        expect(issuedBody.ok).toBe(true);
        expect(issuedBody.data.nonce).toHaveLength(32);

        const taken = await fetch(base + '/nodeui/api/heap-snapshot', {
          method: 'POST',
          headers: { 'x-nodeui-confirm': issuedBody.data.nonce },
        });
        expect(taken.status).toBe(200);
        const takenBody = (await taken.json()) as { ok: boolean; data: { fileName: string } };
        expect(takenBody.ok).toBe(true);
        expect(takenBody.data.fileName).toMatch(/^nodeui-heap-/);

        const panel = await getJson(base, '/nodeui/api/heap-snapshot');
        const panelBody = panel.body as { data: { lastSnapshot: { fileName: string } } };
        expect(panelBody.data.lastSnapshot.fileName).toBe(takenBody.data.fileName);
      },
    );
  });

  it('consumes a nonce only once', async () => {
    await withServer({}, async ({ base }) => {
      const issued = await fetch(base + '/nodeui/api/confirmations', { method: 'POST' });
      const issuedBody = (await issued.json()) as { ok: boolean; data: { nonce: string } };
      await fetch(base + '/nodeui/api/heap-snapshot', {
        method: 'POST',
        headers: { 'x-nodeui-confirm': issuedBody.data.nonce },
      });
      const second = await fetch(base + '/nodeui/api/heap-snapshot', {
        method: 'POST',
        headers: { 'x-nodeui-confirm': issuedBody.data.nonce },
      });
      expect(second.status).toBe(409);
    });
  });

  it('rejects non-loopback requests when bound to loopback', async () => {
    const server = createNodeUI({ env: { NODE_ENV: 'development' } });
    const req = {
      method: 'GET',
      url: '/nodeui/api/config',
      socket: { remoteAddress: '203.0.113.7' },
      headers: {},
    } as unknown as IncomingMessage;
    const res = {
      status: 0,
      body: '',
      writeHead(status: number) {
        this.status = status;
        return this;
      },
      end(body: string) {
        this.body = body;
        return this;
      },
    } as unknown as ServerResponse & { status: number; body: string };

    await server.handle(req, res);
    expect(res.status).toBe(403);
    const parsed = JSON.parse(res.body) as { ok: boolean; error: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('forbidden');
    server.shutdown();
  });

  it('records app requests in the request log but not its own API calls', async () => {
    await withServer({}, async ({ base }) => {
      await fetch(base + '/hello');
      await fetch(base + '/hello');
      const { body } = await getJson(base, '/nodeui/api/requests');
      const data = body as {
        data: { total: number; entries: Array<{ path: string; status: number }> };
      };
      expect(data.data.total).toBe(2);
      expect(data.data.entries.map((e) => e.path)).toEqual(['/hello', '/hello']);
      expect(data.data.entries.every((e) => e.status === 200)).toBe(true);
    });
  });

  it('serves the static console with an HTML index', async () => {
    await withServer({}, async ({ base }) => {
      const res = await fetch(base + '/nodeui/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<div id="root"></div>');
    });
  });

  it('records bootstrap marks via server.mark()', async () => {
    await withServer({}, async ({ base, server }) => {
      server.mark('listening');
      const { body } = await getJson(base, '/nodeui/api/startup');
      const data = body as { data: { marks: Array<{ name: string }> } };
      expect(data.data.marks.map((m) => m.name)).toEqual(['nodeui.init', 'listening']);
    });
  });

  it('respects a custom path prefix', async () => {
    await withServer({ path: '/console' }, async ({ base }) => {
      const { status, body } = await getJson(base, '/console/api/config');
      expect(status).toBe(200);
      const envelope = body as { data: { path: string } };
      expect(envelope.data.path).toBe('/console');
    });
  });

  it('streams panel envelopes over SSE', async () => {
    await withServer({ pollIntervalMs: 50 }, async ({ base }) => {
      const controller = new AbortController();
      const res = await fetch(base + '/nodeui/api/live?panels=health', {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body?.getReader();
      const { value } = (await reader?.read()) ?? { value: undefined };
      const text = new TextDecoder().decode(value);
      expect(text).toContain('data:');
      expect(text).toContain('"panel":"health"');
      controller.abort();
    });
  });
});

describe('routes panel', () => {
  it('reports router-unavailable when no express app was captured', async () => {
    await withServer({}, async ({ base }) => {
      const { status, body } = await getJson(base, '/nodeui/api/routes');
      expect(status).toBe(500);
      const envelope = body as { ok: boolean; error: { code: string } };
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe('router-unavailable');
    });
  });

  it('lists routes when an express app is captured', async () => {
    const server = createNodeUI({ env: { NODE_ENV: 'development' } });
    const fakeRouter = {
      stack: [
        {
          name: 'bound dispatch',
          route: {
            path: '/hello',
            methods: { get: true },
            stack: [{ handle: { name: 'helloHandler' } }],
          },
        },
      ],
    };
    const req = {
      method: 'GET',
      url: '/nodeui/api/routes',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
      app: { _router: fakeRouter },
    } as unknown as IncomingMessage;
    const res = {
      status: 0,
      body: '',
      writeHead(status: number) {
        this.status = status;
        return this;
      },
      end(body: string) {
        this.body = body;
        return this;
      },
    } as unknown as ServerResponse & { status: number; body: string };

    await server.handle(req, res);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as {
      ok: boolean;
      data: { routes: Array<{ path: string }> };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.routes).toEqual([
      { method: 'GET', path: '/hello', handler: 'helloHandler' },
    ]);
    server.shutdown();
  });

  it('captures the router from express 5 app.router', async () => {
    const server = createNodeUI({ env: { NODE_ENV: 'development' } });
    const fakeRouter = {
      stack: [
        {
          name: 'bound dispatch',
          route: {
            path: '/v1',
            methods: { get: true },
            stack: [{ handle: { name: 'v1Handler' } }],
          },
        },
      ],
    };
    const req = {
      method: 'GET',
      url: '/nodeui/api/routes',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
      app: { router: fakeRouter },
    } as unknown as IncomingMessage;
    const res = {
      status: 0,
      body: '',
      writeHead(status: number) {
        this.status = status;
        return this;
      },
      end(body: string) {
        this.body = body;
        return this;
      },
    } as unknown as ServerResponse & { status: number; body: string };

    await server.handle(req, res);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as {
      ok: boolean;
      data: { routes: Array<{ path: string }> };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.routes).toEqual([{ method: 'GET', path: '/v1', handler: 'v1Handler' }]);
    server.shutdown();
  });
});

describe('new phase-1 panel routes', () => {
  it('serves env, routes, logs, and metrics panels', async () => {
    await withServer({ env: { NODE_ENV: 'development', DEMO_VAR: 'x' } }, async ({ base }) => {
      const env = await getJson(base, '/nodeui/api/env');
      expect(env.status).toBe(200);
      const envData = env.body as {
        data: { environment: Array<{ key: string }>; config: unknown };
      };
      expect(envData.data.environment.some((e) => e.key === 'DEMO_VAR')).toBe(true);

      const routes = await getJson(base, '/nodeui/api/routes');
      expect(routes.status).toBe(500);
      const routesBody = routes.body as { ok: boolean; error: { code: string } };
      expect(routesBody.ok).toBe(false);
      expect(routesBody.error.code).toBe('router-unavailable');

      const logs = await getJson(base, '/nodeui/api/logs');
      expect(logs.status).toBe(200);
      const logsData = logs.body as { data: { entries: unknown[] } };
      expect(Array.isArray(logsData.data.entries)).toBe(true);

      const metrics = await getJson(base, '/nodeui/api/metrics');
      expect(metrics.status).toBe(200);
      const metricsData = metrics.body as { data: { buckets: unknown[] } };
      expect(metricsData.data.buckets).toHaveLength(60);
    });
  });

  it('filters logs via query params and applies app config', async () => {
    await withServer(
      { env: { NODE_ENV: 'development' }, config: { app: 'demo', PORT: 3000 } },
      async ({ base }) => {
        const logs = await getJson(base, '/nodeui/api/logs?level=info');
        expect(logs.status).toBe(200);
        const env = await getJson(base, '/nodeui/api/env');
        const envData = env.body as { data: { config: Array<{ key: string; value: string }> } };
        expect(envData.data.config).toContainEqual({ key: 'app', value: 'demo' });
      },
    );
  });

  it('exposes the log size in the config envelope', async () => {
    await withServer({ logSize: 123 }, async ({ base }) => {
      const { body } = await getJson(base, '/nodeui/api/config');
      const data = body as { data: { logSize: number } };
      expect(data.data.logSize).toBe(123);
    });
  });
});

describe('serializeEnvelope', () => {
  it('masks secret-shaped keys before serialization', () => {
    const json = serializeEnvelope({
      ok: true,
      data: { apiKey: 'supersecret', nested: { PASSWORD: 'hunter2' }, ok: true },
    });
    expect(json).not.toContain('supersecret');
    expect(json).not.toContain('hunter2');
    expect(json).toContain('[REDACTED]');
  });
});
