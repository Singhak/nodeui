import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import { Heatmap } from '../src/charts/Heatmap';
import type { RouteMetricRow, RouteMetricsData } from '../src/types';
import { defaultPayloads, json, resetEnv, stubApi } from './fixtures';

const row = (over: Partial<RouteMetricRow>): RouteMetricRow => ({
  method: 'GET',
  path: '/users/:id',
  count: 120,
  errors5xx: 0,
  errors4xx: 2,
  errorRate: 0,
  avgMs: 12,
  p50: 10,
  p95: 40,
  p99: 80,
  maxMs: 120,
  totalMs: 1440,
  bytesOut: 50_000,
  rps: 4,
  lastMs: 1,
  sparkRps: [0, 1, 2, 3],
  sparkAvgMs: [0, 10, 12, 11],
  ...over,
});

const payload: RouteMetricsData = {
  startedAtMs: 0,
  sparkStepMs: 10_000,
  routes: [
    row({ path: '/report', totalMs: 9000, count: 30, p95: 900, errors5xx: 3, errorRate: 0.1 }),
    row({}),
    row({ method: '*', path: '(unmatched)', totalMs: 10, count: 9, p95: 1 }),
  ],
  totals: { requests: 159, totalMs: 10450 },
};

function stub(): ReturnType<typeof vi.fn> {
  const payloads = defaultPayloads();
  (payloads['/config'] as { panels: string[] }).panels.push('routemetrics');
  payloads['/routemetrics'] = payload;
  const base = stubApi(payloads);
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/runs/reset-routes'))
      return json({ ok: true, data: { reset: true } });
    return base(input, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => vi.stubGlobal('EventSource', undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Endpoints view', () => {
  beforeEach(() => resetEnv('#/endpoints'));

  it('lists routes sorted by time share with error highlighting', async () => {
    stub();
    render(<App />);
    const table = await screen.findByRole('table', { name: 'Per-route performance' });
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows[0]).toHaveTextContent('/report');
    expect(bodyRows[0]).toHaveTextContent('3 (10.0%)');
    expect(screen.getByText('Failing')).toBeInTheDocument();
  });

  it('filters by text and by routes with 5xx', async () => {
    stub();
    render(<App />);
    await screen.findByRole('table', { name: 'Per-route performance' });
    fireEvent.change(screen.getByLabelText('Filter routes'), { target: { value: 'users' } });
    await waitFor(() => expect(screen.queryByText('/report')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Filter routes'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Only with 5xx'));
    await waitFor(() => expect(screen.queryByText('/users/:id')).not.toBeInTheDocument());
    expect(screen.getByText('/report')).toBeInTheDocument();
  });

  it('resets the stats through the API', async () => {
    const fn = stub();
    render(<App />);
    await screen.findByRole('table', { name: 'Per-route performance' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset stats' }));
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]).endsWith('/runs/reset-routes'))).toBe(true),
    );
  });
});

describe('Heatmap', () => {
  it('renders an accessible plot for a grid and a message when empty', () => {
    const { rerender } = render(
      <Heatmap
        heatmap={{
          times: [1000, 2000],
          rowUpperMs: [1, 2, 4],
          cells: [
            [1, 0, 0],
            [0, 5, 1],
          ],
          stepMs: 1000,
        }}
      />,
    );
    expect(
      screen.getByRole('img', { name: /2 time windows, 3 latency bands/ }),
    ).toBeInTheDocument();
    rerender(<Heatmap heatmap={{ times: [], rowUpperMs: [], cells: [], stepMs: 1000 }} />);
    expect(screen.getByText('No requests in this range.')).toBeInTheDocument();
  });
});
