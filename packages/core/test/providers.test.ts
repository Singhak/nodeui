import { mkdtempSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CpuProvider, type CpuClock } from '../src/providers/cpu';
import { EventLoopLagProvider, type EventLoopClock } from '../src/providers/event-loop';
import { HealthProvider } from '../src/providers/health';
import { HeapSnapshotProvider } from '../src/providers/heap-snapshot';
import { MemoryProvider } from '../src/providers/memory';
import { RequestsProvider } from '../src/providers/requests';
import { Sampler } from '../src/providers/sampler';
import { StartupTracker } from '../src/providers/startup-tracker';
import type { NodeUIConfig, ProviderContext } from '../src/types';

function makeConfig(overrides: Partial<NodeUIConfig> = {}): NodeUIConfig {
  return {
    path: '/nodeui',
    host: '127.0.0.1',
    port: 3000,
    requestLogSize: 500,
    logSize: 500,
    pollIntervalMs: 2000,
    enabled: true,
    activationReason: 'test',
    maskSecrets: true,
    inactivityTimeoutMs: 60_000,
    confirmTtlMs: 60_000,
    heapSnapshotDir: tmpdir(),
    ...overrides,
  };
}

function makeCtx(
  overrides: Partial<NodeUIConfig> = {},
  store: Record<string, unknown> = {},
): ProviderContext {
  return { config: makeConfig(overrides), env: {}, store };
}

describe('Sampler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('samples immediately and on interval, and is idempotent to start', () => {
    const samples: number[] = [];
    const sampler = new Sampler({
      intervalMs: 1000,
      collect: () => 42,
      onSample: (s) => samples.push(s),
    });
    sampler.start();
    sampler.start();
    expect(samples).toEqual([42]);
    vi.advanceTimersByTime(3000);
    expect(samples).toEqual([42, 42, 42, 42]);
    expect(sampler.isRunning).toBe(true);
    sampler.stop();
    expect(sampler.isRunning).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(samples).toHaveLength(4);
  });

  it('never throws into the event loop', () => {
    const sampler = new Sampler({
      intervalMs: 1000,
      collect: () => {
        throw new Error('boom');
      },
      onSample: () => undefined,
    });
    expect(() => sampler.start()).not.toThrow();
    sampler.stop();
  });
});

describe('StartupTracker', () => {
  it('records ordered marks with sinceFirstMs offsets', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(10_000));
      const tracker = new StartupTracker();
      tracker.mark('a');
      vi.setSystemTime(new Date(13_000));
      tracker.mark('b');
      const data = tracker.getData();
      expect(data.marks).toHaveLength(2);
      expect(data.marks[0]).toEqual({ name: 'a', atMs: 10_000, sinceFirstMs: 0 });
      expect(data.marks[1]?.sinceFirstMs).toBe(3000);
      expect(data.startedAtMs).toBe(10_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MemoryProvider', () => {
  it('returns typed memory data and writes to the store when started', () => {
    const provider = new MemoryProvider();
    const ctx = makeCtx();
    const result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sampleAtMs).toBe(0);

    provider.start(ctx);
    const started = provider.get(ctx);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.data.heapUsed).toBeGreaterThan(0);
    expect(started.data.totalMem).toBeGreaterThan(started.data.heapTotal);
    expect(ctx.store.memory).toBeDefined();
    provider.stop(ctx);
  });

  it('stop is safe to call repeatedly', () => {
    const provider = new MemoryProvider();
    const ctx = makeCtx();
    provider.start(ctx);
    provider.stop(ctx);
    provider.stop(ctx);
  });
});

describe('CpuProvider', () => {
  function makeClock(
    steps: Array<{ us: bigint; cpu: { user: number; system: number } }>,
  ): CpuClock {
    let i = 0;
    return {
      nowUs: () => steps[Math.min(i, steps.length - 1)]!.us,
      cpuUsage: () => steps[Math.min(i, steps.length - 1)]!.cpu,
      tick: () => {
        i += 1;
      },
    };
  }

  it('computes deltas as percentages', () => {
    const clock = makeClock([
      { us: 0n, cpu: { user: 0, system: 0 } },
      { us: 1_000_000n, cpu: { user: 100_000, system: 50_000 } },
    ]);
    const provider = new CpuProvider(clock);
    const ctx = makeCtx({ pollIntervalMs: 1000 });
    provider.start(ctx);
    clock.tick();
    provider.collect();
    const result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.userPercent).toBeCloseTo(10, 5);
    expect(result.data.systemPercent).toBeCloseTo(5, 5);
    expect(result.data.totalPercent).toBeCloseTo(15, 5);
    provider.stop(ctx);
  });

  it('returns zeroed data before the first real delta', () => {
    const clock = makeClock([{ us: 0n, cpu: { user: 0, system: 0 } }]);
    const provider = new CpuProvider(clock);
    const ctx = makeCtx();
    const result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalPercent).toBe(0);
    expect(result.data.sampleAtMs).toBe(0);
  });
});

