import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import type { AlertsData } from '../src/types';
import { defaultPayloads, json, resetEnv, stubApi } from './fixtures';

const metrics: AlertsData['metrics'] = [
  { id: 'p99', label: 'Latency p99', unit: 'ms' },
  { id: 'errorRate', label: 'Error rate (5xx)', unit: '%' },
];

let alerts: AlertsData;

function stub(): ReturnType<typeof vi.fn> {
  const payloads = defaultPayloads();
  (payloads['/config'] as { panels: string[] }).panels.push('alerts');
  const base = stubApi(payloads);
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/alerts')) return json({ ok: true, data: alerts });
    if (url.includes('/api/alerts/')) return json({ ok: true, data: { id: 9, removed: true } });
    return base(input, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const rule = (over: Partial<AlertsData['rules'][number]>): AlertsData['rules'][number] => ({
  id: 1,
  name: 'p99 too high',
  metric: 'p99',
  op: '>',
  threshold: 300,
  forSeconds: 5,
  windowSeconds: 10,
  source: 'ui',
  state: 'ok',
  value: 120,
  sinceMs: 0,
  ...over,
});

beforeEach(() => {
  vi.stubGlobal('EventSource', undefined);
  alerts = { rules: [], firing: 0, events: [], metrics };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Alerts view', () => {
  beforeEach(() => resetEnv('#/alerts'));

  it('lists rules with state, condition and current value', async () => {
    alerts = {
      ...alerts,
      rules: [
        rule({ state: 'firing', value: 812 }),
        rule({ id: 2, name: 'config rule', source: 'config', metric: 'errorRate', threshold: 1 }),
      ],
      firing: 1,
    };
    stub();
    render(<App />);
    const table = await screen.findByRole('table', { name: 'Alert rules' });
    expect(table).toHaveTextContent('Firing');
    expect(table).toHaveTextContent('Latency p99 > 300 ms for 5s (over 10s)');
    expect(table).toHaveTextContent('812 ms');
    expect(screen.queryByRole('button', { name: 'Remove config rule' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove p99 too high' })).toBeInTheDocument();
  });

  it('adds a rule from a preset and removes one', async () => {
    alerts = { ...alerts, rules: [rule({})] };
    const fn = stub();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '5xx rate > 1%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => {
      const call = fn.mock.calls.find((c) => String(c[0]).endsWith('/alerts/add'));
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        metric: 'errorRate',
        op: '>',
        threshold: 1,
        forSeconds: 5,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove p99 too high' }));
    await waitFor(() =>
      expect(
        fn.mock.calls.some(
          (c) =>
            String(c[0]).endsWith('/alerts/remove') &&
            String((c[1] as RequestInit).body) === '{"id":1}',
        ),
      ).toBe(true),
    );
  });

  it('shows history and an empty state', async () => {
    alerts = {
      ...alerts,
      events: [
        {
          ruleId: 1,
          name: 'p99 too high',
          type: 'fired',
          atMs: 1000,
          value: 812,
          threshold: 300,
          metric: 'p99',
        },
      ],
    };
    stub();
    render(<App />);
    expect(await screen.findByText('No alert rules yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Alert history')).toHaveTextContent('Fired');
  });
});

describe('alert banner', () => {
  beforeEach(() => resetEnv('#/overview'));

  it('appears on every view while a rule is firing and marks the tab title', async () => {
    alerts = { ...alerts, rules: [rule({ state: 'firing', value: 812 })], firing: 1 };
    stub();
    render(<App />);
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('1 alert firing');
    expect(banner).toHaveTextContent('p99 too high (now 812)');
    await waitFor(() => expect(document.title).toMatch(/^\(1 alert\)/));
  });

  it('is absent when nothing is firing', async () => {
    alerts = { ...alerts, rules: [rule({})] };
    stub();
    render(<App />);
    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
