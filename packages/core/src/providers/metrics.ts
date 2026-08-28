import type { MetricsBucket, MetricsData, NodeUIProvider } from '../types';

const WINDOW_SECONDS = 60;

/**
 * Records one-second buckets of request counts and error counts, derived from
 * the request recorder in the server middleware. Errors are responses with
 * status >= 500.
 */
export class MetricsProvider implements NodeUIProvider<MetricsData> {
  readonly id = 'metrics' as const;

  private buckets: MetricsBucket[] = [];
  private readonly nowMs: () => number;

  constructor(nowMs: () => number = Date.now) {
    this.nowMs = nowMs;
  }

  /** Ticks the current second bucket for one completed request. */
  record(status: number): void {
    const ts = Math.floor(this.nowMs() / 1000) * 1000;
    const last = this.buckets[this.buckets.length - 1];
    if (last && last.ts === ts) {
      last.requests += 1;
      if (status >= 500) last.errors += 1;
      return;
    }
    this.buckets.push({ ts, requests: 1, errors: status >= 500 ? 1 : 0 });
    if (this.buckets.length > WINDOW_SECONDS + 1) {
      this.buckets.splice(0, this.buckets.length - WINDOW_SECONDS);
    }
  }

  get(): { ok: true; data: MetricsData } {
    const now = Math.floor(this.nowMs() / 1000) * 1000;
    const start = now - (WINDOW_SECONDS - 1) * 1000;
    const byTs = new Map<number, MetricsBucket>(this.buckets.map((b) => [b.ts, b]));
    const buckets: MetricsBucket[] = [];
    for (let ts = start; ts <= now; ts += 1000) {
      const existing = byTs.get(ts);
      buckets.push(existing ? { ...existing } : { ts, requests: 0, errors: 0 });
    }
    return { ok: true, data: { buckets } };
  }
}
