import {
  monitorEventLoopDelay,
  PerformanceObserver,
  type IntervalHistogram,
} from 'node:perf_hooks';
import type {
  BenchRun,
  BenchRunSummary,
  NodeUIProvider,
  ProviderContext,
  TimeSeriesData,
  TimeSeriesPoint,
} from '../types';

/** Latency histogram: log-spaced buckets, 0.1ms .. ~80s, ~7% worst-case error. */
export const HIST_BUCKETS = 100;
const HIST_BASE_MS = 0.1;
const HIST_FACTOR = 1.15;
const LOG_FACTOR = Math.log(HIST_FACTOR);

const FINE_STEP_S = 1;
const FINE_SLOTS = 3600; // 1 hour at 1s
const COARSE_STEP_S = 10;
const COARSE_SLOTS = 2880; // 8 hours at 10s
const LOOP_RESOLUTION_MS = 10;
const MAX_RUNS = 20;
const RUN_POINTS = 120;
const SUSPEND_GAP_MS = 5000;

export function bucketIndex(ms: number): number {
  if (!(ms > HIST_BASE_MS)) return 0;
  return Math.min(HIST_BUCKETS - 1, Math.ceil(Math.log(ms / HIST_BASE_MS) / LOG_FACTOR));
}

export function bucketUpperMs(i: number): number {
  return HIST_BASE_MS * HIST_FACTOR ** i;
}

/** Estimates the `p` quantile (0..1) of a histogram; clamped to the observed max. */
export function histQuantile(
  hist: ArrayLike<number>,
  total: number,
  p: number,
  maxMs: number,
): number {
  if (total <= 0) return 0;
  const target = Math.max(1, Math.ceil(p * total));
  let cum = 0;
  for (let i = 0; i < HIST_BUCKETS; i += 1) {
    cum += hist[i] as number;
    if (cum >= target) {
      const upper = bucketUpperMs(i);
      const lower = i === 0 ? 0 : bucketUpperMs(i - 1);
      const mid = i === 0 ? upper : Math.sqrt(lower * upper);
      return Math.min(mid, maxMs);
    }
  }
  return maxMs;
}

/** One time slot of aggregated telemetry (counters, histogram, sampled gauges). */
class Slot {
  sec = -1;
  req = 0;
  err5 = 0;
  err4 = 0;
  bytesIn = 0;
  bytesOut = 0;
  sumMs = 0;
  maxMs = 0;
  inflightMax = 0;
  gcCount = 0;
  gcMs = 0;
  hist = new Uint32Array(HIST_BUCKETS);
  // gauges (valid when `sampled`)
  sampled = 0;
  loopP50 = 0;
  loopP99 = 0;
  loopMax = 0;
  heapUsed = 0;
  heapTotal = 0;
  rss = 0;
  cpu = 0;

  reset(sec: number): void {
    this.sec = sec;
    this.req = this.err5 = this.err4 = 0;
    this.bytesIn = this.bytesOut = 0;
    this.sumMs = this.maxMs = 0;
    this.inflightMax = 0;
    this.gcCount = this.gcMs = 0;
    this.hist.fill(0);
    this.sampled = 0;
    this.loopP50 = this.loopP99 = this.loopMax = 0;
    this.heapUsed = this.heapTotal = this.rss = this.cpu = 0;
  }
}

/** Accumulates slots into one output window. */
export class Acc {
  slots = 0;
  sampledSlots = 0;
  req = 0;
  err5 = 0;
  err4 = 0;
  bytesIn = 0;
  bytesOut = 0;
  sumMs = 0;
  maxMs = 0;
  inflightMax = 0;
  gcCount = 0;
  gcMs = 0;
  hist = new Float64Array(HIST_BUCKETS);
  loopP50Sum = 0;
  loopP99 = 0;
  loopMax = 0;
  heapUsed = 0;
  heapTotal = 0;
  rss = 0;
  rssPeak = 0;
  heapPeak = 0;
  cpuSum = 0;
  cpuPeak = 0;
  peakReq = 0;
  peakReqSlotSeconds = FINE_STEP_S;

