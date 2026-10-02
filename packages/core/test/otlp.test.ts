import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { OtlpExporter, tracesUrl } from '../src/otlp';
import { createNodeUI } from '../src/server';

interface SpanJson {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  attributes: Array<{ key: string; value: Record<string, string> }>;
  status?: { code: number };
}

const listen = (server: Server): Promise<string> =>
  new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
const close = (server: Server): Promise<void> => {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
};
const attr = (span: SpanJson, key: string): string | undefined => {
  const a = span.attributes.find((x) => x.key === key);
  return a ? Object.values(a.value)[0] : undefined;
};

describe('tracesUrl', () => {
  it('appends /v1/traces to a base URL but keeps an explicit one', () => {
    expect(tracesUrl('http://localhost:4318')).toBe('http://localhost:4318/v1/traces');
    expect(tracesUrl('http://localhost:4318/')).toBe('http://localhost:4318/v1/traces');
    expect(tracesUrl('http://c/v1/traces')).toBe('http://c/v1/traces');
  });
});

describe('OTLP export', () => {
  it('exports linked request, outgoing and query spans without capturing its own calls', async () => {
    const bodies: Array<{
      resourceSpans: Array<{ resource: unknown; scopeSpans: Array<{ spans: SpanJson[] }> }>;
    }> = [];
    const collector = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (req.url === '/v1/traces') bodies.push(JSON.parse(raw));
        res.writeHead(200).end('{}');
      });
    });
    const collectorBase = await listen(collector);
    const upstream = createServer((_req, res) => res.writeHead(200).end('ok'));
    const upstreamBase = await listen(upstream);

    const nodeui = createNodeUI({
      env: { NODE_ENV: 'development' },
      otlp: { endpoint: collectorBase, serviceName: 'demo', intervalMs: 20 },
    });
    const mw = nodeui.middleware();
    const app = createServer((req, res) => {
      mw(req, res, () => {
        void (async () => {
          await fetch(`${upstreamBase}/dep?secret=1`);
          nodeui.recordQuery({
            system: 'pg',
            sql: "SELECT * FROM users WHERE token = 'abc'",
            durationMs: 2,
          });
          res.writeHead(200).end('done');
        })();
      });
    });
    const base = await listen(app);
    try {
      await fetch(`${base}/users/7`);
      await new Promise((r) => setTimeout(r, 200));

      const spans = bodies.flatMap((b) =>
        b.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)),
      );
      const server = spans.find((s) => s.kind === 2);
      const outgoing = spans.find((s) => s.name.startsWith('GET http://127.0.0.1') && s.kind === 3);
      const query = spans.find((s) => s.name.endsWith('pg'));
      expect(server && outgoing && query).toBeTruthy();
      expect(server?.name).toBe('GET /users/7');
      expect(outgoing?.traceId).toBe(server?.traceId);
      expect(outgoing?.parentSpanId).toBe(server?.spanId);
      expect(query?.parentSpanId).toBe(server?.spanId);
      expect(attr(query as SpanJson, 'db.query.text')).not.toContain('abc');
      expect(JSON.stringify(bodies[0]?.resourceSpans[0]?.resource)).toContain('demo');

      // the exporter's own POST must not show up as an outgoing call
      const list = (await (await fetch(`${base}/nodeui/api/outgoing`)).json()) as {
        data: { entries: Array<{ url: string }> };
      };
      expect(list.data.entries.some((e) => e.url.includes('/v1/traces'))).toBe(false);
      expect(list.data.entries.some((e) => e.url.endsWith('/dep'))).toBe(true);
    } finally {
      nodeui.shutdown();
      await Promise.all([close(app), close(upstream), close(collector)]);
    }
  });

  it('survives an unreachable collector and warns once', async () => {
    const exporter = new OtlpExporter({ endpoint: 'http://127.0.0.1:1', intervalMs: 10 });
    exporter.query({
      id: 1,
      system: 'pg',
      sql: 'SELECT 1',
      durationMs: 1,
      timestampMs: Date.now(),
    });
    await exporter.flush();
    expect(exporter.exported).toBe(0);
    expect(exporter.dropped).toBe(1);
  });

  it('rejects an invalid endpoint at startup', () => {
    expect(() => createNodeUI({ env: { NODE_ENV: 'development' }, otlp: 'not a url' })).toThrow(
      /otlp endpoint/,
    );
  });
});
