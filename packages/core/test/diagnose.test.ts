import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/providers/diagnose';
import { TimeSeriesProvider } from '../src/providers/timeseries';
import type { TimeSeriesPoint } from '../src/types';

function point(over: Partial<TimeSeriesPoint> = {}, i = 0): TimeSeriesPoint {
  return {
    t: 1_700_000_000_000 + i * 5000,
    requests: 10,
    rps: 2,
    errors: 0,
    errors4xx: 0,
    errorRate: 0,
    p50: 10,
    p90: 20,
    p95: 30,
    p99: 40,
    maxMs: 50,
    avgMs: 12,
    inflight: 1,
    bytesInPerSec: 0,
    bytesOutPerSec: 0,
    loopP50: 1,
    loopP99: 5,
    loopMax: 8,
    heapUsed: 50e6,
    heapTotal: 80e6,
    rss: 120e6,
    cpu: 10,
    gcCount: 1,
    gcMs: 5,
    gcMaxMs: 3,
    handles: 20,
    timers: 2,
    ...over,
  };
}
const series = (n: number, over: (i: number) => Partial<TimeSeriesPoint> = () => ({})) =>
  Array.from({ length: n }, (_, i) => point(over(i), i));
const ids = (pts: TimeSeriesPoint[]) => diagnose({ points: pts }).findings.map((f) => f.id);

describe('diagnose', () => {
  it('waits for enough history', () => {
    expect(diagnose({ points: series(3) }).status).toBe('collecting');
  });

  it('reports ok for a healthy service', () => {
    const d = diagnose({ points: series(30) });
    expect(d.status).toBe('ok');
    expect(d.findings).toEqual([]);
  });

  it('separates CPU-bound loop blocking from low-CPU stalls', () => {
    const hot = diagnose({ points: series(30, () => ({ loopP99: 300, cpu: 95 })) });
    expect(hot.findings[0]).toMatchObject({ id: 'event-loop-blocked', view: 'profiler' });
    expect(hot.status).toBe('critical');
    const idle = diagnose({ points: series(30, () => ({ loopP99: 300, cpu: 10 })) });
    expect(idle.findings[0]?.title).toMatch(/low CPU/i);
  });

  it('flags GC pressure from a long pause', () => {
    expect(ids(series(30, (i) => ({ gcMaxMs: i === 10 ? 250 : 3 })))).toContain('gc-pressure');
  });

  it('flags climbing handles but not a steady count', () => {
    expect(ids(series(40, (i) => ({ handles: 20 + i * 10 })))).toContain('handle-growth');
    expect(ids(series(40))).not.toContain('handle-growth');
  });

  it('flags a 5xx spike only with enough traffic', () => {
    expect(ids(series(30, () => ({ errors: 3 })))).toContain('error-rate');
    expect(ids(series(30, () => ({ requests: 0, errors: 0 })))).not.toContain('error-rate');
  });

  it('blames I/O when requests are slow but the process is idle', () => {
    expect(ids(series(30, () => ({ p95: 900, cpu: 8 })))).toContain('slow-io');
    expect(ids(series(30, () => ({ p95: 900, cpu: 90 })))).not.toContain('slow-io');
  });

  it('surfaces a heap leak suspect', () => {
    const heapTrend = {
      windowMs: 600_000,
      slopeMbPerMin: 4,
      floorStartMb: 50,
      floorEndMb: 90,
      r2: 0.95,
      suspect: true,
      reason: '',
    };
    expect(diagnose({ points: series(30), heapTrend }).findings[0]?.id).toBe('memory-leak');
  });
});

describe('TimeSeriesProvider resource gauges', () => {
  it('records GC max and active handles on a tick', () => {
    let t = 1_700_000_000_000;
    const ts = new TimeSeriesProvider({ nowMs: () => t, manualTick: true });
    ts.tick();
    t += 1000;
    ts.tick();
    const p = ts.get().data.points.at(-1);
    expect(p?.handles).toBeGreaterThanOrEqual(0);
    expect(p).toHaveProperty('gcMaxMs');
    expect(ts.recent(60, 10).points.length).toBeGreaterThan(0);
  });
});