  add(s: Slot, slotSeconds: number): void {
    this.slots += 1;
    this.req += s.req;
    this.err5 += s.err5;
    this.err4 += s.err4;
    this.bytesIn += s.bytesIn;
    this.bytesOut += s.bytesOut;
    this.sumMs += s.sumMs;
    if (s.maxMs > this.maxMs) this.maxMs = s.maxMs;
    if (s.inflightMax > this.inflightMax) this.inflightMax = s.inflightMax;
    this.gcCount += s.gcCount;
    this.gcMs += s.gcMs;
    for (let i = 0; i < HIST_BUCKETS; i += 1)
      this.hist[i] = (this.hist[i] as number) + (s.hist[i] as number);
    const rate = s.req / slotSeconds;
    if (rate > this.peakReq / this.peakReqSlotSeconds) {
      this.peakReq = s.req;
      this.peakReqSlotSeconds = slotSeconds;
    }
    if (s.sampled > 0) {
      this.sampledSlots += 1;
      this.loopP50Sum += s.loopP50;
      if (s.loopP99 > this.loopP99) this.loopP99 = s.loopP99;
      if (s.loopMax > this.loopMax) this.loopMax = s.loopMax;
      this.heapUsed = s.heapUsed;
      this.heapTotal = s.heapTotal;
      this.rss = s.rss;
      if (s.rss > this.rssPeak) this.rssPeak = s.rss;
      if (s.heapUsed > this.heapPeak) this.heapPeak = s.heapUsed;
      this.cpuSum += s.cpu;
      if (s.cpu > this.cpuPeak) this.cpuPeak = s.cpu;
    }
  }

  q(p: number): number {
    return histQuantile(this.hist, this.req, p, this.maxMs);
  }

  peakRps(): number {
    return this.peakReq / this.peakReqSlotSeconds;
  }
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function toPoint(t: number, windowSeconds: number, a: Acc): TimeSeriesPoint {
  const secs = Math.max(1, windowSeconds);
  const sampled = Math.max(1, a.sampledSlots);
  return {
    t,
    requests: a.req,
    rps: round(a.req / secs),
    errors: a.err5,
    errors4xx: a.err4,
    errorRate: a.req > 0 ? a.err5 / a.req : 0,
    p50: round(a.q(0.5)),
    p90: round(a.q(0.9)),
    p95: round(a.q(0.95)),
    p99: round(a.q(0.99)),
    maxMs: round(a.maxMs),
    avgMs: a.req > 0 ? round(a.sumMs / a.req) : 0,
    inflight: a.inflightMax,
    bytesInPerSec: Math.round(a.bytesIn / secs),
    bytesOutPerSec: Math.round(a.bytesOut / secs),
    loopP50: round(a.loopP50Sum / sampled),
    loopP99: round(a.loopP99),
    loopMax: round(a.loopMax),
    heapUsed: a.heapUsed,
    heapTotal: a.heapTotal,
    rss: a.rss,
    cpu: round(a.cpuSum / sampled),
    gcCount: a.gcCount,
    gcMs: round(a.gcMs),
  };
}

export interface TimeSeriesOptions {
  /** Injectable wall clock (ms) for tests. */
  nowMs?: () => number;
  /** Disable the background gauge sampler (tests drive `tick()` manually). */
  manualTick?: boolean;
}

export interface TimeSeriesQuery {
  fromMs: number;
  toMs: number;
  maxPoints: number;
}

/**
 * Always-on, bounded metrics history: per-second slots for the last hour and
 * ten-second slots for the last eight hours. Latency is kept as a mergeable
 * log-bucket histogram, so percentiles stay correct at any zoom level.
 */
export class TimeSeriesProvider implements NodeUIProvider<TimeSeriesData> {
  readonly id = 'timeseries' as const;

  private readonly now: () => number;
  private readonly manualTick: boolean;
  private readonly fine: Slot[] = Array.from({ length: FINE_SLOTS }, () => new Slot());
  private readonly coarse: Slot[] = Array.from({ length: COARSE_SLOTS }, () => new Slot());
  private lastMergedSec = -1;
  private inflight = 0;
  private timer: NodeJS.Timeout | null = null;
  private loop: IntervalHistogram | null = null;
  private gcObserver: PerformanceObserver | null = null;
  private lastCpu: { user: number; system: number; atUs: number } | null = null;
  private lastTickMs = 0;
  private pendingGcCount = 0;
  private pendingGcMs = 0;
  private readonly startedAtMs: number;

  // lifetime totals (Prometheus + UI counters)
  totalRequests = 0;
  totalErrors5xx = 0;
  totalErrors4xx = 0;
  totalBytesIn = 0;
  totalBytesOut = 0;
  totalDurationMs = 0;
  readonly lifetimeHist = new Float64Array(HIST_BUCKETS);

