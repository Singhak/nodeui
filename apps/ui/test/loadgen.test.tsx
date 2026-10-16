import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import type {
  BenchRun,
  BenchRunSummary,
  LoadTestConfig,
  LoadTestStatus,
  RunsData,
} from '../src/types';
import { defaultPayloads, json, resetEnv, stubApi } from './fixtures';

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

const config: LoadTestConfig = {
  method: 'GET',
  path: '/api/users',
  headers: {},
  body: '',
  connections: 8,
  durationSec: 5,
  maxRequests: 1_000_000,
  name: 'users',
};

const run = (
  id: number,
  name: string,
  over: Partial<BenchRunSummary> = {},
  loadTest?: LoadTestConfig,
): BenchRun => ({
  id,
  name,
  startMs: 1_700_000_000_000,
  endMs: 1_700_000_010_000,
  summary: summary(over),
  points: [],
  ...(loadTest ? { loadTest } : {}),
});

let runs: RunsData;
let load: LoadTestStatus;

function stub(): ReturnType<typeof vi.fn> {
  const payloads = defaultPayloads();
  (payloads['/config'] as { panels: string[] }).panels.push('timeseries', 'loadtest');
  const base = stubApi(payloads);
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/loadtest')) return json({ ok: true, data: load });
    if (url.endsWith('/loadtest/start')) {
      load = {
        state: 'running',
        config: JSON.parse(String(init?.body)) as LoadTestConfig,
        startedAtMs: Date.now(),
        sent: 0,
        completed: 0,
        errors: 0,
      };
      return json({ ok: true, data: load });
    }
    if (url.endsWith('/loadtest/stop')) return json({ ok: true, data: load });
    if (url.endsWith('/api/runs')) return json({ ok: true, data: runs });
    return base(input, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.stubGlobal('EventSource', undefined);
  resetEnv('#/runs');
  load = { state: 'idle', sent: 0, completed: 0, errors: 0 };
  runs = {
    active: null,
    baselineId: null,
    persisted: true,
    runs: [run(1, 'users', {}, config), run(0, 'manual')],
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Load generator', () => {
  it('starts a test with the form values and a confirmation nonce', async () => {
    const fn = stub();
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Load path'), {
      target: { value: '/api/orders' },
    });
    fireEvent.change(screen.getByLabelText('Connections'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Duration in seconds'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Load run name'), { target: { value: 'orders' } });
    fireEvent.click(screen.getByRole('button', { name: /Run load test/ }));
    await waitFor(() => {
      const call = fn.mock.calls.find((c) => String(c[0]).endsWith('/loadtest/start'));
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        method: 'GET',
        path: '/api/orders',
        connections: 25,
        durationSec: 15,
        name: 'orders',
      });
      expect((call?.[1] as RequestInit).headers).toMatchObject({
        'x-nodeui-confirm': 'a'.repeat(32),
      });
    });
  });

  it('only offers a body for methods that send one', async () => {
    stub();
    render(<App />);
    await screen.findByLabelText('Load path');
    expect(screen.queryByLabelText('Load body')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Load method'), { target: { value: 'POST' } });
    expect(screen.getByLabelText('Load body')).toBeInTheDocument();
  });

  it('shows progress and a stop button while running', async () => {
    load = {
      state: 'running',
      config,
      startedAtMs: Date.now() - 2000,
      sent: 500,
      completed: 480,
      errors: 3,
    };
    const fn = stub();
    render(<App />);
    expect(await screen.findByText(/Running GET \/api\/users/)).toBeInTheDocument();
    expect(screen.getByText(/480 done/)).toBeInTheDocument();
    expect(screen.getByText(/3 failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]).endsWith('/loadtest/stop'))).toBe(true),
    );
  });

  it('re-runs a generated run with the same settings and compares with the original', async () => {
    const fn = stub();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Re-run users' }));
    await waitFor(() => {
      const call = fn.mock.calls.find((c) => String(c[0]).endsWith('/loadtest/start'));
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        path: '/api/users',
        connections: 8,
        durationSec: 5,
        name: 'users (re-run)',
      });
    });
    // the test finishes and produces run 2
    runs = {
      ...runs,
      runs: [run(2, 'users (re-run)', { p99: 60 }, config), ...runs.runs],
    };
    load = { ...load, state: 'done', runId: 2 };
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    expect(await screen.findByText('Comparison', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('users (re-run) against baseline users')).toBeInTheDocument();
  });

  it('hides Re-run for runs that were not generated here', async () => {
    stub();
    render(<App />);
    await screen.findByRole('button', { name: 'Re-run users' });
    expect(screen.queryByRole('button', { name: 'Re-run manual' })).not.toBeInTheDocument();
  });
});
