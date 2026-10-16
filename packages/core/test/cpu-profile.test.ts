import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  CpuProfileProvider,
  summarizeProfile,
  type ProfilerBackend,
  type RawCpuProfile,
} from '../src/providers/cpu-profile';
import { createNodeUI } from '../src/server';

const frame = (functionName: string, url = '', lineNumber = 0) => ({
  functionName,
  url,
  lineNumber,
  scriptId: '1',
  columnNumber: 0,
});

/** root -> handler(70%) -> db(20% self) / hash(50% self); idle 30%. */
function syntheticProfile(): RawCpuProfile {
  return {
    startTime: 0,
    endTime: 100_000,
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2, 5] },
      {
        id: 2,
        callFrame: frame('handler', 'file:///app/src/routes/users.js', 9),
        children: [3, 4],
      },
      { id: 3, callFrame: frame('queryDb', 'file:///app/src/db.js', 3) },
      { id: 4, callFrame: frame('hashPassword', 'file:///app/node_modules/bcrypt/index.js', 20) },
      { id: 5, callFrame: frame('(idle)') },
    ],
    // 10 samples of 10ms: 2 db, 5 hash, 3 idle
    samples: [3, 3, 4, 4, 4, 4, 4, 5, 5, 5],
    timeDeltas: Array.from({ length: 10 }, () => 10_000),
  };
}

describe('summarizeProfile', () => {
  it('builds a call tree with total and self time', () => {
    const r = summarizeProfile(syntheticProfile());
    expect(r.totalMs).toBe(100);
    expect(r.idleMs).toBe(30);
    expect(r.sampleCount).toBe(10);
    const handler = r.tree.children.find((c) => c.name === 'handler');
    expect(handler).toMatchObject({
      totalMs: 70,
      selfMs: 0,
      line: 10,
      file: 'routes/users.js',
    });
    expect(handler?.children.map((c) => [c.name, c.totalMs])).toEqual([
      ['hashPassword', 50],
      ['queryDb', 20],
    ]);
  });

  it('ranks functions by self time and shortens node_modules paths', () => {
    const { top } = summarizeProfile(syntheticProfile());
    expect(top.map((t) => t.name)).toEqual(['hashPassword', '(idle)', 'queryDb']);
    expect(top[0]).toMatchObject({ selfMs: 50, share: 0.5, file: 'node_modules/bcrypt/index.js' });
  });

  it('prunes tiny branches but keeps totals intact', () => {
    const raw = syntheticProfile();
    raw.nodes.push({ id: 6, callFrame: frame('tiny'), children: [] });
    raw.nodes[1]?.children?.push(6);
    raw.samples = [...(raw.samples ?? []), 6];
    raw.timeDeltas = [...(raw.timeDeltas ?? []), 5]; // 5µs
    const r = summarizeProfile(raw);
    const handler = r.tree.children.find((c) => c.name === 'handler');
    expect(handler?.children.some((c) => c.name === 'tiny')).toBe(false);
    expect(r.totalMs).toBeGreaterThan(100);
    expect(r.totalMs).toBeLessThan(100.02);
  });

  it('handles an empty profile', () => {
    const r = summarizeProfile({ startTime: 0, endTime: 0, nodes: [] });
    expect(r.tree.name).toBe('(empty)');
    expect(r.top).toEqual([]);
  });
});

function fakeBackend(profile: RawCpuProfile = syntheticProfile()): ProfilerBackend & {
  starts: number;
} {
  return {
    starts: 0,
    async start() {
      this.starts += 1;
    },
    async stop() {
      return profile;
    },
  };
}

describe('CpuProfileProvider', () => {
  it('runs, finishes on its own and keeps the result', async () => {
    vi.useFakeTimers();
    try {
      const backend = fakeBackend();
      const p = new CpuProfileProvider({ backend, nowMs: () => 1234 });
      expect(p.get().data.state).toBe('idle');
      await p.startProfile(5);
      expect(p.get().data).toMatchObject({ state: 'running', seconds: 5 });
      await expect(p.startProfile(5)).rejects.toThrow(/already running/);
      await vi.advanceTimersByTimeAsync(5000);
      const data = p.get().data;
      expect(data.state).toBe('done');
      if (data.state === 'done') expect(data.result.top[0]?.name).toBe('hashPassword');
      p.clear();
      expect(p.get().data.state).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be stopped early and clamps the duration', async () => {
    const backend = fakeBackend();
    const p = new CpuProfileProvider({ backend });
    const started = await p.startProfile(9999);
    expect(started).toMatchObject({ seconds: 60 });
    const done = await p.stopProfile();
    expect(done.state).toBe('done');
  });

  it('reports a failure to start or stop', async () => {
    const failing: ProfilerBackend = {
      async start() {
        throw new Error('inspector busy');
      },
      async stop() {
        throw new Error('nope');
      },
    };
    await expect(new CpuProfileProvider({ backend: failing }).startProfile(1)).rejects.toThrow(
      /busy/,
    );
    const stopFails: ProfilerBackend = { async start() {}, stop: failing.stop };
    const p = new CpuProfileProvider({ backend: stopFails });
    await p.startProfile(1);
    const out = await p.stopProfile();
    expect(out).toMatchObject({ state: 'error', error: 'nope' });
  });
});

describe('real inspector profile', () => {
  it('captures the function that burns CPU', async () => {
    const p = new CpuProfileProvider();
    await p.startProfile(1);
    const end = Date.now() + 400;
    let acc = 0;
    function spinHotLoop(): void {
      while (Date.now() < end) acc += Math.sqrt(acc + 1);
    }
    spinHotLoop();
    const done = await p.stopProfile();
    expect(done.state).toBe('done');
    if (done.state === 'done') {
      expect(done.result.sampleCount).toBeGreaterThan(50);
      const names = done.result.top.map((t) => t.name);
      expect(names).toContain('spinHotLoop');
    }
  });
});

describe('profile over HTTP', () => {
  it('needs a confirmation nonce to start and then serves the result', async () => {
    const server = createNodeUI({});
    const http = createServer((req, res) => server.middleware()(req, res, () => res.end('ok')));
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/nodeui/api`;
    try {
      const post = (path: string, body: unknown, nonce?: string) =>
        fetch(base + path, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(nonce ? { 'x-nodeui-confirm': nonce } : {}),
          },
          body: JSON.stringify(body),
        });
      expect((await post('/cpu-profile/start', { seconds: 1 })).status).toBe(409);
      const issued = (await (await post('/confirmations', {})).json()) as {
        data: { nonce: string };
      };
      const started = await post('/cpu-profile/start', { seconds: 1 }, issued.data.nonce);
      expect(started.status).toBe(200);
      const running = (await (await fetch(base + '/cpu-profile')).json()) as {
        data: { state: string };
      };
      expect(running.data.state).toBe('running');
      const stopped = (await (await post('/cpu-profile/stop', {})).json()) as {
        data: { state: string };
      };
      expect(stopped.data.state).toBe('done');
    } finally {
      server.shutdown();
      http.closeAllConnections?.();
      await new Promise<void>((r) => http.close(() => r()));
    }
  });
});
