import type {
  AlertEvent,
  AlertMetric,
  AlertRule,
  AlertRuleState,
  AlertsData,
  BenchRunSummary,
  NodeUIProvider,
} from '../types';

const EVAL_INTERVAL_MS = 1000;
const MAX_EVENTS = 100;
const MAX_RULES = 50;
const MIN_REQUESTS = 5;
const MB = 1024 * 1024;

/** Metrics a rule can watch, with how to read them from a window summary. */
export const ALERT_METRICS: Record<
  AlertMetric,
  { label: string; unit: string; needsTraffic: boolean; read: (s: BenchRunSummary) => number }
> = {
  p50: { label: 'Latency p50', unit: 'ms', needsTraffic: true, read: (s) => s.p50 },
  p95: { label: 'Latency p95', unit: 'ms', needsTraffic: true, read: (s) => s.p95 },
  p99: { label: 'Latency p99', unit: 'ms', needsTraffic: true, read: (s) => s.p99 },
  maxMs: { label: 'Latency max', unit: 'ms', needsTraffic: true, read: (s) => s.maxMs },
  errorRate: {
    label: 'Error rate (5xx)',
    unit: '%',
    needsTraffic: true,
    read: (s) => (s.requests > 0 ? (s.errors5xx / s.requests) * 100 : 0),
  },
  rps: { label: 'Throughput', unit: 'req/s', needsTraffic: false, read: (s) => s.avgRps },
  loopP99: { label: 'Event loop p99', unit: 'ms', needsTraffic: false, read: (s) => s.loopP99 },
  cpu: { label: 'CPU', unit: '%', needsTraffic: false, read: (s) => s.cpuAvg },
  heapMb: { label: 'Heap used', unit: 'MB', needsTraffic: false, read: (s) => s.heapPeak / MB },
  rssMb: { label: 'RSS', unit: 'MB', needsTraffic: false, read: (s) => s.rssPeak / MB },
};

export interface AlertRuleInput {
  name?: string;
  metric: AlertMetric;
  op?: '>' | '<';
  threshold: number;
  /** Seconds the condition must hold before the alert fires. Default 5. */
  forSeconds?: number;
  /** Look-back window the metric is computed over. Default 10. */
  windowSeconds?: number;
}

export interface AlertsOptions {
  /** Source of the recent-window summary (the time-series provider). */
  windowSummary: (seconds: number) => BenchRunSummary;
  nowMs?: () => number;
  /** Disable the background evaluator (tests call `evaluate()`). */
  manualTick?: boolean;
}

interface RuleRuntime {
  rule: AlertRule;
  state: AlertRuleState;
  value: number | null;
  /** When the current breach began (pending/firing). */
  breachSinceMs: number | null;
  /** When the current state began. */
  sinceMs: number;
}

export function validateRule(input: AlertRuleInput): AlertRuleInput {
  if (!input || typeof input !== 'object') throw new Error('rule must be an object');
  if (!(input.metric in ALERT_METRICS)) throw new Error(`unknown metric "${String(input.metric)}"`);
  if (typeof input.threshold !== 'number' || !Number.isFinite(input.threshold)) {
    throw new Error('threshold must be a number');
  }
  const op = input.op ?? '>';
  if (op !== '>' && op !== '<') throw new Error('op must be ">" or "<"');
  const forSeconds = input.forSeconds ?? 5;
  const windowSeconds = input.windowSeconds ?? 10;
  if (!Number.isFinite(forSeconds) || forSeconds < 0 || forSeconds > 3600) {
    throw new Error('forSeconds must be 0..3600');
  }
  if (!Number.isFinite(windowSeconds) || windowSeconds < 1 || windowSeconds > 600) {
    throw new Error('windowSeconds must be 1..600');
  }
  return { ...input, op, forSeconds, windowSeconds };
}

/**
 * Threshold alerts over the metrics history. Each rule watches one metric over a
 * short look-back window; it fires after the condition has held for
 * `forSeconds` and resolves as soon as it stops. Latency and error rules need a
 * handful of requests in the window, so an idle app never "breaches".
 */
export class AlertsProvider implements NodeUIProvider<AlertsData> {
  readonly id = 'alerts' as const;