  private readonly runs: BenchRun[] = [];
  private activeRun: { id: number; name: string; startMs: number } | null = null;
  private nextRunId = 1;

  constructor(options: TimeSeriesOptions = {}) {
    this.now = options.nowMs ?? Date.now;
    this.manualTick = options.manualTick ?? false;
    this.startedAtMs = this.now();
  }

  // ---- recording -----------------------------------------------------------

  private slotFor(ms: number): Slot {
    const sec = Math.floor(ms / 1000);
    const slot = this.fine[sec % FINE_SLOTS] as Slot;
    if (slot.sec !== sec) slot.reset(sec);
    return slot;
  }

  /** A request began. Tracks concurrency. */
  requestStarted(): void {
    this.inflight += 1;
    const slot = this.slotFor(this.now());
    if (this.inflight > slot.inflightMax) slot.inflightMax = this.inflight;
  }

  /** A request ended without a normal finish (client abort). */
  requestAborted(): void {
    if (this.inflight > 0) this.inflight -= 1;
  }

  /** A request finished normally. */
  requestFinished(status: number, durationMs: number, bytesIn: number, bytesOut: number): void {
    if (this.inflight > 0) this.inflight -= 1;
    const slot = this.slotFor(this.now());
    slot.req += 1;
    if (status >= 500) slot.err5 += 1;
    else if (status >= 400) slot.err4 += 1;
    slot.bytesIn += bytesIn;
    slot.bytesOut += bytesOut;
    slot.sumMs += durationMs;
    if (durationMs > slot.maxMs) slot.maxMs = durationMs;
    const bi = bucketIndex(durationMs);
    slot.hist[bi] = (slot.hist[bi] as number) + 1;

    this.totalRequests += 1;
    if (status >= 500) this.totalErrors5xx += 1;
    else if (status >= 400) this.totalErrors4xx += 1;
    this.totalBytesIn += bytesIn;
    this.totalBytesOut += bytesOut;
    this.totalDurationMs += durationMs;
    this.lifetimeHist[bi] = (this.lifetimeHist[bi] as number) + 1;
  }

  /** Samples gauges into the current slot and rolls finished seconds into the coarse tier. */
  tick(): void {
    const nowMs = this.now();
    const slot = this.slotFor(nowMs);

    if (this.loop) {
      // The histogram reports timer period + lag, so subtract the period. Timers
      // are coarser on some platforms (~16ms on Windows), which shows as a small
      // idle baseline. A tick gap this long means the machine slept: not lag.
      const floor = LOOP_RESOLUTION_MS;
      const toMs = (ns: number): number => Math.max(0, ns / 1e6 - floor);
      const p50 = toMs(this.loop.percentile(50));
      const p99 = toMs(this.loop.percentile(99));
      const max = toMs(this.loop.max);
      this.loop.reset();
      if (nowMs - this.lastTickMs <= SUSPEND_GAP_MS) {
        slot.loopP50 = Math.max(slot.loopP50, p50);
        slot.loopP99 = Math.max(slot.loopP99, p99);
        slot.loopMax = Math.max(slot.loopMax, max);
      }
    }
    this.lastTickMs = nowMs;
    const mem = process.memoryUsage();
    slot.heapUsed = mem.heapUsed;
    slot.heapTotal = mem.heapTotal;
    slot.rss = mem.rss;

    const usage = process.cpuUsage();
    const atUs = Number(process.hrtime.bigint() / 1000n);
    if (this.lastCpu && atUs > this.lastCpu.atUs) {
      const busyUs = usage.user + usage.system - this.lastCpu.user - this.lastCpu.system;
      slot.cpu = Math.min(100, Math.max(0, (busyUs / (atUs - this.lastCpu.atUs)) * 100));
    }
    this.lastCpu = { user: usage.user, system: usage.system, atUs };

    slot.gcCount += this.pendingGcCount;
    slot.gcMs += this.pendingGcMs;
    this.pendingGcCount = 0;
    this.pendingGcMs = 0;
    slot.sampled = 1;

    this.rollCoarse(Math.floor(nowMs / 1000));
  }

