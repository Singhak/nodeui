import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createNodeUI, type NodeUIOptions } from '../src/server';
import type { RequestEntry } from '../src/types';

async function run(
  options: NodeUIOptions,
  send: (base: string) => Promise<void>,
): Promise<RequestEntry[]> {
  const nodeui = createNodeUI({ env: { NODE_ENV: 'development' }, ...options });
  const mw = nodeui.middleware();
  const app: Server = createServer((req, res) => {
    mw(req, res, () => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ echo: Buffer.concat(chunks).toString(), password: 'hunter2' }));
      });
    });
  });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  try {
    await send(base);
    const res = await fetch(base + '/nodeui/api/requests');
    return ((await res.json()) as { data: { entries: RequestEntry[] } }).data.entries;
  } finally {
    nodeui.shutdown();
    app.closeAllConnections?.();
    await new Promise<void>((r) => app.close(() => r()));
  }
}

describe('request detail capture', () => {
  it('records query and headers, always redacting credentials', async () => {
    const [entry] = await run({}, async (base) => {
      await fetch(`${base}/a?page=2&token=abc`, {
        headers: { authorization: 'Bearer xyz', cookie: 'sid=1', 'x-trace': 't1' },
      });
    });
    expect(entry?.query).toEqual({ page: '2', token: '[REDACTED]' });
    expect(entry?.headers?.['x-trace']).toBe('t1');
    expect(entry?.headers?.authorization).toBe('[REDACTED]');
    expect(entry?.headers?.cookie).toBe('[REDACTED]');
    expect(entry?.requestBody).toBeUndefined();
  });

  it('redacts credentials even when maskSecrets is off', async () => {
    const [entry] = await run({ maskSecrets: false }, async (base) => {
      await fetch(`${base}/a`, { headers: { authorization: 'Bearer xyz' } });
    });
    expect(entry?.headers?.authorization).toBe('[REDACTED]');
  });

  it('captures masked, size-capped bodies only when opted in, without breaking the app', async () => {
    const entries = await run(
      { captureRequestDetail: { bodies: true, maxBodyBytes: 40 } },
      async (base) => {
        const res = await fetch(`${base}/echo`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user: 'a', password: 'secret-pass', pad: 'x'.repeat(100) }),
        });
        // the app still received the full body (it echoes it back)
        expect(((await res.json()) as { echo: string }).echo).toContain('x'.repeat(100));
      },
    );
    const entry = entries[0];
    expect(entry?.requestBody?.length).toBeLessThanOrEqual(80);
    expect(entry?.requestBodyTruncated).toBe(true);
    expect(entry?.requestBody).not.toContain('secret-pass');
    expect(entry?.responseBody).toBeDefined();
  });

  it('masks complete JSON bodies by key', async () => {
    const [entry] = await run({ captureRequestDetail: { bodies: true } }, async (base) => {
      await fetch(`${base}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: 'a', password: 'secret-pass' }),
      });
    });
    expect(JSON.parse(entry?.requestBody ?? '{}')).toEqual({ user: 'a', password: '[REDACTED]' });
    expect(JSON.parse(entry?.responseBody ?? '{}').password).toBe('[REDACTED]');
  });

  it('records nothing extra when disabled', async () => {
    const [entry] = await run({ captureRequestDetail: false }, async (base) => {
      await fetch(`${base}/a?x=1`);
    });
    expect(entry?.query).toBeUndefined();
    expect(entry?.headers).toBeUndefined();
  });

  it('rejects an invalid maxBodyBytes', () => {
    expect(() =>
      createNodeUI({
        env: { NODE_ENV: 'development' },
        captureRequestDetail: { maxBodyBytes: 0 },
      }),
    ).toThrow(/maxBodyBytes/);
  });
});
