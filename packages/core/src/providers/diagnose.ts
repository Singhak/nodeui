import type {
  DiagnoseData,
  DiagnoseFinding,
  HeapTrend,
  NodeUIProvider,
  TimeSeriesPoint,
} from '../types';

const WINDOW_SECONDS = 300;
const MAX_POINTS = 60;
const MIN_POINTS = 6;
const MIN_REQUESTS = 20;
const LOOP_BAD_MS = 100;
const GC_SHARE_BAD = 0.1;
const GC_PAUSE_BAD_MS = 100;

export interface DiagnoseInput {
  points: readonly TimeSeriesPoint[];
  heapTrend?: HeapTrend;
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** Share of windows where `pick` exceeds `limit`. */
function share(
  points: readonly TimeSeriesPoint[],
  pick: (p: TimeSeriesPoint) => number,
  limit: number,
): number {
  return points.length ? points.filter((p) => pick(p) > limit).length / points.length : 0;
}

/**
 * Rule-based read of the recent metrics history, in the spirit of Clinic
 * Doctor: it names the likely problem class instead of leaving the user to
 * read the charts. Pure, so it is easy to test.
 */
export function diagnose(input: DiagnoseInput): DiagnoseData {
  const { points, heapTrend } = input;
  if (points.length < MIN_POINTS) {
    return { status: 'collecting', windowSeconds: WINDOW_SECONDS, findings: [] };
  }
  const out: DiagnoseFinding[] = [];
  const stepSeconds = Math.max(1, ((points[1]?.t ?? 0) - (points[0]?.t ?? 0)) / 1000);

  // Event loop blocked: delay with high CPU is JS work, with low CPU it is blocking I/O.
  const loopShare = share(points, (p) => p.loopP99, LOOP_BAD_MS);
  if (loopShare >= 0.2) {
    const cpu = avg(points.filter((p) => p.loopP99 > LOOP_BAD_MS).map((p) => p.cpu));
    const worst = Math.max(...points.map((p) => p.loopMax));
    const cpuBound = cpu >= 60;
    out.push({
      id: 'event-loop-blocked',
      severity: loopShare >= 0.5 ? 'critical' : 'warning',
      title: cpuBound ? 'Event loop blocked by CPU-heavy work' : 'Event loop stalls with low CPU',
      detail:
        `Loop delay p99 exceeded ${LOOP_BAD_MS} ms in ${pct(loopShare)} of the last 5 minutes ` +
        `(worst ${Math.round(worst)} ms) while CPU averaged ${Math.round(cpu)}%.`,
      hint: cpuBound
        ? 'Synchronous JS (JSON, regex, loops, crypto) is hogging the thread. Record a CPU profile.'
        : 'Low CPU with a stalled loop points to blocking calls (sync fs, execSync, DNS) or GC. Check GC pauses and sync APIs.',
      view: cpuBound ? 'profiler' : 'runtime',
    });
  }

  // Leak suspect: reuse the existing heap-floor trend.
  if (heapTrend?.suspect) {
    out.push({
      id: 'memory-leak',
      severity: 'warning',
      title: 'Heap keeps growing: possible memory leak',
      detail:
        `The post-GC heap floor rose from ${heapTrend.floorStartMb.toFixed(0)} MB to ` +
        `${heapTrend.floorEndMb.toFixed(0)} MB (${heapTrend.slopeMbPerMin.toFixed(1)} MB/min).`,
      hint: 'Take two heap snapshots a few minutes apart and compare retained objects.',
      view: 'runtime',
    });
  }

  // GC pressure: time spent collecting, or a single long pause.
  const gcMs = points.reduce((a, p) => a + p.gcMs, 0);
  const gcShare = gcMs / (points.length * stepSeconds * 1000);
  const gcPause = Math.max(...points.map((p) => p.gcMaxMs ?? 0));
  if (gcShare >= GC_SHARE_BAD || gcPause >= GC_PAUSE_BAD_MS) {
    out.push({
      id: 'gc-pressure',
      severity: gcShare >= GC_SHARE_BAD * 2 ? 'critical' : 'warning',
      title: 'Garbage collection is costing real time',
      detail:
        `GC took ${pct(gcShare)} of wall time; longest pause ${Math.round(gcPause)} ms. ` +
        'Pauses stall every request.',
      hint: 'Reduce allocation churn (big temporary arrays/strings, per-request objects) or check for a growing heap.',
      view: 'runtime',
    });
  }

  // Resource growth: handles/timers that only ever climb.
  const withHandles = points.filter((p) => (p.handles ?? 0) > 0);
  if (withHandles.length >= MIN_POINTS) {
    const q = Math.max(1, Math.floor(withHandles.length / 4));
    const early = avg(withHandles.slice(0, q).map((p) => p.handles));
    const late = avg(withHandles.slice(-q).map((p) => p.handles));
    if (late - early >= 50 && late >= early * 1.5) {
      const timers = withHandles[withHandles.length - 1]?.timers ?? 0;
      out.push({
        id: 'handle-growth',
        severity: 'warning',
        title: 'Active handles keep climbing',
        detail: `Open resources grew from ~${Math.round(early)} to ~${Math.round(late)} (${timers} timers).`,
        hint: 'Likely leaked sockets, timers or unclosed streams: look for missing clearInterval, destroy() or agent reuse.',
        view: 'runtime',
      });
    }
  }

  const reqs = points.reduce((a, p) => a + p.requests, 0);
  if (reqs >= MIN_REQUESTS) {
    const errs = points.reduce((a, p) => a + p.errors, 0);
    if (errs / reqs >= 0.05) {
      out.push({
        id: 'error-rate',
        severity: errs / reqs >= 0.2 ? 'critical' : 'warning',
        title: 'Elevated 5xx error rate',
        detail: `${errs} of ${reqs} requests (${pct(errs / reqs)}) failed with 5xx.`,
        hint: 'Group by fingerprint in Errors, then open a failing request for its timeline.',
        view: 'errors',
      });
    }

    // Slow but idle: the app is waiting on something outside the process.
    const slow = points.filter((p) => p.requests > 0 && p.p95 >= 500);
    const slowShare = slow.length / points.length;
    if (slowShare >= 0.3 && !out.some((f) => f.id === 'event-loop-blocked')) {
      const cpu = avg(slow.map((p) => p.cpu));
      if (cpu < 50) {
        out.push({
          id: 'slow-io',
          severity: 'warning',
          title: 'Slow requests while the process is idle',
          detail: `p95 was above 500 ms in ${pct(slowShare)} of windows but CPU averaged only ${Math.round(cpu)}%.`,
          hint: 'Time is spent waiting on a database, cache or upstream API. Check Queries and Outgoing.',
          view: 'outgoing',
        });
      }
    }
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const status = out.some((f) => f.severity === 'critical')
    ? 'critical'
    : out.length > 0
      ? 'warning'
      : 'ok';
  return { status, windowSeconds: WINDOW_SECONDS, findings: out };
}

export interface DiagnoseOptions {
  /** Recent history source (the time-series provider). */
  history: (windowSeconds: number, maxPoints: number) => DiagnoseInput;
}

export class DiagnoseProvider implements NodeUIProvider<DiagnoseData> {
  readonly id = 'diagnose' as const;

  constructor(private readonly options: DiagnoseOptions) {}

  get(): { ok: true; data: DiagnoseData } {
    return { ok: true, data: diagnose(this.options.history(WINDOW_SECONDS, MAX_POINTS)) };
  }
}
