import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import { defaultPayloads, resetEnv, stubApi } from './fixtures';

let payloads: Record<string, unknown>;

beforeEach(() => {
  vi.stubGlobal('EventSource', undefined);
  resetEnv();
  payloads = defaultPayloads();
  stubApi(payloads);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const kpi = (id: string): HTMLElement => screen.getByTestId(`kpi-${id}`);

describe('Overview', () => {
  it('renders KPI tiles from the mocked data with units', async () => {
    render(<App />);
    await waitFor(() => expect(kpi('status')).toHaveTextContent('Degraded'));
    expect(kpi('status')).toHaveTextContent('db down');
    expect(kpi('uptime')).toHaveTextContent('1h 2m');
    await waitFor(() => expect(kpi('rps')).toHaveTextContent('2.0'));
    expect(kpi('rps')).toHaveTextContent('req/s');
    expect(kpi('errors')).toHaveTextContent('25.0');
    expect(kpi('errors')).toHaveTextContent('High');
    expect(kpi('errors')).toHaveTextContent('1 of 4');
    expect(kpi('p95')).toHaveTextContent('250');
    expect(kpi('p95')).toHaveTextContent('ms');
    expect(kpi('heap')).toHaveTextContent('50.0');
    expect(kpi('heap')).toHaveTextContent('MB');
    expect(kpi('cpu')).toHaveTextContent('15.0');
    expect(kpi('lag')).toHaveTextContent('0.5');
  });

  it('renders charts with axes, units, legend and a keyboard/hover tooltip', async () => {
    render(<App />);
    const chart = await screen.findByRole('img', {
      name: 'Requests and errors per second line chart',
    });
    await waitFor(() => expect(chart.querySelectorAll('path').length).toBeGreaterThan(1));
    expect(within(chart.parentElement as HTMLElement).getByText('req/s')).toBeInTheDocument();
    await waitFor(() =>
      expect(chart.querySelectorAll('.grid-line, .axis-line').length).toBeGreaterThan(2),
    );

    const group = screen.getByRole('group', {
      name: /Requests and errors per second\. Use left/,
    });
    fireEvent.keyDown(group, { key: 'End' });
    const tip = within(group).getByRole('status');
    expect(tip).toHaveTextContent('Requests');
    expect(tip).toHaveTextContent('2 /s');
    expect(tip).toHaveTextContent('Errors');
    fireEvent.keyDown(group, { key: 'Escape' });
    expect(within(group).queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getAllByText('Heap used').length).toBeGreaterThan(0);
  });

  it('shows the status breakdown, slowest routes, checks and recent errors', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('2xx success')).toBeInTheDocument());
    expect(screen.getByRole('img', { name: /Status code breakdown: 4 total/ })).toBeInTheDocument();

    const routes = screen.getByRole('table', { name: 'Slowest routes' });
    expect(within(routes).getByText('/boom')).toBeInTheDocument();
    expect(within(routes).getByText('/users')).toBeInTheDocument();
    expect(within(routes).getByRole('columnheader', { name: /p95/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    const checks = screen.getByRole('table', { name: 'Dependency checks' });
    expect(within(checks).getByText('timed out')).toBeInTheDocument();
    expect(within(checks).getByText(/Down/)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('kaboom happened')).toBeInTheDocument());
    expect(screen.getByText('GET /boom', { selector: '.recent .truncate' })).toBeInTheDocument();
  });

  it('shows empty states when there are no checks, routes or errors', async () => {
    payloads['/health'] = {
      ...(payloads['/health'] as object),
      checks: [],
      status: 'ok',
      statusReason: 'fine',
    };
    payloads['/requests'] = {
      total: 0,
      entries: [],
      summary: {
        count: 0,
        errors: 0,
        errorRate: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        byStatus: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
        routes: [],
      },
    };
    payloads['/logs'] = { entries: [] };
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText('No dependency checks registered')).toBeInTheDocument(),
    );
    expect(screen.getByText('No routes measured yet')).toBeInTheDocument();
    expect(screen.getByText('No recent errors')).toBeInTheDocument();
    expect(kpi('status')).toHaveTextContent('Healthy');
  });

  it('keeps history when switching views and back', async () => {
    render(<App />);
    await waitFor(() => expect(kpi('rps')).toHaveTextContent('2.0'));
    window.location.hash = '#/routes';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Routes' })).toBeInTheDocument(),
    );
    window.location.hash = '#/overview';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument(),
    );
    // populated from the app-level store, not re-fetched empty
    expect(kpi('rps')).toHaveTextContent('2.0');
  });

  it('changes the chart time range', async () => {
    render(<App />);
    await screen.findByRole('group', { name: 'Chart time range' });
    fireEvent.click(screen.getByRole('button', { name: '1 min' }));
    expect(screen.getByRole('button', { name: '1 min' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an error state with Retry when health is unreachable', async () => {
    delete payloads['/health'];
    render(<App />);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0),
    );
  });
});
