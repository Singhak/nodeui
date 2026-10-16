import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { AlertsProvider, validateRule } from '../src/providers/alerts';
import { TimeSeriesProvider } from '../src/providers/timeseries';
import { createNodeUI } from '../src/server';

function rig() {
  let t = 1_700_000_000_000;
  const now = () => t;
  const ts = new TimeSeriesProvider({ nowMs: now, manualTick: true });
  const alerts = new AlertsProvider({
    windowSummary: (s) => ts.windowSummary(s),
    nowMs: now,
    manualTick: true,
  });
  /** Sends `n` requests of `ms` each, then advances one second and evaluates. */
  const second = (n: number, ms: number, status = 200): void => {
    for (let i = 0; i < n; i += 1) ts.requestFinished(status, ms, 0, 0);
    t += 1000;
    alerts.evaluate();
  };
  return { ts, alerts, second };
}

const state = (a: AlertsProvider) => a.get().data.rules[0]?.state;

describe('AlertsProvider', () => {
  it('stays pending until the breach has held for forSeconds, then fires', () => {
    const { alerts, second } = rig();
    alerts.addRule({ metric: 'p99', threshold: 100, forSeconds: 3, windowSeconds: 5 });
    second(20, 10);
    expect(state(alerts)).toBe('ok');
    second(20, 500);
    expect(state(alerts)).toBe('pending');
    second(20, 500);
    second(20, 500);
    expect(state(alerts)).toBe('pending');
    second(20, 500);
    expect(state(alerts)).toBe('firing');
    expect(alerts.get().data.firing).toBe(1);
    expect(alerts.get().data.events[0]).toMatchObject({ type: 'fired', metric: 'p99' });
  });

  it('resolves once the window is healthy again and records both events', () => {
    const { alerts, second } = rig();
    alerts.addRule({ metric: 'p99', threshold: 100, forSeconds: 0, windowSeconds: 3 });
    second(20, 500);
    expect(state(alerts)).toBe('firing');
    for (let i = 0; i < 4; i += 1) second(20, 5);
    expect(state(alerts)).toBe('ok');
    expect(alerts.get().data.events.map((e) => e.type)).toEqual(['resolved', 'fired']);
  });

  it('never breaches latency or error rules without enough traffic', () => {
    const { alerts, second } = rig();
    alerts.addRule({ metric: 'p99', threshold: 1, forSeconds: 0, windowSeconds: 5 });
    second(2, 900);
    expect(state(alerts)).toBe('ok');
    expect(alerts.get().data.rules[0]?.value).toBeNull();
  });

  it('computes error rate as a percentage of requests', () => {
    const { alerts, second } = rig();
    alerts.addRule({ metric: 'errorRate', threshold: 10, forSeconds: 0, windowSeconds: 5 });
    second(10, 5, 500);
    second(30, 5, 200);
    const rule = alerts.get().data.rules[0];
    expect(rule?.value).toBeCloseTo(25, 0);
    expect(rule?.state).toBe('firing');
  });

  it('supports "<" rules such as a throughput floor', () => {
    const { alerts, second } = rig();
    alerts.addRule({ metric: 'rps', op: '<', threshold: 50, forSeconds: 0, windowSeconds: 3 });
    second(200, 5);
    expect(state(alerts)).toBe('ok');
    for (let i = 0; i < 4; i += 1) second(1, 5);
    expect(state(alerts)).toBe('firing');
  });

  it('only lets the console remove rules it created', () => {
    const { alerts } = rig();
    const fromConfig = alerts.addRule({ metric: 'p99', threshold: 1 }, 'config');
    const fromUi = alerts.addRule({ metric: 'p95', threshold: 1 });
    expect(alerts.removeRule(fromConfig.id)).toBe(false);
    expect(alerts.removeRule(fromUi.id)).toBe(true);
    expect(alerts.get().data.rules).toHaveLength(1);
  });

  it('rejects invalid rules', () => {
    expect(() => validateRule({ metric: 'nope' as never, threshold: 1 })).toThrow(/unknown metric/);
    expect(() => validateRule({ metric: 'p99', threshold: Number.NaN })).toThrow(/threshold/);
    expect(() => validateRule({ metric: 'p99', threshold: 1, op: '>=' as never })).toThrow(/op/);
    expect(() => validateRule({ metric: 'p99', threshold: 1, windowSeconds: 0 })).toThrow(/window/);
  });
});

describe('alerts over HTTP', () => {
  it('serves rules from options, accepts new ones and warns on a firing alert', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = createNodeUI({
      alerts: [{ metric: 'rps', threshold: 0, op: '<', name: 'cfg' }],
    });
    const http = createServer((req, res) => server.middleware()(req, res, () => res.end('ok')));
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/nodeui/api`;
    try {
      const post = (path: string, body: unknown): Promise<Response> =>
        fetch(base + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const list = async () =>
        (
          (await (await fetch(base + '/alerts')).json()) as {
            data: { rules: Array<{ id: number; name: string; source: string }> };
          }
        ).data.rules;
      expect((await list()).map((r) => r.name)).toEqual(['cfg']);
      const added = (await (
        await post('/alerts/add', { metric: 'p99', threshold: 250 })
      ).json()) as {
        data: { id: number };
      };
      expect((await list()).length).toBe(2);
      expect((await post('/alerts/add', { metric: 'bogus', threshold: 1 })).status).toBe(400);
      const removed = await post('/alerts/remove', { id: added.data.id });
      expect(((await removed.json()) as { data: { removed: boolean } }).data.removed).toBe(true);
      const cfg = (await list())[0];
      expect(
        (
          (await (await post('/alerts/remove', { id: cfg?.id })).json()) as {
            data: { removed: boolean };
          }
        ).data.removed,
      ).toBe(false);
    } finally {
      server.shutdown();
      http.closeAllConnections?.();
      await new Promise<void>((r) => http.close(() => r()));
      warn.mockRestore();
    }
  });
});
