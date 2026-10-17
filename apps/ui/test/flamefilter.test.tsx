import { describe, expect, it } from 'vitest';
import { filterFlame } from '../src/charts/FlameGraph';
import { allocToFlame } from '../src/views/HeapProfiler';
import type { FlameNode } from '../src/types';

const n = (name: string, file: string, selfMs: number, children: FlameNode[] = []): FlameNode => ({
  name,
  file,
  line: 1,
  selfMs,
  totalMs: selfMs + children.reduce((a, c) => a + c.totalMs, 0),
  children,
});

/** root -> handler -> (node:internal timer -> db) and handler -> qs(node_modules). */
const tree = n('(root)', '', 0, [
  n('handler', 'src/h.js', 5, [
    n('processTimers', 'node:internal/timers', 3, [n('db', 'src/db.js', 10)]),
    n('parse', 'node_modules/qs/index.js', 7),
  ]),
]);

describe('filterFlame', () => {
  it('returns the same tree when no filter is on', () => {
    expect(filterFlame(tree, {})).toBe(tree);
  });

  it('folds Node internals into the caller and keeps totals', () => {
    const out = filterFlame(tree, { hideInternals: true });
    const handler = out.children[0] as FlameNode;
    expect(handler.children.map((c) => c.name)).toEqual(['db', 'parse']);
    expect(handler.selfMs).toBe(8); // 5 + the timer's 3
    expect(out.totalMs).toBe(tree.totalMs);
  });

  it('folds dependencies too', () => {
    const out = filterFlame(tree, { hideInternals: true, hideDependencies: true });
    const handler = out.children[0] as FlameNode;
    expect(handler.children.map((c) => c.name)).toEqual(['db']);
    expect(handler.selfMs).toBe(15);
  });
});

describe('allocToFlame', () => {
  it('carries bytes in the flame value fields', () => {
    const f = allocToFlame({
      name: 'a',
      file: 'x.js',
      line: 2,
      totalBytes: 100,
      selfBytes: 40,
      children: [{ name: 'b', file: '', line: 0, totalBytes: 60, selfBytes: 60, children: [] }],
    });
    expect(f.totalMs).toBe(100);
    expect(f.children[0]?.selfMs).toBe(60);
  });
});
