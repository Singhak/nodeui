import { formatBytes } from './format';
import type { BenchRun, BenchRunSummary } from './types';

const num = (n: number, digits = 0): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Plain-text report of a run, in the familiar load-test summary layout. */
export function formatRunReport(run: Pick<BenchRun, 'name' | 'summary'>): string {
  const s = run.summary;
  return [
    `Run: ${run.name} (${s.durationSec}s)`,
    `📊 Total Requests:    ${num(s.requests)} reqs`,
    `⚡ Average Throughput: ${num(s.avgRps, 1)} req/sec (${s.mbPerSec.toFixed(2)} MB/s), peak ${num(s.peakRps)} req/sec`,
    `⏱️  Latency (p50):      ${s.p50.toFixed(2)} ms`,
    `⏱️  Latency (p90):      ${s.p90.toFixed(2)} ms`,
    `⏱️  Latency (p95):      ${s.p95.toFixed(2)} ms`,
    `⏱️  Latency (p99):      ${s.p99.toFixed(2)} ms (Critical for SLAs)`,
    `⏱️  Latency (max):      ${s.maxMs.toFixed(2)} ms`,
    `🚨 Errors:             ${num(s.errors5xx)} 5xx | ${num(s.errors4xx)} 4xx`,
    `🌀 Event Loop Delay:  p50: ${s.loopP50.toFixed(1)} ms | p99: ${s.loopP99.toFixed(1)} ms | max: ${s.loopMax.toFixed(1)} ms`,
    `🧮 Concurrency:        up to ${s.inflightMax} in flight`,
    `🔥 CPU:                avg ${s.cpuAvg.toFixed(0)}% | peak ${s.cpuPeak.toFixed(0)}%`,
    `🗑️  GC pause:           ${s.gcMs.toFixed(1)} ms total`,
    `💾 Memory Peak:        RSS: ${formatBytes(s.rssPeak)} | Heap: ${formatBytes(s.heapPeak)}`,
  ].join('\n');
}

export interface CompareRow {
  key: keyof BenchRunSummary;
  label: string;
  unit: string;
  /** Which direction is an improvement. */
  better: 'lower' | 'higher';
  digits: number;
}

export const COMPARE_ROWS: CompareRow[] = [
  { key: 'requests', label: 'Requests', unit: '', better: 'higher', digits: 0 },
  { key: 'avgRps', label: 'Avg throughput', unit: 'req/s', better: 'higher', digits: 1 },
  { key: 'peakRps', label: 'Peak throughput', unit: 'req/s', better: 'higher', digits: 0 },
  { key: 'p50', label: 'Latency p50', unit: 'ms', better: 'lower', digits: 2 },
  { key: 'p90', label: 'Latency p90', unit: 'ms', better: 'lower', digits: 2 },
  { key: 'p95', label: 'Latency p95', unit: 'ms', better: 'lower', digits: 2 },
  { key: 'p99', label: 'Latency p99', unit: 'ms', better: 'lower', digits: 2 },
  { key: 'maxMs', label: 'Latency max', unit: 'ms', better: 'lower', digits: 2 },
  { key: 'errors5xx', label: 'Errors (5xx)', unit: '', better: 'lower', digits: 0 },
  { key: 'loopP99', label: 'Event loop p99', unit: 'ms', better: 'lower', digits: 1 },
  { key: 'cpuAvg', label: 'CPU avg', unit: '%', better: 'lower', digits: 0 },
  { key: 'gcMs', label: 'GC pause total', unit: 'ms', better: 'lower', digits: 1 },
  { key: 'mbPerSec', label: 'Network', unit: 'MB/s', better: 'higher', digits: 2 },
];

export interface Delta {
  /** Relative change, e.g. -0.25 for 25% lower. `null` when the baseline is 0. */
  pct: number | null;
  verdict: 'better' | 'worse' | 'same';
}

/** Compares `current` against `baseline`; changes under 2% count as unchanged. */
export function compareValue(baseline: number, current: number, better: 'lower' | 'higher'): Delta {
  if (baseline === 0) {
    if (current === 0) return { pct: 0, verdict: 'same' };
    return { pct: null, verdict: better === 'higher' ? 'better' : 'worse' };
  }
  const pct = (current - baseline) / baseline;
  if (Math.abs(pct) < 0.02) return { pct, verdict: 'same' };
  const up = pct > 0;
  return { pct, verdict: up === (better === 'higher') ? 'better' : 'worse' };
}

export function formatDelta(d: Delta): string {
  if (d.pct === null) return 'new';
  const sign = d.pct > 0 ? '+' : '';
  return `${sign}${(d.pct * 100).toFixed(1)}%`;
}
