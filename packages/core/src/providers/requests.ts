import type {
  NodeUIProvider,
  RequestEntry,
  RequestsData,
  RequestsSummary,
  RouteStat,
} from '../types';
import { RingBuffer } from '../ring-buffer';

const RESPONSE_PAGE_SIZE = 100;
const MAX_ROUTE_STATS = 8;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

/** Collapses numeric/uuid path segments so `/users/1` and `/users/2` aggregate. */
function routeKey(path: string): string {
  return path
    .split('/')
    .map((seg) =>
      /^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(seg) || /^[0-9a-f]{24}$/i.test(seg)
        ? ':id'
        : seg,
    )
    .join('/');
}

export function summarizeRequests(entries: readonly RequestEntry[]): RequestsSummary {
  const durations = entries.map((e) => e.durationMs).sort((a, b) => a - b);
  const byStatus = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  const groups = new Map<string, { method: string; path: string; ms: number[]; errors: number }>();
  for (const e of entries) {
    const bucket = `${Math.floor(e.status / 100)}xx` as keyof typeof byStatus;
    if (bucket in byStatus) byStatus[bucket] += 1;
    const path = e.route ?? routeKey(e.path);
    const key = `${e.method} ${path}`;
    const group = groups.get(key) ?? { method: e.method, path, ms: [], errors: 0 };
    group.ms.push(e.durationMs);
    if (e.status >= 500) group.errors += 1;
    groups.set(key, group);
  }
  const routes: RouteStat[] = [...groups.values()]
    .map((g) => {
      const sorted = [...g.ms].sort((a, b) => a - b);
      return {
        method: g.method,
        path: g.path,
        count: g.ms.length,
        avgMs: g.ms.reduce((a, b) => a + b, 0) / g.ms.length,
        p95Ms: percentile(sorted, 0.95),
        errors: g.errors,
      };
    })
    .sort((a, b) => b.p95Ms - a.p95Ms)
    .slice(0, MAX_ROUTE_STATS);
  return {
    count: entries.length,
    errors: byStatus['5xx'],
    errorRate: entries.length === 0 ? 0 : byStatus['5xx'] / entries.length,
    avgMs: durations.length === 0 ? 0 : durations.reduce((a, b) => a + b, 0) / durations.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    byStatus,
    routes,
  };
}

/** Fixed-size ring buffer of recent HTTP requests, recorded via middleware hook. */
export class RequestsProvider implements NodeUIProvider<RequestsData> {
  readonly id = 'requests' as const;

  private buffer: RingBuffer<RequestEntry>;
  private nextId = 1;

  constructor(size: number) {
    this.buffer = new RingBuffer<RequestEntry>(size);
  }

  record(entry: Omit<RequestEntry, 'id'>): void {
    this.buffer.push({ id: this.nextId, ...entry });
    this.nextId += 1;
  }

  get length(): number {
    return this.buffer.length;
  }

  get(): { ok: true; data: RequestsData } {
    const entries = this.buffer.slice(Math.max(0, this.buffer.length - RESPONSE_PAGE_SIZE));
    const summary = summarizeRequests(this.buffer.toArray());
    return { ok: true, data: { total: this.buffer.length, entries, summary } };
  }
}