  private readonly now: () => number;
  private readonly manualTick: boolean;
  private readonly summary: (seconds: number) => BenchRunSummary;
  private readonly rules: RuleRuntime[] = [];
  private readonly events: AlertEvent[] = [];
  private nextId = 1;
  private timer: NodeJS.Timeout | null = null;
  /** Called on every fired/resolved transition. */
  onEvent?: (event: AlertEvent) => void;

  constructor(options: AlertsOptions) {
    this.summary = options.windowSummary;
    this.now = options.nowMs ?? Date.now;
    this.manualTick = options.manualTick ?? false;
  }

  /** Adds a rule; `source: 'config'` rules cannot be removed from the UI. */
  addRule(input: AlertRuleInput, source: 'config' | 'ui' = 'ui'): AlertRule {
    if (this.rules.length >= MAX_RULES) throw new Error(`at most ${MAX_RULES} rules`);
    const v = validateRule(input);
    const meta = ALERT_METRICS[v.metric];
    const id = this.nextId;
    this.nextId += 1;
    const rule: AlertRule = {
      id,
      name: (v.name?.trim() || `${meta.label} ${v.op} ${v.threshold} ${meta.unit}`).slice(0, 80),
      metric: v.metric,
      op: v.op as '>' | '<',
      threshold: v.threshold,
      forSeconds: v.forSeconds as number,
      windowSeconds: v.windowSeconds as number,
      source,
    };
    this.rules.push({ rule, state: 'ok', value: null, breachSinceMs: null, sinceMs: this.now() });
    return rule;
  }

  removeRule(id: number): boolean {
    const i = this.rules.findIndex((r) => r.rule.id === id && r.rule.source === 'ui');
    if (i < 0) return false;
    this.rules.splice(i, 1);
    return true;
  }

  private record(rt: RuleRuntime, type: AlertEvent['type'], value: number, atMs: number): void {
    const event: AlertEvent = {
      ruleId: rt.rule.id,
      name: rt.rule.name,
      type,
      atMs,
      value: Math.round(value * 100) / 100,
      threshold: rt.rule.threshold,
      metric: rt.rule.metric,
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.onEvent?.(event);
  }

  /** Evaluates every rule once against the current windows. */
  evaluate(): void {
    const nowMs = this.now();
    const cache = new Map<number, BenchRunSummary>();
    for (const rt of this.rules) {
      const w = rt.rule.windowSeconds;
      let s = cache.get(w);
      if (!s) {
        s = this.summary(w);
        cache.set(w, s);
      }
      const meta = ALERT_METRICS[rt.rule.metric];
      const hasData = !meta.needsTraffic || s.requests >= MIN_REQUESTS;
      const value = hasData ? meta.read(s) : null;
      rt.value = value === null ? null : Math.round(value * 100) / 100;
      const breaching =
        value !== null &&
        (rt.rule.op === '>' ? value > rt.rule.threshold : value < rt.rule.threshold);

      if (breaching) {
        rt.breachSinceMs ??= nowMs;
        if (rt.state !== 'firing' && nowMs - rt.breachSinceMs >= rt.rule.forSeconds * 1000) {
          rt.state = 'firing';
          rt.sinceMs = nowMs;
          this.record(rt, 'fired', value, nowMs);
        } else if (rt.state === 'ok') {
          rt.state = 'pending';
          rt.sinceMs = nowMs;
        }
      } else {
        rt.breachSinceMs = null;
        if (rt.state === 'firing') {
          this.record(rt, 'resolved', value ?? 0, nowMs);
        }
        if (rt.state !== 'ok') {
          rt.state = 'ok';
          rt.sinceMs = nowMs;
        }
      }
    }
  }

  start(): void {
    if (this.timer || this.manualTick) return;
    this.timer = setInterval(() => this.evaluate(), EVAL_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get(): { ok: true; data: AlertsData } {
    return {
      ok: true,
      data: {
        rules: this.rules.map((rt) => ({
          ...rt.rule,
          state: rt.state,
          value: rt.value,
          sinceMs: rt.sinceMs,
        })),
        firing: this.rules.filter((rt) => rt.state === 'firing').length,
        events: [...this.events].reverse(),
        metrics: Object.entries(ALERT_METRICS).map(([id, m]) => ({
          id: id as AlertMetric,
          label: m.label,
          unit: m.unit,
        })),
      },
    };
  }
}
