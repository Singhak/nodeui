import { fetchPanel, PanelError, type ServiceTarget } from './targets';

/** The subset of a run/window summary the checks read. */
export interface CheckSummary {
  requests: number;
  errors5xx: number;
  avgRps: number;
  p50: number;
  p95: number;
  p99: number;
  loopP99: number;
  rssPeak: number;
}

export interface CheckLimits {
  maxP50?: number;
  maxP95?: number;
  maxP99?: number;
  /** Percent of requests that returned 5xx. */
  maxErrorRate?: number;
  minRps?: number;
  maxLoopP99?: number;
  maxRssMb?: number;
  /** Allowed regression against the baseline run, in percent (p99 up / throughput down). */
  maxRegression?: number;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  text: string;
}

const MB = 1024 * 1024;
const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

/** Compares a summary with the limits (and optionally a baseline). Pure, so it is easy to test. */
export function evaluateChecks(
  s: CheckSummary,
  limits: CheckLimits,
  baseline?: CheckSummary | null,
): { passed: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const upper = (
    name: string,
    label: string,
    actual: number,
    limit: number | undefined,
    unit: string,
  ) => {
    if (limit === undefined) return;
    const ok = actual <= limit;
    results.push({
      name,
      ok,
      text: `${label} ${fmt(actual)} ${unit} ${ok ? '<=' : '>'} ${fmt(limit)} ${unit}`,
    });
  };
  upper('p50', 'p50', s.p50, limits.maxP50, 'ms');
  upper('p95', 'p95', s.p95, limits.maxP95, 'ms');
  upper('p99', 'p99', s.p99, limits.maxP99, 'ms');
  upper(
    'errorRate',
    'error rate',
    s.requests > 0 ? (s.errors5xx / s.requests) * 100 : 0,
    limits.maxErrorRate,
    '%',
  );
  upper('loopP99', 'event loop p99', s.loopP99, limits.maxLoopP99, 'ms');
  upper('rss', 'RSS', s.rssPeak / MB, limits.maxRssMb, 'MB');
  if (limits.minRps !== undefined) {
    const ok = s.avgRps >= limits.minRps;
    results.push({
      name: 'rps',
      ok,
      text: `throughput ${fmt(s.avgRps)} req/s ${ok ? '>=' : '<'} ${fmt(limits.minRps)} req/s`,
    });
  }
  if (limits.maxRegression !== undefined) {
    if (!baseline) {
      results.push({
        name: 'regression',
        ok: false,
        text: 'no baseline run is pinned to compare with',
      });
    } else {
      const allowed = limits.maxRegression / 100;
      const p99Up = baseline.p99 > 0 ? (s.p99 - baseline.p99) / baseline.p99 : 0;
      const rpsDown = baseline.avgRps > 0 ? (baseline.avgRps - s.avgRps) / baseline.avgRps : 0;
      results.push({
        name: 'p99-regression',
        ok: p99Up <= allowed,
        text: `p99 ${p99Up >= 0 ? '+' : ''}${fmt(p99Up * 100)}% vs baseline (allowed +${fmt(limits.maxRegression)}%)`,
      });
      results.push({
        name: 'rps-regression',
        ok: rpsDown <= allowed,
        text: `throughput ${rpsDown <= 0 ? '+' : '-'}${fmt(Math.abs(rpsDown) * 100)}% vs baseline (allowed -${fmt(limits.maxRegression)}%)`,
      });
    }
  }
  return { passed: results.every((r) => r.ok), results };
}

interface RunLike {
  id: number;
  name: string;
  summary: CheckSummary;
}

export interface CheckOptions {
  target: ServiceTarget;
  limits: CheckLimits;
  /** A run name, or `latest`; omit to check the last `windowSeconds`. */
  run?: string;
  windowSeconds?: number;
  log?: (line: string) => void;
}

/** Exit codes: 0 pass, 1 a limit failed, 2 nothing to check (no traffic / unreachable). */
export async function runCheck(options: CheckOptions): Promise<number> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  let summary: CheckSummary;
  let baseline: CheckSummary | null = null;
  let label: string;
  try {
    if (options.run !== undefined) {
      const data = await fetchPanel<{ runs: RunLike[]; baselineId: number | null }>(
        options.target,
        'runs',
      );
      const run =
        options.run === 'latest' ? data.runs[0] : data.runs.find((r) => r.name === options.run);
      if (!run) {
        log(`no saved run named "${options.run}"`);
        return 2;
      }
      summary = run.summary;
      label = `run "${run.name}"`;
      const base = data.runs.find((r) => r.id === data.baselineId && r.id !== run.id);
      baseline = base?.summary ?? null;
    } else {
      const seconds = options.windowSeconds ?? 300;
      const data = await fetchPanel<{ summary: CheckSummary }>(
        options.target,
        `timeseries?range=${seconds * 1000}&points=10`,
      );
      summary = data.summary;
      label = `the last ${seconds}s`;
    }
  } catch (err) {
    log(err instanceof PanelError ? err.message : String(err));
    return 2;
  }
  if (summary.requests === 0) {
    log(`no requests were recorded for ${label}; nothing to check`);
    return 2;
  }
  const { passed, results } = evaluateChecks(summary, options.limits, baseline);
  if (results.length === 0) {
    log('no limits given; pass e.g. --max-p99 300 or --max-error-rate 1');
    return 2;
  }
  log(`Checking ${label} (${summary.requests.toLocaleString('en-US')} requests)`);
  for (const r of results) log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.text}`);
  log(passed ? 'All checks passed.' : 'Some checks failed.');
  return passed ? 0 : 1;
}
