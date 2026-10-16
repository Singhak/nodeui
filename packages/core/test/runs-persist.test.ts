import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBenchRun, TimeSeriesProvider } from '../src/providers/timeseries';
import { createNodeUI } from '../src/server';

function seeded(): TimeSeriesProvider {
  let t = 1_700_000_000_000;
  const ts = new TimeSeriesProvider({ nowMs: () => t, manualTick: true });
  for (let s = 0; s < 5; s += 1) {
    for (let i = 0; i < 10; i += 1) ts.requestFinished(200, 20, 0, 0);
    t += 1000;
  }
  return ts;
}

describe('runs: baseline, snapshot and import', () => {
  it('pins a baseline and clears it when that run is deleted', () => {
    const ts = seeded();
    const a = ts.saveRange('a', 1_700_000_000_000, 1_700_000_004_000);
    const b = ts.saveRange('b', 1_700_000_000_000, 1_700_000_004_000);
    expect(ts.setBaseline(a.id)).toBe(true);
    expect(ts.listRuns().baselineId).toBe(a.id);
    expect(ts.setBaseline(999)).toBe(false);
    ts.deleteRun(a.id);
    expect(ts.listRuns().baselineId).toBeNull();
    expect(ts.setBaseline(b.id)).toBe(true);
    expect(ts.setBaseline(null)).toBe(true);
  });

  it('round-trips through snapshot/restore and keeps ids unique', () => {
    const ts = seeded();
    const a = ts.saveRange('a', 1_700_000_000_000, 1_700_000_004_000);
    ts.setBaseline(a.id);
    const file = JSON.parse(JSON.stringify(ts.snapshotRuns())) as unknown;

    const fresh = seeded();
    fresh.restoreRuns(file);
    expect(fresh.listRuns().runs.map((r) => r.name)).toEqual(['a']);
    expect(fresh.listRuns().baselineId).toBe(a.id);
    const next = fresh.saveRange('b', 1_700_000_000_000, 1_700_000_004_000);
    expect(next.id).toBeGreaterThan(a.id);
  });

  it('imports an export under new ids and rejects junk', () => {
    const ts = seeded();
    ts.saveRange('a', 1_700_000_000_000, 1_700_000_004_000);
    const exported = JSON.parse(JSON.stringify(ts.snapshotRuns())) as unknown;
    const added = ts.importRuns(exported);
    expect(added).toHaveLength(1);
    expect(ts.listRuns().runs).toHaveLength(2);
    expect(new Set(ts.listRuns().runs.map((r) => r.id)).size).toBe(2);
    expect(() => ts.importRuns({ nope: true })).toThrow();
    expect(() => ts.importRuns({ runs: [{ id: 1 }] })).toThrow(/no valid runs/);
  });

  it('validates the run shape', () => {
    const ts = seeded();
    const run = ts.saveRange('a', 1_700_000_000_000, 1_700_000_004_000);
    expect(isBenchRun(run)).toBe(true);
    expect(isBenchRun({ ...run, summary: { ...run.summary, p99: 'x' } })).toBe(false);
    expect(isBenchRun({ ...run, points: [{ t: 'x' }] })).toBe(false);
    expect(isBenchRun(null)).toBe(false);
  });

  it('notifies on every change', () => {
    const ts = seeded();
    let calls = 0;
    ts.onRunsChanged = () => {
      calls += 1;
    };
    const a = ts.saveRange('a', 1_700_000_000_000, 1_700_000_004_000);
    ts.setBaseline(a.id);
    ts.deleteRun(a.id);
    expect(calls).toBe(3);
  });
});

describe('runs over HTTP with a runs file', () => {
  it('survives a restart and serves export/import/baseline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nodeui-runs-'));
    const runsFile = join(dir, 'runs.json');
    const boot = async (fn: (base: string) => Promise<void>): Promise<void> => {
      const server = createNodeUI({ runsFile });
      const http = createServer((req, res) => server.middleware()(req, res, () => res.end('ok')));
      await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
      try {
        await fn(base);
      } finally {
        server.shutdown();
        http.closeAllConnections?.();
        await new Promise<void>((r) => http.close(() => r()));
      }
    };
    const call = (base: string, path: string, body?: unknown): Promise<Response> =>
      fetch(`${base}/nodeui/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    try {
      let exported = '';
      await boot(async (base) => {
        await fetch(base + '/x');
        await call(base, '/runs/start', { name: 'before' });
        await fetch(base + '/y');
        await call(base, '/runs/stop', {});
        const list = (await (await call(base, '/runs')).json()) as {
          data: { runs: Array<{ id: number }>; persisted: boolean; baselineId: number | null };
        };
        expect(list.data.persisted).toBe(true);
        const id = list.data.runs[0]?.id as number;
        expect((await call(base, '/runs/baseline', { id })).status).toBe(200);
        expect((await call(base, '/runs/baseline', { id: 4242 })).status).toBe(404);
        const exp = await call(base, '/runs/export');
        expect(exp.headers.get('content-disposition')).toContain('nodeui-runs.json');
        exported = await exp.text();
      });
      // shutdown flushed the file
      expect(existsSync(runsFile)).toBe(true);
      expect((JSON.parse(readFileSync(runsFile, 'utf8')) as { runs: unknown[] }).runs).toHaveLength(
        1,
      );

      await boot(async (base) => {
        const list = (await (await call(base, '/runs')).json()) as {
          data: { runs: Array<{ name: string }>; baselineId: number | null };
        };
        expect(list.data.runs.map((r) => r.name)).toEqual(['before']);
        expect(list.data.baselineId).not.toBeNull();
        const imp = await call(base, '/runs/import', JSON.parse(exported));
        expect(imp.status).toBe(200);
        expect(((await imp.json()) as { data: { imported: number } }).data.imported).toBe(1);
        expect((await call(base, '/runs/import', { runs: [] })).status).toBe(400);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
