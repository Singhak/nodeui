import { describe, expect, it } from 'vitest';
import { assessHeapTrend } from '../src/heap-trend';

const MB = 1024 * 1024;
const T0 = 1_700_000_000_000;

/** One sample every 5s for `minutes`, with a GC saw-tooth of `saw` MB on top of `floor(i)`. */
function series(minutes: number, floor: (min: number) => number, saw = 20) {
  const out: Array<{ t: number; heapUsed: number }> = [];
  for (let s = 0; s <= minutes * 60; s += 5) {
    const min = s / 60;
    const tooth = ((s / 5) % 8) / 8; // 0..1 ramp, then GC drops it back to the floor
    out.push({ t: T0 + s * 1000, heapUsed: (floor(min) + saw * tooth) * MB });
  }
  return out;
}

describe('assessHeapTrend', () => {
  it('needs enough history before judging', () => {
    expect(assessHeapTrend([]).reason).toBe('collecting');
    const short = assessHeapTrend(series(2, () => 50));
    expect(short.suspect).toBe(false);
    expect(short.reason).toMatch(/5 minutes/);
  });

  it('calls a flat floor stable even though the heap saw-tooths', () => {
    const r = assessHeapTrend(series(20, () => 50));
    expect(r.suspect).toBe(false);
    expect(r.reason).toBe('heap is stable');
    expect(Math.abs(r.slopeMbPerMin)).toBeLessThan(0.2);
  });

  it('flags a floor that keeps rising', () => {
    const r = assessHeapTrend(series(20, (m) => 50 + m * 2));
    expect(r.suspect).toBe(true);
    expect(r.slopeMbPerMin).toBeGreaterThan(1.5);
    expect(r.slopeMbPerMin).toBeLessThan(2.5);
    expect(r.floorEndMb).toBeGreaterThan(r.floorStartMb + 20);
    expect(r.r2).toBeGreaterThan(0.9);
  });

  it('ignores small absolute growth', () => {
    expect(assessHeapTrend(series(20, (m) => 50 + m * 0.1)).suspect).toBe(false);
  });

  it('does not flag growth that was released at the end', () => {
    const r = assessHeapTrend(series(20, (m) => (m < 14 ? 50 + m * 3 : 40)));
    expect(r.suspect).toBe(false);
  });

  it('ignores a one-off step (load, then stable)', () => {
    const r = assessHeapTrend(series(20, (m) => (m < 3 ? 40 : 90)));
    expect(r.suspect).toBe(false);
  });
});
