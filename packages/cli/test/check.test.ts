import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli';
import { evaluateChecks, runCheck, type CheckSummary } from '../src/check';
import { parseTarget } from '../src/targets';

const base: CheckSummary = {
  requests: 1000,
  errors5xx: 5,
  avgRps: 200,
  p50: 20,
  p95: 80,
  p99: 150,
  loopP99: 12,
  rssPeak: 100 * 1024 * 1024,
};

describe('evaluateChecks', () => {
  it('passes when every limit holds', () => {
    const r = evaluateChecks(base, { maxP99: 200, maxErrorRate: 1, minRps: 100, maxRssMb: 128 });
    expect(r.passed).toBe(true);
    expect(r.results.map((x) => x.name)).toEqual(['p99', 'errorRate', 'rss', 'rps']);
  });

  it('reports which limit failed and by how much', () => {
    const r = evaluateChecks(base, { maxP99: 100, maxErrorRate: 0.1 });
    expect(r.passed).toBe(false);
    expect(r.results.filter((x) => !x.ok).map((x) => x.name)).toEqual(['p99', 'errorRate']);
    expect(r.results[0]?.text).toBe('p99 150 ms > 100 ms');
    expect(r.results[1]?.text).toBe('error rate 0.5 % > 0.1 %');
  });

  it('judges regressions against the baseline in both directions', () => {
    const slower = { ...base, p99: 180, avgRps: 150 };
    const r = evaluateChecks(slower, { maxRegression: 10 }, base);
    expect(r.results.map((x) => [x.name, x.ok])).toEqual([
      ['p99-regression', false],
      ['rps-regression', false],
    ]);
    const faster = evaluateChecks({ ...base, p99: 90, avgRps: 260 }, { maxRegression: 10 }, base);
    expect(faster.passed).toBe(true);
  });

  it('fails the regression check when no baseline exists', () => {
    const r = evaluateChecks(base, { maxRegression: 5 }, null);
    expect(r.passed).toBe(false);
    expect(r.results[0]?.text).toMatch(/no baseline/);
  });
});

describe('check flags', () => {
  it('parses value flags', () => {
    expect(parseArgs(['--max-p99', '300', '--run', 'latest', 'http://x:1']).flags).toEqual({
      'max-p99': '300',
      run: 'latest',
    });
  });
});

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function fakeConsole(routes: Record<string, unknown>): Promise<string> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const key = url.pathname.replace('/nodeui/api/', '');
    res.setHeader('content-type', 'application/json');
    if (key in routes) res.end(JSON.stringify({ ok: true, data: routes[key] }));
    else {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: { code: 'nf', message: 'nf' } }));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  close = () => new Promise<void>((r) => server.close(() => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const collect = () => {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l) };
};

describe('runCheck', () => {
  it('checks the recent window and exits 0 / 1', async () => {
    const url = await fakeConsole({ timeseries: { summary: base } });
    const pass = collect();
    expect(
      await runCheck({ target: parseTarget(url), limits: { maxP99: 200 }, log: pass.log }),
    ).toBe(0);
    expect(pass.lines.join('\n')).toContain('PASS  p99 150 ms <= 200 ms');
    const fail = collect();
    expect(
      await runCheck({ target: parseTarget(url), limits: { maxP99: 100 }, log: fail.log }),
    ).toBe(1);
    expect(fail.lines.join('\n')).toContain('FAIL');
  });

  it('checks a named run against the pinned baseline', async () => {
    const url = await fakeConsole({
      runs: {
        baselineId: 1,
        runs: [
          { id: 2, name: 'after', summary: { ...base, p99: 400 } },
          { id: 1, name: 'before', summary: base },
        ],
      },
    });
    const out = collect();
    expect(
      await runCheck({
        target: parseTarget(url),
        limits: { maxRegression: 10 },
        run: 'latest',
        log: out.log,
      }),
    ).toBe(1);
    expect(out.lines.join('\n')).toMatch(/p99 \+166\.67% vs baseline/);
  });

  it('exits 2 when there is nothing to check', async () => {
    const empty = await fakeConsole({
      timeseries: { summary: { ...base, requests: 0 } },
      runs: { runs: [] },
    });
    const a = collect();
    expect(await runCheck({ target: parseTarget(empty), limits: { maxP99: 1 }, log: a.log })).toBe(
      2,
    );
    const b = collect();
    expect(
      await runCheck({
        target: parseTarget(empty),
        limits: { maxP99: 1 },
        run: 'nope',
        log: b.log,
      }),
    ).toBe(2);
    const c = collect();
    expect(
      await runCheck({
        target: parseTarget('http://127.0.0.1:1'),
        limits: { maxP99: 1 },
        log: c.log,
      }),
    ).toBe(2);
    expect(c.lines[0]).toMatch(/cannot reach/);
  });

  it('exits 2 when no limits were given', async () => {
    const url = await fakeConsole({ timeseries: { summary: base } });
    const out = collect();
    expect(await runCheck({ target: parseTarget(url), limits: {}, log: out.log })).toBe(2);
    expect(out.lines[0]).toMatch(/no limits/);
  });
});
