import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { AnnotationStore } from '../src/annotations';
import { TimeSeriesProvider } from '../src/providers/timeseries';
import { createNodeUI } from '../src/server';

describe('AnnotationStore', () => {
  it('cleans labels, filters by range and only removes notes', () => {
    const store = new AnnotationStore(() => 5000);
    const a = store.add('  deployed\nv1  ');
    expect(a).toMatchObject({ label: 'deployed v1', kind: 'note', atMs: 5000 });
    store.add('alert', 'alert', 9000);
    expect(() => store.add('   ')).toThrow(/empty/);
    expect(store.range(0, 6000).map((x) => x.label)).toEqual(['deployed v1']);
    expect(store.range(0, 10_000)).toHaveLength(2);
    expect(store.remove(2)).toBe(false); // alerts stay
    expect(store.remove(a.id)).toBe(true);
  });

  it('keeps at most 500 markers', () => {
    const store = new AnnotationStore();
    for (let i = 0; i < 520; i += 1) store.add(`m${i}`, 'app', i);
    expect(store.range(0, 1000)).toHaveLength(500);
    expect(store.range(0, 1000)[0]?.label).toBe('m20');
  });
});

describe('annotations in the time series', () => {
  it('marks run start/stop and returns only markers inside the window', () => {
    let t = 1_700_000_000_000;
    const ts = new TimeSeriesProvider({ nowMs: () => t, manualTick: true });
    const store = new AnnotationStore(() => t);
    ts.annotations = store;
    ts.requestFinished(200, 5, 0, 0);
    t += 2000;
    ts.startRun('load');
    t += 3000;
    ts.stopRun();
    t += 1000;
    const all = ts.get({ query: { range: '60000' } } as never).data.annotations ?? [];
    expect(all.map((a) => a.label)).toEqual(['Run started: load', 'Run stopped: load']);
    const late = ts.get({ query: { from: String(t - 500), to: String(t) } } as never).data;
    expect(late.annotations).toEqual([]);
  });
});

describe('annotations over HTTP', () => {
  it('accepts notes from the console and from server.annotate()', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = createNodeUI({});
    const http = createServer((req, res) => server.middleware()(req, res, () => res.end('ok')));
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/nodeui/api`;
    try {
      server.annotate('deployed v2');
      server.annotate('   ');
      const post = (path: string, body: unknown) =>
        fetch(base + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const added = (await (await post('/annotations/add', { label: 'cache on' })).json()) as {
        data: { id: number };
      };
      expect((await post('/annotations/add', { label: '' })).status).toBe(400);
      const series = (await (await fetch(base + '/timeseries?range=60000')).json()) as {
        data: { annotations: Array<{ label: string; kind: string }> };
      };
      expect(series.data.annotations.map((a) => [a.kind, a.label])).toEqual([
        ['app', 'deployed v2'],
        ['note', 'cache on'],
      ]);
      const removed = (await (await post('/annotations/remove', { id: added.data.id })).json()) as {
        data: { removed: boolean };
      };
      expect(removed.data.removed).toBe(true);
    } finally {
      server.shutdown();
      http.closeAllConnections?.();
      await new Promise<void>((r) => http.close(() => r()));
      warn.mockRestore();
    }
  });
});
