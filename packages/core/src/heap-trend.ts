import type { HeapTrend } from './types';

const MB = 1024 * 1024;
const BUCKETS = 12;
const MIN_WINDOW_MS = 5 * 60_000;
const MIN_POINTS = 12;
const MIN_GROWTH_MB = 8;
const MIN_GROWTH_RATIO = 0.15;
const MIN_R2 = 0.8;

interface Sample {
  t: number;
  heapUsed: number;
}

/**
 * Looks for a heap that keeps growing even at its lowest points. Heap usage
 * saw-tooths as the garbage collector runs, so a rising average proves
 * nothing; the lower envelope (minimum per time bucket) approximates what is
 * still retained after collection. A leak suspect needs a long enough window,
 * clear growth, a good linear fit and a floor that never steps back down.
 */
export function assessHeapTrend(samples: readonly Sample[]): HeapTrend {
  const valid = samples.filter((s) => s.heapUsed > 0);
  const first = valid[0];
  const last = valid[valid.length - 1];
  const empty: HeapTrend = {
    windowMs: first && last ? last.t - first.t : 0,
    slopeMbPerMin: 0,
    floorStartMb: 0,
    floorEndMb: 0,
    r2: 0,
    suspect: false,
    reason: 'collecting',
  };
  if (!first || !last || valid.length < MIN_POINTS) return empty;
  const windowMs = last.t - first.t;
  if (windowMs < MIN_WINDOW_MS) {
    return { ...empty, reason: 'needs at least 5 minutes of history' };
  }

  const step = windowMs / BUCKETS;
  const floors: Array<{ t: number; v: number }> = [];
  for (let b = 0; b < BUCKETS; b += 1) {
    const from = first.t + b * step;
    const to = from + step;
    let min = Infinity;
    for (const s of valid) {
      if (s.t >= from && (s.t < to || b === BUCKETS - 1) && s.heapUsed < min) min = s.heapUsed;
    }
    if (Number.isFinite(min)) floors.push({ t: from + step / 2, v: min / MB });
  }
  if (floors.length < 6) return empty;

  const n = floors.length;
  const meanT = floors.reduce((a, p) => a + p.t, 0) / n;
  const meanV = floors.reduce((a, p) => a + p.v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of floors) {
    sxy += (p.t - meanT) * (p.v - meanV);
    sxx += (p.t - meanT) ** 2;
    syy += (p.v - meanV) ** 2;
  }
  const slopePerMs = sxx === 0 ? 0 : sxy / sxx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  const slopeMbPerMin = slopePerMs * 60_000;

  // Compare the first and last third of the floor, so one noisy bucket cannot decide.
  const third = Math.max(1, Math.floor(n / 3));
  const avg = (xs: Array<{ v: number }>): number => xs.reduce((a, p) => a + p.v, 0) / xs.length;
  const floorStartMb = avg(floors.slice(0, third));
  const floorEndMb = avg(floors.slice(-third));
  const growth = floorEndMb - floorStartMb;
  const tail = floors.slice(-4).map((p) => p.v);
  const stepsDown = tail.slice(1).filter((v, i) => v < (tail[i] as number) - 0.5).length;

  const growing =
    growth >= MIN_GROWTH_MB &&
    growth >= floorStartMb * MIN_GROWTH_RATIO &&
    r2 >= MIN_R2 &&
    slopeMbPerMin > 0 &&
    stepsDown === 0;

  const round = (v: number): number => Math.round(v * 100) / 100;
  return {
    windowMs,
    slopeMbPerMin: round(slopeMbPerMin),
    floorStartMb: round(floorStartMb),
    floorEndMb: round(floorEndMb),
    r2: round(r2),
    suspect: growing,
    reason: growing ? 'heap floor keeps rising after garbage collection' : 'heap is stable',
  };
}
