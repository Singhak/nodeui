import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import type { HeapTrend, TimeSeriesData, TimeSeriesPoint } from '../src/types';
import { defaultPayloads, json, resetEnv, stubApi } from './fixtures';

const NOW = 1_700_000_000_000;

const point = (i: number): TimeSeriesPoint => ({
  t: NOW + i * 1000,
  requests: 10,
  rps: 10,
  errors: 0,
  errors4xx: 0,
  errorRate: 0,
  p50: 5,
  p90: 8,
  p95: 9,
  p99: 12,
  maxMs: 20,
  avgMs: 6,
  inflight: 1,
  bytesInPerSec: 0,
  bytesOutPerSec: 100,
  loopP50: 1,
  loopP99: 2,
  loopMax: 3,
  heapUsed: 30e6,
  heapTotal: 50e6,
  rss: 100e6,
  cpu: 5,
  gcCount: 0,
  gcMs: 0,
});

let trend: HeapTrend;

function stub(): void {
  const payloads = defaultPayloads();
  (payloads['/config'] as { panels: string[] }).panels.push('timeseries');
  const base = stubApi(payloads);
  const summary = {
    durationSec: 5,
    requests: 60,
    errors5xx: 0,
    errors4xx: 0,
    avgRps: 10,
    peakRps: 10,
    p50: 5,
    p90: 8,
    p95: 9,
    p99: 12,
    maxMs: 20,
    avgMs: 6,
    bytesIn: 0,
    bytesOut: 600,
    mbPerSec: 0,
    inflightMax: 1,
    loopP50: 1,
    loopP99: 2,
    loopMax: 3,
    heapPeak: 30e6,
    rssPeak: 100e6,
    cpuAvg: 5,
    cpuPeak: 6,
    gcMs: 0,
    pointCount: 6,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/timeseries')) {
        const data: TimeSeriesData = {
          fromMs: NOW,
          toMs: NOW + 5000,
          stepMs: 1000,
          startedAtMs: NOW,
          retentionMs: 1,
          points: Array.from({ length: 6 }, (_, i) => point(i)),
          summary,
          totals: { requests: 60, errors5xx: 0, errors4xx: 0 },
          recording: null,
          heapTrend: trend,
        };
        return json({ ok: true, data });
      }
      return base(input, init);
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal('EventSource', undefined);
  resetEnv('#/metrics');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base: HeapTrend = {
  windowMs: 20 * 60_000,
  slopeMbPerMin: 0.1,
  floorStartMb: 50,
  floorEndMb: 52,
  r2: 0.2,
  suspect: false,
  reason: 'heap is stable',
};

describe('Heap trend KPI', () => {
  it('warns about a possible leak with the slope and floor', async () => {
    trend = { ...base, slopeMbPerMin: 2.4, floorEndMb: 98, r2: 0.97, suspect: true };
    stub();
    render(<App />);
    const tile = await screen.findByTestId('heap-trend');
    expect(tile).toHaveTextContent('+2.4');
    expect(tile).toHaveTextContent('MB/min');
    expect(tile).toHaveTextContent('Possible leak');
    expect(tile).toHaveTextContent('floor 50 → 98 MB');
  });

  it('reads stable when the floor is flat', async () => {
    trend = base;
    stub();
    render(<App />);
    const tile = await screen.findByTestId('heap-trend');
    await waitFor(() => expect(within(tile).getByText('Stable')).toBeInTheDocument());
  });

  it('asks for more history on short windows', async () => {
    trend = { ...base, windowMs: 60_000, reason: 'needs at least 5 minutes of history' };
    stub();
    render(<App />);
    const tile = await screen.findByTestId('heap-trend');
    expect(tile).toHaveTextContent('needs at least 5 minutes of history');
    expect(tile).not.toHaveTextContent('MB/min');
  });
});