describe('EventLoopLagProvider', () => {
  function makeClock(nowNs: () => bigint): EventLoopClock {
    return { nowNs };
  }

  it('measures drift against a controlled clock', () => {
    let now = 0n;
    const clock = makeClock(() => now);
    const provider = new EventLoopLagProvider(clock);
    const ctx = makeCtx({ pollIntervalMs: 2000 });
    provider.start(ctx);
    // immediate sample: no drift yet
    let result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.currentMs).toBe(0);

    now = 2_500_000_000n; // 500ms late relative to the 2000ms tick
    provider.collect(2000);
    result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.currentMs).toBeCloseTo(500, 5);
    expect(result.data.maxMs).toBeCloseTo(500, 5);
    expect(result.data.avgMs).toBeCloseTo(250, 5);
    expect(result.data.count).toBe(2);
    expect(ctx.store['event-loop']).toBeDefined();
    provider.stop(ctx);
  });

  it('never reports negative lag', () => {
    let now = 0n;
    const clock = makeClock(() => now);
    const provider = new EventLoopLagProvider(clock);
    const ctx = makeCtx({ pollIntervalMs: 2000 });
    provider.start(ctx);
    now = 1_000_000_000n; // early tick
    provider.collect(2000);
    const result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.currentMs).toBe(0);
    provider.stop(ctx);
  });
});

describe('HealthProvider', () => {
  it('reports unknown when no samples exist', () => {
    const provider = new HealthProvider();
    const ctx = makeCtx();
    const result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('unknown');
  });

  it('reports ok with healthy lag', () => {
    const store = { 'event-loop': { currentMs: 20 } };
    const provider = new HealthProvider();
    const result = provider.get(makeCtx({}, store));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('ok');
    expect(result.data.eventLoopLagMs).toBe(20);
  });

  it('reports degraded and critical at thresholds', () => {
    const degraded = new HealthProvider().get(makeCtx({}, { 'event-loop': { currentMs: 100 } }));
    if (!degraded.ok) return;
    expect(degraded.data.status).toBe('degraded');

    const critical = new HealthProvider().get(makeCtx({}, { 'event-loop': { currentMs: 500 } }));
    if (!critical.ok) return;
    expect(critical.data.status).toBe('critical');
  });
});

describe('HeapSnapshotProvider', () => {
  it('reports supported with no last snapshot initially', () => {
    const provider = new HeapSnapshotProvider();
    const result = provider.get(makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.supported).toBe(true);
    expect(result.data.lastSnapshot).toBeNull();
  });

  it('writes a snapshot file on takeSnapshot and tracks it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nodeui-heap-test-'));
    const provider = new HeapSnapshotProvider();
    const ctx = makeCtx({ heapSnapshotDir: dir });
    const result = await provider.takeSnapshot(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fileName).toMatch(/^nodeui-heap-/);
    expect(result.data.sizeBytes).toBeGreaterThan(0);
    expect(existsSync(result.data.filePath)).toBe(true);

    const panel = provider.get(ctx);
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.data.lastSnapshot?.fileName).toBe(result.data.fileName);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('returns a typed error when the snapshot target is not writable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nodeui-heap-notdir-'));
    const blockerFile = join(dir, 'blocker');
    writeFileSync(blockerFile, 'x');
    const provider = new HeapSnapshotProvider();
    const ctx = makeCtx({ heapSnapshotDir: blockerFile });
    const result = await provider.takeSnapshot(ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('heap-snapshot-failed');
  });
});

describe('RequestsProvider', () => {
  it('records entries, assigns ids, and bounds to capacity', () => {
    const provider = new RequestsProvider(3);
    provider.record({
      method: 'GET',
      path: '/a',
      status: 200,
      durationMs: 1,
      timestampMs: 1,
      ip: '127.0.0.1',
    });
    provider.record({
      method: 'GET',
      path: '/b',
      status: 200,
      durationMs: 2,
      timestampMs: 2,
      ip: '127.0.0.1',
    });
    provider.record({
      method: 'GET',
      path: '/c',
      status: 200,
      durationMs: 3,
      timestampMs: 3,
      ip: '127.0.0.1',
    });
    provider.record({
      method: 'GET',
      path: '/d',
      status: 500,
      durationMs: 4,
      timestampMs: 4,
      ip: '127.0.0.1',
    });
    const result = provider.get(makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(3);
    expect(result.data.entries.map((e) => e.path)).toEqual(['/b', '/c', '/d']);
    expect(result.data.entries.map((e) => e.id)).toEqual([2, 3, 4]);
  });

  it('truncates the response to the latest 100 entries', () => {
    const provider = new RequestsProvider(500);
    for (let i = 0; i < 250; i += 1) {
      provider.record({
        method: 'GET',
        path: `/r${i}`,
        status: 200,
        durationMs: 0,
        timestampMs: i,
        ip: '127.0.0.1',
      });
    }
    const result = provider.get(makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(250);
    expect(result.data.entries).toHaveLength(100);
    expect(result.data.entries[0]?.path).toBe('/r150');
  });
});
