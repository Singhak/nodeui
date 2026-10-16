import { describe, expect, it } from 'vitest';
import { normalizePath, RouteMetricsProvider } from '../src/providers/route-metrics';
import { TimeSeriesProvider } from '../src/providers/timeseries';
import type { ProviderContext } from '../src/types';

function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('RouteMetricsProvider', () => {
  it('aggregates per matched route and computes percentiles', () => {
    const c = clock();
    const rm = new RouteMetricsProvider({ nowMs: c.now });
    for (let i = 1; i <= 100; i += 1) {
      rm.record('GET', `/users/${i}`, '/users/:id', 200, i, 500);
      c.advance(100);
    }
    rm.record('POST', '/orders', '/orders', 500, 900, 10);
    const { data } = rm.get();
    expect(data.routes).toHaveLength(2);
    const users = data.routes.find((r) => r.path === '/users/:id');
    expect(users?.count).toBe(100);
    expect(users?.p50).toBeGreaterThan(40);
    expect(users?.p50).toBeLessThan(60);
    expect(users?.p99).toBeGreaterThan(85);
    expect(users?.bytesOut).toBe(50_000);
    const orders = data.routes.find((r) => r.path === '/orders');
    expect(orders?.errors5xx).toBe(1);
    expect(orders?.errorRate).toBe(1);
    expect(data.totals.requests).toBe(101);
  });

  it('sorts by total time spent', () => {
    const rm = new RouteMetricsProvider({ nowMs: clock().now });
    for (let i = 0; i < 10; i += 1) rm.record('GET', '/fast', '/fast', 200, 1, 0);
    rm.record('GET', '/slow', '/slow', 200, 5000, 0);
    expect(rm.get().data.routes[0]?.path).toBe('/slow');
  });

  it('normalizes ids when the framework gives no pattern', () => {
    expect(normalizePath('/a/12/b/3f2c9a1e-1111-2222-3333-444455556666')).toBe('/a/:id/b/:id');
    const rm = new RouteMetricsProvider({ nowMs: clock().now });
    rm.record('GET', '/items/1', undefined, 200, 5, 0);
    rm.record('GET', '/items/2', undefined, 200, 5, 0);
    const rows = rm.get().data.routes;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toBe('/items/:id');
  });

  it('groups unmatched 404s together instead of one row per URL', () => {
    const rm = new RouteMetricsProvider({ nowMs: clock().now });
    for (let i = 0; i < 50; i += 1) rm.record('GET', `/nope-${i}`, undefined, 404, 1, 0);
    const rows = rm.get().data.routes;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: '*', path: '(unmatched)', count: 50 });
  });

  it('caps route cardinality into an overflow row', () => {
    const rm = new RouteMetricsProvider({ nowMs: clock().now });
    for (let i = 0; i < 260; i += 1) rm.record('GET', `/r${i}`, `/r${i}`, 200, 1, 0);
    const rows = rm.get().data.routes;
    expect(rows.length).toBe(201);
    expect(rows.find((r) => r.path === '(other)')?.count).toBe(60);
  });

  it('fills a sparkline per 10s bucket and resets on demand', () => {
    const c = clock();
    const rm = new RouteMetricsProvider({ nowMs: c.now });
    for (let i = 0; i < 20; i += 1) rm.record('GET', '/x', '/x', 200, 10, 0);
    c.advance(10_000);
    for (let i = 0; i < 10; i += 1) rm.record('GET', '/x', '/x', 200, 30, 0);
    const row = rm.get().data.routes[0];
    expect(row?.sparkRps).toHaveLength(30);
    expect(row?.sparkRps.at(-1)).toBe(1);
    expect(row?.sparkRps.at(-2)).toBe(2);
    expect(row?.sparkAvgMs.at(-1)).toBe(30);
    rm.reset();
    expect(rm.get().data.routes).toHaveLength(0);
  });
});

describe('latency heatmap', () => {
  it('returns a trimmed time x latency grid only when asked', () => {
    const c = clock();
    const ts = new TimeSeriesProvider({ nowMs: c.now, manualTick: true });
    for (let s = 0; s < 5; s += 1) {
      for (let i = 0; i < 10; i += 1) ts.requestFinished(200, s < 3 ? 5 : 400, 0, 0);
      c.advance(1000);
    }
    const ctx = (q: Record<string, string>): ProviderContext => ({ query: q }) as ProviderContext;
    expect(ts.get(ctx({ range: '60000' })).data.heatmap).toBeUndefined();
    const heat = ts.get(ctx({ range: '60000', heatmap: '1' })).data.heatmap;
    expect(heat).toBeDefined();
    expect(heat?.cells.length).toBe(heat?.times.length);
    const rows = heat?.rowUpperMs.length ?? 0;
    expect(rows).toBeGreaterThan(5);
    expect(rows).toBeLessThan(100);
    const total = heat?.cells.flat().reduce((a, b) => a + b, 0);
    expect(total).toBe(50);
  });

  it('is empty when nothing was recorded', () => {
    const ts = new TimeSeriesProvider({ nowMs: clock().now, manualTick: true });
    const heat = ts.get({ query: { heatmap: '1' } } as ProviderContext).data.heatmap;
    expect(heat?.times).toEqual([]);
  });
});