  /** Merges every completed fine slot (< `currentSec`) into the coarse tier. */
  private rollCoarse(currentSec: number): void {
    const first = this.lastMergedSec < 0 ? currentSec - 1 : this.lastMergedSec + 1;
    const from = Math.max(first, currentSec - FINE_SLOTS + 1);
    for (let sec = from; sec < currentSec; sec += 1) {
      const fine = this.fine[sec % FINE_SLOTS] as Slot;
      if (fine.sec !== sec) continue;
      const csec = Math.floor(sec / COARSE_STEP_S);
      const slot = this.coarse[csec % COARSE_SLOTS] as Slot;
      if (slot.sec !== csec) slot.reset(csec);
      slot.req += fine.req;
      slot.err5 += fine.err5;
      slot.err4 += fine.err4;
      slot.bytesIn += fine.bytesIn;
      slot.bytesOut += fine.bytesOut;
      slot.sumMs += fine.sumMs;
      if (fine.maxMs > slot.maxMs) slot.maxMs = fine.maxMs;
      if (fine.inflightMax > slot.inflightMax) slot.inflightMax = fine.inflightMax;
      slot.gcCount += fine.gcCount;
      slot.gcMs += fine.gcMs;
      for (let i = 0; i < HIST_BUCKETS; i += 1) {
        slot.hist[i] = (slot.hist[i] as number) + (fine.hist[i] as number);
      }
      if (fine.sampled > 0) {
        const n = slot.sampled;
        slot.loopP50 = (slot.loopP50 * n + fine.loopP50) / (n + 1);
        slot.cpu = (slot.cpu * n + fine.cpu) / (n + 1);
        slot.sampled = n + 1;
        if (fine.loopP99 > slot.loopP99) slot.loopP99 = fine.loopP99;
        if (fine.loopMax > slot.loopMax) slot.loopMax = fine.loopMax;
        slot.heapUsed = fine.heapUsed;
        slot.heapTotal = fine.heapTotal;
        slot.rss = fine.rss;
      }
      this.lastMergedSec = sec;
    }
    if (currentSec - 1 > this.lastMergedSec) this.lastMergedSec = currentSec - 1;
  }

  // ---- queries -------------------------------------------------------------

  /** Aggregates a time range into `maxPoints` (or fewer) evenly sized windows. */
  query(q: TimeSeriesQuery): { stepMs: number; points: TimeSeriesPoint[]; total: Acc } {
    const nowSec = Math.floor(this.now() / 1000);
    const fromSec = Math.floor(q.fromMs / 1000);
    const toSec = Math.min(Math.floor(q.toMs / 1000), nowSec);
    const useFine = fromSec > nowSec - FINE_SLOTS + 1;
    const tier = useFine ? this.fine : this.coarse;
    const tierSeconds = useFine ? FINE_STEP_S : COARSE_STEP_S;
    const slotCount = useFine ? FINE_SLOTS : COARSE_SLOTS;

    const spanSeconds = Math.max(1, toSec - fromSec + 1);
    const wantStep = Math.ceil(spanSeconds / Math.max(1, q.maxPoints));
    const stepSeconds = Math.max(tierSeconds, Math.ceil(wantStep / tierSeconds) * tierSeconds);

    const total = new Acc();
    const points: TimeSeriesPoint[] = [];
    let cur: Acc | null = null;
    let curStart = -1;
    const flush = (): void => {
      if (cur && cur.slots > 0) {
        points.push(toPoint(curStart * 1000, cur.slots * tierSeconds, cur));
      }
    };

    const firstIdx = Math.floor(fromSec / tierSeconds);
    const lastIdx = Math.floor(toSec / tierSeconds);
    for (let idx = firstIdx; idx <= lastIdx; idx += 1) {
      const slot = tier[idx % slotCount] as Slot;
      if (slot.sec !== idx) continue;
      const windowStart = Math.floor((idx * tierSeconds) / stepSeconds) * stepSeconds;
      if (windowStart !== curStart) {
        flush();
        cur = new Acc();
        curStart = windowStart;
      }
      (cur as Acc).add(slot, tierSeconds);
      total.add(slot, tierSeconds);
    }
    flush();
    return { stepMs: stepSeconds * 1000, points, total };
  }

  // ---- runs ----------------------------------------------------------------

  private summarize(startMs: number, endMs: number): BenchRunSummary {
    const { total, points } = this.query({ fromMs: startMs, toMs: endMs, maxPoints: 100000 });
    return this.summarizeAcc(total, startMs, endMs, points.length);
  }

