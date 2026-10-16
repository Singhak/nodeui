import type { NodeUIProvider, ProviderContext, RouteMetricRow, RouteMetricsData } from '../types';
import { bucketIndex, HIST_BUCKETS, histQuantile } from './timeseries';

const MAX_ROUTES = 200;
const SPARK_STEP_MS = 10_000;
const SPARK_SLOTS = 30; // 5 minutes of 10s buckets
const OTHER_KEY = '(other)';
const UNMATCHED_KEY = '(unmatched)';

/** Collapses numeric/uuid/objectid path segments so `/users/1` and `/users/2` aggregate. */
export function normalizePath(path: string): string {
  return path
    .split('/')
    .map((seg) =>
      /^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(seg) || /^[0-9a-f]{24}$/i.test(seg)
        ? ':id'
        : seg,
    )
    .join('/');
}

interface SparkSlot {
  idx: number;
  req: number;
  err: number;
  sumMs: number;
}

class RouteStats {
  count = 0;
  err5 = 0;
  err4 = 0;
  sumMs = 0;
  maxMs = 0;
  bytesOut = 0;
  firstMs: number;
  lastMs: number;
  readonly hist = new Float64Array(HIST_BUCKETS);
  readonly spark: SparkSlot[] = Array.from({ length: SPARK_SLOTS }, () => ({
    idx: -1,
    req: 0,
    err: 0,
    sumMs: 0,
  }));

  constructor(
    readonly method: string,
    readonly path: string,
    nowMs: number,
  ) {
    this.firstMs = this.lastMs = nowMs;
  }
}

export interface RouteMetricsOptions {
  /** Injectable wall clock (ms) for tests. */
  nowMs?: () => number;
}

/**
 * Per-route request statistics. Latency is a mergeable log-bucket histogram per
 * route (same buckets as the time series), plus a five-minute sparkline. Route
 * cardinality is capped so unmatched/random URLs can't grow memory.
 */
export class RouteMetricsProvider implements NodeUIProvider<RouteMetricsData> {
  readonly id = 'routemetrics' as const;

  private readonly now: () => number;
  private readonly routes = new Map<string, RouteStats>();
  private readonly startedAtMs: number;

  constructor(options: RouteMetricsOptions = {}) {
    this.now = options.nowMs ?? Date.now;
    this.startedAtMs = this.now();
  }

  /** Records one finished request. `route` is the framework's matched pattern, if any. */
  record(
    method: string,
    path: string,
    route: string | undefined,
    status: number,
    durationMs: number,
    bytesOut: number,
  ): void {
    const nowMs = this.now();
    let pattern = route;
    if (!pattern) pattern = status === 404 ? UNMATCHED_KEY : normalizePath(path);
    const isSpecial = pattern === UNMATCHED_KEY;
    const verb = isSpecial ? '*' : method;
    let key = `${verb} ${pattern}`;
    let stats = this.routes.get(key);
    if (!stats) {
      if (this.routes.size >= MAX_ROUTES) {
        key = `* ${OTHER_KEY}`;
        stats = this.routes.get(key);
        if (!stats) {
          stats = new RouteStats('*', OTHER_KEY, nowMs);
          this.routes.set(key, stats);
        }
      } else {
        stats = new RouteStats(verb, pattern, nowMs);
        this.routes.set(key, stats);
      }
    }
    stats.count += 1;
    stats.lastMs = nowMs;
    if (status >= 500) stats.err5 += 1;
    else if (status >= 400) stats.err4 += 1;
    stats.sumMs += durationMs;
    if (durationMs > stats.maxMs) stats.maxMs = durationMs;
    stats.bytesOut += bytesOut;
    const bi = bucketIndex(durationMs);
    stats.hist[bi] = (stats.hist[bi] as number) + 1;

    const idx = Math.floor(nowMs / SPARK_STEP_MS);
    const slot = stats.spark[idx % SPARK_SLOTS] as SparkSlot;
    if (slot.idx !== idx) {
      slot.idx = idx;
      slot.req = slot.err = 0;
      slot.sumMs = 0;
    }
    slot.req += 1;
    if (status >= 500) slot.err += 1;
    slot.sumMs += durationMs;
  }

  /** Clears all route statistics (the UI's "reset" button). */
  reset(): void {
    this.routes.clear();
  }

  private row(stats: RouteStats, nowMs: number, uptimeSec: number): RouteMetricRow {
    const nowIdx = Math.floor(nowMs / SPARK_STEP_MS);
    const rps: number[] = [];
    const avgMs: number[] = [];
    for (let i = nowIdx - SPARK_SLOTS + 1; i <= nowIdx; i += 1) {
      const slot = stats.spark[((i % SPARK_SLOTS) + SPARK_SLOTS) % SPARK_SLOTS] as SparkSlot;
      const live = slot.idx === i;
      rps.push(live ? Math.round((slot.req / (SPARK_STEP_MS / 1000)) * 100) / 100 : 0);
      avgMs.push(live && slot.req > 0 ? Math.round((slot.sumMs / slot.req) * 100) / 100 : 0);
    }
    const q = (p: number): number =>
      Math.round(histQuantile(stats.hist, stats.count, p, stats.maxMs) * 100) / 100;
    const activeSec = Math.max(1, Math.min(uptimeSec, (stats.lastMs - stats.firstMs) / 1000 || 1));
    return {
      method: stats.method,
      path: stats.path,
      count: stats.count,
      errors5xx: stats.err5,
      errors4xx: stats.err4,
      errorRate: stats.count === 0 ? 0 : stats.err5 / stats.count,
      avgMs: stats.count === 0 ? 0 : Math.round((stats.sumMs / stats.count) * 100) / 100,
      p50: q(0.5),
      p95: q(0.95),
      p99: q(0.99),
      maxMs: Math.round(stats.maxMs * 100) / 100,
      totalMs: Math.round(stats.sumMs),
      bytesOut: stats.bytesOut,
      rps: Math.round((stats.count / activeSec) * 100) / 100,
      lastMs: stats.lastMs,
      sparkRps: rps,
      sparkAvgMs: avgMs,
    };
  }

  get(_ctx?: ProviderContext): { ok: true; data: RouteMetricsData } {
    const nowMs = this.now();
    const uptimeSec = Math.max(1, (nowMs - this.startedAtMs) / 1000);
    const rows = [...this.routes.values()].map((s) => this.row(s, nowMs, uptimeSec));
    let total = 0;
    let totalMs = 0;
    for (const r of rows) {
      total += r.count;
      totalMs += r.totalMs;
    }
    return {
      ok: true,
      data: {
        startedAtMs: this.startedAtMs,
        sparkStepMs: SPARK_STEP_MS,
        routes: rows.sort((a, b) => b.totalMs - a.totalMs),
        totals: { requests: total, totalMs },
      },
    };
  }
}
