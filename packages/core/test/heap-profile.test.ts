import { describe, expect, it } from 'vitest';
import {
  HeapProfileProvider,
  summarizeHeapProfile,
  type HeapProfilerBackend,
  type RawHeapNode,
} from '../src/providers/heap-profile';

const node = (
  functionName: string,
  selfSize: number,
  children: RawHeapNode[] = [],
  url = '',
): RawHeapNode => ({
  callFrame: { functionName, url, lineNumber: 4 },
  selfSize,
  children,
});

/** root -> handler(0) -> buildCache(600) / parse(300); root -> tiny(1). */
const head = node('(root)', 0, [
  node('handler', 0, [
    node('buildCache', 600, [], 'file:///app/src/cache.js'),
    node('parse', 300, [], 'file:///app/node_modules/qs/index.js'),
  ]),
  node('tiny', 1),
]);

describe('summarizeHeapProfile', () => {
  it('rolls self bytes up into totals and ranks top allocators', () => {
    const r = summarizeHeapProfile({ head }, 1234);
    expect(r.totalBytes).toBe(901);
    expect(r.durationMs).toBe(1234);
    const handler = r.tree.children.find((c) => c.name === 'handler');
    expect(handler?.totalBytes).toBe(900);
    expect(handler?.children.map((c) => c.name)).toEqual(['buildCache', 'parse']);
    expect(r.top[0]).toMatchObject({ name: 'buildCache', selfBytes: 600, file: 'src/cache.js' });
    expect(r.top[0]?.share).toBeCloseTo(600 / 901);
    expect(r.top[1]?.file).toBe('node_modules/qs/index.js');
  });

  it('prunes negligible branches', () => {
    const r = summarizeHeapProfile({ head });
    expect(r.tree.children.some((c) => c.name === 'tiny')).toBe(false);
  });

  it('handles an empty profile', () => {
    const r = summarizeHeapProfile({ head: node('(root)', 0) });
    expect(r.totalBytes).toBe(0);
    expect(r.top).toEqual([]);
  });
});

describe('HeapProfileProvider', () => {
  const fake = (): HeapProfilerBackend & { started: number } => ({
    started: 0,
    async start() {
      this.started += 1;
    },
    async stop() {
      return { head };
    },
  });

  it('runs one profile at a time and returns a result on stop', async () => {
    const backend = fake();
    const p = new HeapProfileProvider({ backend });
    expect(p.get().data.state).toBe('idle');
    await p.startProfile(5);
    expect(p.get().data.state).toBe('running');
    await expect(p.startProfile(5)).rejects.toThrow(/already running/);
    const done = await p.stopProfile();
    expect(done.state).toBe('done');
    if (done.state === 'done') expect(done.result.totalBytes).toBe(901);
    p.clear();
    expect(p.get().data.state).toBe('idle');
  });

  it('reports a backend failure as an error state', async () => {
    const backend: HeapProfilerBackend = {
      async start() {},
      async stop() {
        throw new Error('boom');
      },
    };
    const p = new HeapProfileProvider({ backend });
    await p.startProfile(5);
    const out = await p.stopProfile();
    expect(out).toMatchObject({ state: 'error', error: 'boom' });
  });

  it('profiles this process through the real inspector', async () => {
    const p = new HeapProfileProvider();
    await p.startProfile(5);
    const keep: unknown[] = [];
    for (let i = 0; i < 20000; i += 1) keep.push({ i, s: 'x'.repeat(50) });
    const done = await p.stopProfile();
    expect(done.state).toBe('done');
    if (done.state === 'done') expect(done.result.totalBytes).toBeGreaterThan(0);
    expect(keep.length).toBe(20000);
  });
});
