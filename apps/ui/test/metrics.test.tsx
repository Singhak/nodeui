import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { compareValue, formatDelta, formatRunReport } from '../src/report';
import type { BenchRun, BenchRunSummary, TimeSeriesData, TimeSeriesPoint } from '../src/types';
import { defaultPayloads, json, resetEnv, stubApi } from './fixtures';

const NOW = 1_700_000_000_000;

function point(i: number): TimeSeriesPoint {
  return {
    t: NOW + i * 1000,
    requests: 100,
    rps: 100,
    errors: i === 3 ? 4 : 0,
    errors4xx: 0,
    errorRate: 0,
    p50: 10,
    p90: 20,
    p95: 25,
    p99: 40 + i,
    maxMs: 90,
    avgMs: 12,
    inflight: 5,
    bytesInPerSec: 1000,
    bytesOutPerSec: 5000,
    loopP50: 1,
    loopP99: 4,
    loopMax: 9,
    heapUsed: 30e6,
    heapTotal: 50e6,
    rss: 120e6,
    cpu: 20,
    gcCount: 1,
    gcMs: 2,
  };
}

const summary = (over: Partial<BenchRunSummary> = {}): BenchRunSummary => ({
  durationSec: 10,
  requests: 3361,
  errors5xx: 0,
  errors4xx: 0,
  avgRps: 336.1,
  peakRps: 400,
  p50: 225,
  p90: 465,
  p95: 490,
  p99: 515,
  maxMs: 600,
  avgMs: 250,
  bytesIn: 1000,
  bytesOut: 900000,
  mbPerSec: 0.86,
  inflightMax: 100,
  loopP50: 20,
  loopP99: 35.3,
  loopMax: 50,
  heapPeak: 28.65 * 1024 * 1024,
  rssPeak: 128.76 * 1024 * 1024,
  cpuAvg: 95,
  cpuPeak: 100,
  gcMs: 40,
  pointCount: 10,
  ...over,
});

const run = (id: number, name: string, over: Partial<BenchRunSummary> = {}): BenchRun => ({
  id,
  name,
  startMs: NOW,
  endMs: NOW + 10_000,
  summary: summary(over),
  points: Array.from({ length: 5 }, (_, i) => point(i)),
});

const series: TimeSeriesData = {
  fromMs: NOW,
  toMs: NOW + 10_000,
  stepMs: 1000,
  startedAtMs: NOW - 5000,
  retentionMs: 8 * 3600_000,
  points: Array.from({ length: 6 }, (_, i) => point(i)),
  summary: summary(),
  totals: { requests: 5000, errors5xx: 4, errors4xx: 0 },
  recording: null,
  annotations: [{ id: 1, atMs: NOW + 2000, label: 'deployed v2', kind: 'app' }],
};

let runsPayload: { active: unknown; runs: BenchRun[] };