  private summarizeAcc(
    total: Acc,
    fromMs: number,
    endMs: number,
    pointCount: number,
  ): BenchRunSummary {
    const startMs = Math.max(fromMs, this.startedAtMs);
    const durationSec = Math.max(1, (endMs - startMs) / 1000);
    const sampled = Math.max(1, total.sampledSlots);
    return {
      durationSec: round(durationSec, 1),
      requests: total.req,
      errors5xx: total.err5,
      errors4xx: total.err4,
      avgRps: round(total.req / durationSec),
      peakRps: round(total.peakRps()),
      p50: round(total.q(0.5)),
      p90: round(total.q(0.9)),
      p95: round(total.q(0.95)),
      p99: round(total.q(0.99)),
      maxMs: round(total.maxMs),
      avgMs: total.req > 0 ? round(total.sumMs / total.req) : 0,
      bytesIn: total.bytesIn,
      bytesOut: total.bytesOut,
      mbPerSec: round((total.bytesIn + total.bytesOut) / durationSec / (1024 * 1024)),
      inflightMax: total.inflightMax,
      loopP50: round(total.loopP50Sum / sampled),
      loopP99: round(total.loopP99),
      loopMax: round(total.loopMax),
      heapPeak: total.heapPeak,
      rssPeak: total.rssPeak,
      cpuAvg: round(total.cpuSum / sampled),
      cpuPeak: round(total.cpuPeak),
      gcMs: round(total.gcMs),
      pointCount,
    };
  }

  private buildRun(id: number, name: string, startMs: number, endMs: number): BenchRun {
    const { points } = this.query({ fromMs: startMs, toMs: endMs, maxPoints: RUN_POINTS });
    return { id, name, startMs, endMs, summary: this.summarize(startMs, endMs), points };
  }

  private addRun(run: BenchRun): BenchRun {
    this.runs.push(run);
    if (this.runs.length > MAX_RUNS) this.runs.splice(0, this.runs.length - MAX_RUNS);
    return run;
  }

  /** Starts recording a named run; any run already recording is stopped first. */
  startRun(name: string): { id: number; name: string; startMs: number } {
    if (this.activeRun) this.stopRun();
    this.tick();
    this.activeRun = {
      id: this.nextRunId,
      name: name || `Run ${this.nextRunId}`,
      startMs: this.now(),
    };
    this.nextRunId += 1;
    return this.activeRun;
  }

  stopRun(): BenchRun | null {
    const active = this.activeRun;
    if (!active) return null;
    this.activeRun = null;
    this.tick();
    return this.addRun(this.buildRun(active.id, active.name, active.startMs, this.now()));
  }

  /** Saves an already-recorded time range as a run (retroactive capture). */
  saveRange(name: string, startMs: number, endMs: number): BenchRun {
    const id = this.nextRunId;
    this.nextRunId += 1;
    return this.addRun(
      this.buildRun(id, name || `Run ${id}`, startMs, Math.min(endMs, this.now())),
    );
  }

  deleteRun(id: number): boolean {
    const i = this.runs.findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.runs.splice(i, 1);
    return true;
  }

  listRuns(): { active: { id: number; name: string; startMs: number } | null; runs: BenchRun[] } {
    return { active: this.activeRun, runs: [...this.runs].reverse() };
  }

  // ---- lifecycle -----------------------------------------------------------

