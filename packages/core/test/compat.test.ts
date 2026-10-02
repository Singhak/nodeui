import http, { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { interceptOutgoing } from '../src/providers/outgoing';

function call(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    http
      .request({ host: '127.0.0.1', port, path: '/x' }, (res) => {
        res.resume();
        res.on('end', () => resolve());
      })
      .on('error', reject)
      .end();
  });
}

describe('coexisting with other http instrumentation', () => {
  const original = http.request;
  afterEach(() => {
    http.request = original;
  });

  it('keeps a wrapper another tool installed on top of ours after we stop', async () => {
    const upstream = createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const port = (upstream.address() as AddressInfo).port;
    try {
      const seen: string[] = [];
      const release = interceptOutgoing(() => undefined);
      const ours = http.request;
      // An APM / OpenTelemetry style wrapper installed after NodeUI.
      let foreignCalls = 0;
      const foreign = function (this: unknown, ...args: unknown[]): http.ClientRequest {
        foreignCalls += 1;
        return (ours as (...a: unknown[]) => http.ClientRequest).apply(this, args);
      };
      http.request = foreign as typeof http.request;

      release();
      expect(http.request).toBe(foreign); // not clobbered by a blind restore

      // NodeUI starts again: the retired wrapper must not record twice.
      const release2 = interceptOutgoing((e) => seen.push(e.url));
      await call(port);
      release2();

      expect(foreignCalls).toBeGreaterThan(0); // the other tool still sees traffic
      expect(seen).toHaveLength(1);
    } finally {
      await new Promise((r) => upstream.close(r));
    }
  });

  it('restores the original function when nothing wrapped on top', () => {
    const before = http.request;
    const release = interceptOutgoing(() => undefined);
    expect(http.request).not.toBe(before);
    release();
    expect(http.request).toBe(before);
  });
});
