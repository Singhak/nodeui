import { describe, expect, it } from 'vitest';
import { RequestsProvider } from '../src/providers/requests';
import {
  bucketIndex,
  bucketUpperMs,
  histQuantile,
  HIST_BUCKETS,
  TimeSeriesProvider,
} from '../src/providers/timeseries';
import type { ProviderContext } from '../src/types';

function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function make() {
  const c = clock();
  const ts = new TimeSeriesProvider({ nowMs: c.now, manualTick: true });
  return { c, ts };
}

describe('latency histogram', () => {
  it('maps values into buckets that bound them within ~15%', () => {
    for (const ms of [0.05, 0.3, 1, 7.7, 120, 515, 9000]) {
      const i = bucketIndex(ms);
      expect(bucketUpperMs(i)).toBeGreaterThanOrEqual(
        Math.min(ms, bucketUpperMs(HIST_BUCKETS - 1)),
      );
      if (i > 0) expect(bucketUpperMs(i - 1)).toBeLessThan(ms);
    }
  });

  it('estimates quantiles close to the true value', () => {
    const hist = new Uint32Array(HIST_BUCKETS);
    for (let ms = 1; ms <= 1000; ms += 1) hist[bucketIndex(ms)] += 1;
    const p50 = histQuantile(hist, 1000, 0.5, 1000);
    const p99 = histQuantile(hist, 1000, 0.99, 1000);
    expect(p50).toBeGreaterThan(500 * 0.88);
    expect(p50).toBeLessThan(500 * 1.12);
    expect(p99).toBeGreaterThan(990 * 0.88);
    expect(p99).toBeLessThanOrEqual(1000);
  });
});

