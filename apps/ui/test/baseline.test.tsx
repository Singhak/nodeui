import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import type { BenchRun, BenchRunSummary, RunsData } from '../src/types';
import { defaultPayloads, json, resetEnv, stubApi } from './fixtures';

const NOW = 1_700_000_000_000;

const summary = (over: Partial<BenchRunSummary> = {}): BenchRunSummary => ({
  durationSec: 10,
  requests: 1000,
  errors5xx: 0,
  errors4xx: 0,
  avgRps: 100,
  peakRps: 120,
  p50: 10,
  p90: 20,
  p95: 25,
  p99: 100,
  maxMs: 150,
  avgMs: 12,
  bytesIn: 0,
  bytesOut: 1000,
  mbPerSec: 0.1,
  inflightMax: 5,
  loopP50: 1,
  loopP99: 4,
  loopMax: 9,
  heapPeak: 30e6,
  rssPeak: 120e6,
  cpuAvg: 20,
  cpuPeak: 40,
  gcMs: 2,
  pointCount: 5,
  ...over,
});

const run = (id: number, name: string, over: Partial<BenchRunSummary> = {}): BenchRun => ({
  id,
  name,
  startMs: NOW,
  endMs: NOW + 10_000,
  summary: summary(over),
  points: [],
});

let runs: RunsData;

function stub(): ReturnType<typeof vi.fn> {
  const payloads = defaultPayloads();
  (payloads['/config'] as { panels: string[] }).panels.push('timeseries');
  const base = stubApi(payloads);
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/runs')) return json({ ok: true, data: runs });
    if (url.endsWith('/runs/export')) {
      return new Response('{"version":1,"runs":[]}', { status: 200 });
    }
    if (url.includes('/api/runs/')) return json({ ok: true, data: { imported: 1, baselineId: 1 } });
    if (url.includes('/api/timeseries'))
      return json({ ok: false, error: { code: 'x', message: 'x' } }, 404);
    return base(input, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.stubGlobal('EventSource', undefined);
  resetEnv('#/runs');
  runs = {
    active: null,
    baselineId: 1,
    persisted: true,
    runs: [run(2, 'after', { p99: 60, avgRps: 150 }), run(1, 'before')],
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('baseline', () => {
  it('marks the baseline and shows deltas for the other runs', async () => {
    stub();
    render(<App />);
    const table = await screen.findByRole('table', { name: 'Saved runs' });
    const rows = within(table).getAllByRole('row');
    const after = rows.find((r) => r.textContent?.includes('after'));
    const before = rows.find((r) => r.textContent?.includes('before'));
    expect(before).toHaveTextContent('Baseline');
    expect(after).toHaveTextContent('p99 -40.0%');
    expect(after).toHaveTextContent('req/s +50.0%');
    expect(screen.getByText('Runs are saved to disk.')).toBeInTheDocument();
  });

  it('compares a single selected run against the baseline automatically', async () => {
    stub();
    render(<App />);
    fireEvent.click(await screen.findByLabelText('Select after'));
    expect(await screen.findByText('Comparison')).toBeInTheDocument();
    expect(screen.getByText('after against baseline before')).toBeInTheDocument();
  });

  it('pins and unpins through the API', async () => {
    const fn = stub();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set after as baseline' }));
    await waitFor(() =>
      expect(
        fn.mock.calls.some(
          (c) =>
            String(c[0]).endsWith('/runs/baseline') &&
            String((c[1] as RequestInit).body) === '{"id":2}',
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear baseline before' }));
    await waitFor(() =>
      expect(
        fn.mock.calls.some(
          (c) =>
            String(c[0]).endsWith('/runs/baseline') &&
            String((c[1] as RequestInit).body) === '{"id":null}',
        ),
      ).toBe(true),
    );
  });

  it('warns when runs are only kept in memory', async () => {
    runs = { ...runs, persisted: false };
    stub();
    render(<App />);
    expect(await screen.findByText(/Runs are kept in memory/)).toBeInTheDocument();
  });

  it('imports a chosen file', async () => {
    const fn = stub();
    render(<App />);
    const input = (await screen.findByLabelText('Import runs file')) as HTMLInputElement;
    const file = new File(['{"version":1,"runs":[]}'], 'runs.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => '{"version":1,"runs":[]}' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]).endsWith('/runs/import'))).toBe(true),
    );
  });
});