function stub(): ReturnType<typeof vi.fn> {
  const payloads = defaultPayloads();
  (payloads['/config'] as { panels: string[] }).panels.push('timeseries');
  const base = stubApi(payloads);
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/timeseries')) return json({ ok: true, data: series });
    if (url.includes('/api/annotations/')) return json({ ok: true, data: { id: 2 } });
    if (url.endsWith('/api/runs')) return json({ ok: true, data: runsPayload });
    if (url.includes('/api/runs/')) return json({ ok: true, data: { deleted: true } });
    return base(input, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.stubGlobal('EventSource', undefined);
  runsPayload = { active: null, runs: [] };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('report helpers', () => {
  it('formats a run like a load-test summary', () => {
    const text = formatRunReport({ name: 'before', summary: summary() });
    expect(text).toContain('Total Requests:    3,361 reqs');
    expect(text).toContain('Latency (p99):      515.00 ms (Critical for SLAs)');
    expect(text).toContain('RSS: 128.8 MB');
  });

  it('judges direction per metric and ignores noise', () => {
    expect(compareValue(100, 50, 'lower').verdict).toBe('better');
    expect(compareValue(100, 150, 'lower').verdict).toBe('worse');
    expect(compareValue(100, 150, 'higher').verdict).toBe('better');
    expect(compareValue(100, 101, 'lower').verdict).toBe('same');
    expect(compareValue(0, 5, 'lower')).toEqual({ pct: null, verdict: 'worse' });
    expect(formatDelta(compareValue(200, 150, 'lower'))).toBe('-25.0%');
  });
});

describe('Metrics view', () => {
  beforeEach(() => resetEnv('#/metrics'));

  it('renders KPIs and every chart panel from the history', async () => {
    stub();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Event loop lag')).toBeInTheDocument());
    for (const title of ['Throughput', 'Latency', 'Concurrency', 'Network', 'Memory', 'CPU']) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('group', { name: 'Time range' }).length).toBeGreaterThan(0);
    expect(screen.getByText('5,000 since start')).toBeInTheDocument();
  });

  it('draws annotation markers on the charts and adds a new one', async () => {
    const fn = stub();
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByText('Event loop lag')).toBeInTheDocument());
    await waitFor(() =>
      expect(container.querySelectorAll('.marker-app').length).toBeGreaterThan(0),
    );
    expect(container.querySelector('.marker-app title')?.textContent).toContain('deployed v2');
    fireEvent.change(screen.getByLabelText('Marker label'), { target: { value: 'cache on' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add marker' }));
    await waitFor(() =>
      expect(
        fn.mock.calls.some(
          (c) =>
            String(c[0]).endsWith('/annotations/add') &&
            String((c[1] as RequestInit).body).includes('"label":"cache on"'),
        ),
      ).toBe(true),
    );
  });

  it('switches range and requests that window', async () => {
    const fn = stub();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Event loop lag')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Last 1h' }));
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]).includes(`range=${3600_000}`))).toBe(true),
    );
  });

  it('saves the visible range as a run', async () => {
    const fn = stub();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Event loop lag')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'baseline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as run' }));
    await waitFor(() =>
      expect(
        fn.mock.calls.some(
          (c) =>
            String(c[0]).endsWith('/runs/save') &&
            String((c[1] as RequestInit).body).includes('"name":"baseline"'),
        ),
      ).toBe(true),
    );
  });
});

describe('Load tests view', () => {
  beforeEach(() => resetEnv('#/runs'));

  it('starts a recording from the name box', async () => {
    const fn = stub();
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Run name'), { target: { value: 'v1' } });
    fireEvent.click(screen.getByRole('button', { name: /Start recording/ }));
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]).endsWith('/runs/start'))).toBe(true),
    );
  });

  it('shows the recording banner and stop control', async () => {
    runsPayload = { active: { id: 3, name: 'live-run', startMs: Date.now() - 5000 }, runs: [] };
    stub();
    render(<App />);
    expect(await screen.findByText('live-run')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stop and save/ })).toBeInTheDocument();
  });

  it('compares two selected runs with verdicts', async () => {
    runsPayload = {
      active: null,
      runs: [run(2, 'after', { p99: 200, avgRps: 500 }), run(1, 'before')],
    };
    stub();
    render(<App />);
    fireEvent.click(await screen.findByLabelText('Select before'));
    fireEvent.click(screen.getByLabelText('Select after'));
    expect(await screen.findByText('Comparison')).toBeInTheDocument();
    expect(screen.getByText(/-61\.2%/)).toBeInTheDocument();
    expect(screen.getByText(/\+48\.8%/)).toBeInTheDocument();
  });

  it('shows one run as a report', async () => {
    runsPayload = { active: null, runs: [run(1, 'solo')] };
    stub();
    render(<App />);
    fireEvent.click(await screen.findByLabelText('Select solo'));
    expect(await screen.findByLabelText('Run report')).toHaveTextContent('Total Requests');
    expect(screen.getByRole('button', { name: 'Copy report' })).toBeInTheDocument();
  });
});