describe('TimeSeriesProvider', () => {
  it('aggregates requests, errors and latency per second', () => {
    const { c, ts } = make();
    for (let i = 1; i <= 100; i += 1) {
      ts.requestStarted();
      ts.requestFinished(i <= 10 ? 500 : 200, i, 100, 1000);
    }
    c.advance(1000);
    ts.tick();
    const { points, total } = ts.query({ fromMs: c.now() - 5000, toMs: c.now(), maxPoints: 100 });
    const busy = points.find((p) => p.requests > 0);
    expect(busy?.requests).toBe(100);
    expect(busy?.errors).toBe(10);
    expect(busy?.errorRate).toBeCloseTo(0.1);
    expect(busy?.p50 ?? 0).toBeGreaterThan(40);
    expect(busy?.p50 ?? 0).toBeLessThan(60);
    expect(busy?.p99 ?? 0).toBeGreaterThan(85);
    expect(busy?.maxMs).toBe(100);
    expect(busy?.inflight).toBe(1);
    expect(busy?.bytesOutPerSec).toBe(100_000);
    expect(total.req).toBe(100);
  });

  it('tracks concurrency and aborts', () => {
    const { ts } = make();
    ts.requestStarted();
    ts.requestStarted();
    ts.requestStarted();
    ts.requestAborted();
    ts.requestFinished(200, 1, 0, 0);
    const prom = ts.prometheus({ uptimeSeconds: 1 });
    expect(prom).toContain('nodeui_http_inflight_requests 1');
  });

  it('downsamples long ranges and merges percentiles from histograms', () => {
    const { c, ts } = make();
    for (let s = 0; s < 600; s += 1) {
      ts.requestStarted();
      ts.requestFinished(200, s % 2 === 0 ? 10 : 200, 0, 0);
      c.advance(1000);
      ts.tick();
    }
    const { points, stepMs } = ts.query({
      fromMs: c.now() - 600_000,
      toMs: c.now(),
      maxPoints: 20,
    });
    expect(points.length).toBeLessThanOrEqual(21);
    expect(stepMs).toBeGreaterThanOrEqual(30_000);
    const reqs = points.reduce((a, p) => a + p.requests, 0);
    expect(reqs).toBe(600);
    expect(points[2]?.p99 ?? 0).toBeGreaterThan(150);
  });

  it('falls back to the coarse tier for ranges older than an hour', () => {
    const { c, ts } = make();
    for (let s = 0; s < 4000; s += 1) {
      ts.requestStarted();
      ts.requestFinished(200, 5, 0, 0);
      c.advance(1000);
      ts.tick();
    }
    const { points } = ts.query({ fromMs: c.now() - 7200_000, toMs: c.now(), maxPoints: 1000 });
    const reqs = points.reduce((a, p) => a + p.requests, 0);
    expect(reqs).toBeGreaterThan(3900);
    expect(reqs).toBeLessThanOrEqual(4000);
  });

  it('records, saves and deletes runs', () => {
    const { c, ts } = make();
    ts.startRun('before');
    for (let s = 0; s < 10; s += 1) {
      for (let i = 0; i < 50; i += 1) {
        ts.requestStarted();
        ts.requestFinished(i === 0 ? 500 : 200, 20, 10, 100);
      }
      c.advance(1000);
      ts.tick();
    }
    const run = ts.stopRun();
    expect(run?.name).toBe('before');
    expect(run?.summary.requests).toBe(500);
    expect(run?.summary.errors5xx).toBe(10);
    expect(run?.summary.avgRps).toBeGreaterThan(30);
    expect(run?.summary.peakRps).toBe(50);
    expect(ts.stopRun()).toBeNull();
    const saved = ts.saveRange('retro', c.now() - 10_000, c.now());
    expect(saved.summary.requests).toBe(500);
    expect(ts.listRuns().runs.map((r) => r.name)).toEqual(['retro', 'before']);
    expect(ts.deleteRun(saved.id)).toBe(true);
    expect(ts.listRuns().runs).toHaveLength(1);
  });

  it('serves a default window through get() and honours query params', () => {
    const { c, ts } = make();
    ts.requestFinished(200, 5, 0, 0);
    c.advance(1000);
    ts.tick();
    const res = ts.get({ query: { range: '60000', points: '10' } } as unknown as ProviderContext);
    expect(res.data.toMs).toBe(c.now());
    expect(res.data.fromMs).toBe(c.now() - 60_000);
    expect(res.data.totals.requests).toBe(1);
    expect(res.data.recording).toBeNull();
  });

  it('exposes prometheus text', () => {
    const { ts } = make();
    ts.requestFinished(200, 30, 10, 20);
    ts.requestFinished(503, 700, 10, 20);
    const text = ts.prometheus({ uptimeSeconds: 5 });
    expect(text).toContain('nodeui_http_requests_total 2');
    expect(text).toContain('nodeui_http_errors_total 1');
    expect(text).toContain('nodeui_http_request_duration_seconds_bucket{le="+Inf"} 2');
    expect(text).toMatch(/nodeui_http_request_duration_seconds_bucket\{le="0.05"\} 1/);
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('RequestsProvider paging', () => {
  const fill = (n: number, size = 50) => {
    const p = new RequestsProvider(size);
    for (let i = 0; i < n; i += 1) {
      p.record({
        method: 'GET',
        path: `/p${i}`,
        status: i % 10 === 0 ? 500 : 200,
        durationMs: 1,
        timestampMs: i,
        ip: '::1',
      });
    }
    return p;
  };
  const ctx = (query: Record<string, string>) => ({ query }) as unknown as ProviderContext;

  it('returns the newest 100 by default and reports lifetime counters', () => {
    const p = fill(120, 500);
    const { data } = p.get();
    expect(data.entries).toHaveLength(100);
    expect(data.entries.at(-1)?.path).toBe('/p119');
    expect(data.lifetime).toEqual({ requests: 120, errors: 12 });
  });

  it('pages back with offset and limit', () => {
    const p = fill(40);
    const { data } = p.get(ctx({ limit: '10', offset: '10' }));
    expect(data.entries.map((e) => e.path)).toEqual(
      Array.from({ length: 10 }, (_, i) => `/p${20 + i}`),
    );
    expect(data.offset).toBe(10);
    expect(data.capacity).toBe(50);
  });

  it('keeps lifetime counters after eviction', () => {
    const p = fill(80, 50);
    const { data } = p.get(ctx({ limit: '1000' }));
    expect(data.total).toBe(50);
    expect(data.entries).toHaveLength(50);
    expect(data.lifetime.requests).toBe(80);
  });

  it('clamps bad paging params', () => {
    const p = fill(5);
    expect(p.get(ctx({ limit: '-3', offset: 'x' })).data.entries.length).toBeGreaterThan(0);
    expect(p.get(ctx({ offset: '999' })).data.entries).toHaveLength(0);
  });
});
