import { describe, expect, it } from 'vitest';
import { MetricsProvider } from '../src/providers/metrics';

function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('MetricsProvider', () => {
  it('records requests and errors into the current second bucket', () => {
    const clock = makeClock();
    const provider = new MetricsProvider(clock.now);
    provider.record(200);
    provider.record(200);
    provider.record(500);
    const result = provider.get();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const last = result.data.buckets[result.data.buckets.length - 1];
    expect(last).toEqual({ ts: 0, requests: 3, errors: 1 });
  });

  it('zero-fills the 60-second window', () => {
    const clock = makeClock();
    const provider = new MetricsProvider(clock.now);
    clock.advance(59_000);
    provider.record(200);
    const result = provider.get();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.buckets).toHaveLength(60);
    expect(result.data.buckets[0]?.requests).toBe(0);
    expect(result.data.buckets[59]?.requests).toBe(1);
    expect(result.data.buckets[59]?.ts).toBe(59_000);
  });

  it('rolls over buckets as time advances', () => {
    const clock = makeClock();
    const provider = new MetricsProvider(clock.now);
    provider.record(200);
    clock.advance(1000);
    provider.record(500);
    const result = provider.get();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const buckets = result.data.buckets;
    expect(buckets[59]?.requests).toBe(1);
    expect(buckets[59]?.errors).toBe(1);
    expect(buckets[58]?.requests).toBe(1);
    expect(buckets[58]?.errors).toBe(0);
  });
});