  start(_ctx?: ProviderContext): void {
    if (this.timer || this.manualTick) return;
    try {
      this.loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
      this.loop.enable();
    } catch {
      this.loop = null;
    }
    try {
      this.gcObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          this.pendingGcCount += 1;
          this.pendingGcMs += e.duration;
        }
      });
      this.gcObserver.observe({ entryTypes: ['gc'] });
    } catch {
      this.gcObserver = null;
    }
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch {
        // sampling must never throw into the event loop
      }
    }, 1000);
    this.timer.unref();
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.loop?.disable();
    this.loop = null;
    this.gcObserver?.disconnect();
    this.gcObserver = null;
  }

  get(ctx?: ProviderContext): { ok: true; data: TimeSeriesData } {
    const params = ctx?.query ?? {};
    const nowMs = this.now();
    const toMs = clampNum(params.to, nowMs, 0, nowMs);
    const range = clampNum(params.range, 5 * 60_000, 1000, COARSE_SLOTS * COARSE_STEP_S * 1000);
    const fromMs = clampNum(params.from, toMs - range, 0, toMs);
    const maxPoints = clampNum(params.points, 240, 10, 1000);
    const { stepMs, points, total } = this.query({ fromMs, toMs, maxPoints });
    return {
      ok: true,
      data: {
        fromMs,
        toMs,
        stepMs,
        startedAtMs: this.startedAtMs,
        retentionMs: COARSE_SLOTS * COARSE_STEP_S * 1000,
        points,
        summary: this.summarizeAcc(total, fromMs, toMs, points.length),
        totals: {
          requests: this.totalRequests,
          errors5xx: this.totalErrors5xx,
          errors4xx: this.totalErrors4xx,
        },
        recording: this.activeRun,
      },
    };
  }

  // ---- prometheus ----------------------------------------------------------

  /** Prometheus text exposition (v0.0.4) for scraping the console from a local Grafana. */
  prometheus(extra: { uptimeSeconds: number }): string {
    const lines: string[] = [];
    const metric = (name: string, type: string, help: string, value: number): void => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${value}`);
    };
    metric('nodeui_http_requests_total', 'counter', 'HTTP requests served.', this.totalRequests);
    metric('nodeui_http_errors_total', 'counter', 'HTTP 5xx responses.', this.totalErrors5xx);
    metric(
      'nodeui_http_client_errors_total',
      'counter',
      'HTTP 4xx responses.',
      this.totalErrors4xx,
    );
    metric(
      'nodeui_http_request_bytes_total',
      'counter',
      'Bytes read from clients.',
      this.totalBytesIn,
    );
    metric(
      'nodeui_http_response_bytes_total',
      'counter',
      'Bytes written to clients.',
      this.totalBytesOut,
    );
    metric(
      'nodeui_http_inflight_requests',
      'gauge',
      'Requests currently in flight.',
      this.inflight,
    );

    const les = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    lines.push(
      '# HELP nodeui_http_request_duration_seconds Request latency (approximate buckets).',
      '# TYPE nodeui_http_request_duration_seconds histogram',
    );
    for (const le of les) {
      let cum = 0;
      for (let i = 0; i < HIST_BUCKETS; i += 1) {
        if (bucketUpperMs(i) <= le * 1000) cum += this.lifetimeHist[i] as number;
      }
      lines.push(`nodeui_http_request_duration_seconds_bucket{le="${le}"} ${cum}`);
    }
    lines.push(
      `nodeui_http_request_duration_seconds_bucket{le="+Inf"} ${this.totalRequests}`,
      `nodeui_http_request_duration_seconds_sum ${this.totalDurationMs / 1000}`,
      `nodeui_http_request_duration_seconds_count ${this.totalRequests}`,
    );

    const mem = process.memoryUsage();
    metric('nodeui_process_resident_memory_bytes', 'gauge', 'Resident set size.', mem.rss);
    metric('nodeui_process_heap_used_bytes', 'gauge', 'V8 heap used.', mem.heapUsed);
    metric('nodeui_process_heap_total_bytes', 'gauge', 'V8 heap total.', mem.heapTotal);
    const cpu = process.cpuUsage();
    metric(
      'nodeui_process_cpu_seconds_total',
      'counter',
      'CPU time used.',
      (cpu.user + cpu.system) / 1e6,
    );
    metric('nodeui_process_uptime_seconds', 'gauge', 'Process uptime.', extra.uptimeSeconds);
    const last = this.latestGauges();
    metric(
      'nodeui_eventloop_lag_p99_seconds',
      'gauge',
      'Event loop delay p99 (last second).',
      last.loopP99 / 1000,
    );
    metric(
      'nodeui_eventloop_lag_max_seconds',
      'gauge',
      'Event loop delay max (last second).',
      last.loopMax / 1000,
    );
    return `${lines.join('\n')}\n`;
  }

  private latestGauges(): { loopP99: number; loopMax: number } {
    const sec = Math.floor(this.now() / 1000);
    for (let s = sec; s > sec - 3; s -= 1) {
      const slot = this.fine[s % FINE_SLOTS] as Slot;
      if (slot.sec === s && slot.sampled > 0)
        return { loopP99: slot.loopP99, loopMax: slot.loopMax };
    }
    return { loopP99: 0, loopMax: 0 };
  }
}

function clampNum(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
