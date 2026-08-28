import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogsProvider } from '../src/providers/logs';
import type { NodeUIConfig, ProviderContext } from '../src/types';

function makeCtx(query: Record<string, string> = {}): ProviderContext {
  const config: NodeUIConfig = {
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
    heapSnapshotDir: '/tmp',
  };
  return { config, env: {}, store: {}, query };
}

const original = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

afterEach(() => {
  console.log = original.log;
  console.info = original.info;
  console.warn = original.warn;
  console.error = original.error;
});

describe('LogsProvider', () => {
  it('captures console output while active and restores it on stop', () => {
    const provider = new LogsProvider();
    const ctx = makeCtx();
    provider.start(ctx);
    console.info('hello');
    console.error('boom', { code: 42 });
    const result = provider.get(ctx);
    provider.stop(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const messages = result.data.entries.map((e) => ({ level: e.level, message: e.message }));
    expect(messages).toContainEqual({ level: 'info', message: 'hello' });
    expect(messages).toContainEqual({ level: 'error', message: 'boom {"code":42}' });
    expect(console.log).toBe(original.log);
    expect(console.error).toBe(original.error);
  });

  it('filters by level and free-text query', () => {
    const provider = new LogsProvider();
    const ctx = makeCtx();
    provider.start(ctx);
    console.log('apple pie');
    console.warn('apple core');
    console.error('banana split');
    provider.stop(ctx);
    const levelResult = provider.get(makeCtx({ level: 'warn' }));
    if (!levelResult.ok) return;
    expect(levelResult.data.entries.map((e) => e.level)).toEqual(['warn']);
    const queryResult = provider.get(makeCtx({ query: 'APPLE' }));
    if (!queryResult.ok) return;
    expect(queryResult.data.entries.map((e) => e.message)).toEqual(['apple pie', 'apple core']);
  });

  it('does not intercept console when inactive', () => {
    const provider = new LogsProvider();
    const before = console.log;
    provider.get(makeCtx());
    expect(console.log).toBe(before);
  });

  it('accepts entries from the adapter addSource', () => {
    const provider = new LogsProvider();
    provider.addSource({ level: 'info', message: 'from adapter' });
    const result = provider.get(makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toEqual([
      expect.objectContaining({ level: 'info', message: 'from adapter' }),
    ]);
  });

  it('bounds the buffer to capacity', () => {
    const provider = new LogsProvider(3);
    provider.addSource({ level: 'debug', message: 'a' });
    provider.addSource({ level: 'debug', message: 'b' });
    provider.addSource({ level: 'debug', message: 'c' });
    provider.addSource({ level: 'debug', message: 'd' });
    const result = provider.get(makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries.map((e) => e.message)).toEqual(['b', 'c', 'd']);
  });

  it('keeps one active instance isolated when a sibling stops', () => {
    const a = new LogsProvider();
    const b = new LogsProvider();
    const ctx = makeCtx();
    a.start(ctx);
    b.start(ctx);
    console.log('first');
    a.stop(ctx);
    console.log('second');
    b.stop(ctx);
    const aResult = a.get(ctx);
    const bResult = b.get(ctx);
    if (!aResult.ok || !bResult.ok) return;
    expect(aResult.data.entries.map((e) => e.message)).toEqual(['first']);
    expect(bResult.data.entries.map((e) => e.message)).toEqual(['first', 'second']);
  });

  it('does not clobber a console patch layered on top by the host app', () => {
    const provider = new LogsProvider();
    const ctx = makeCtx();
    provider.start(ctx);
    const underlying = console.log;
    const hostWrapper = vi.fn((...args: unknown[]) => {
      underlying(...args);
    });
    console.log = hostWrapper;
    console.log('wrapped');
    provider.stop(ctx);
    expect(console.log).toBe(hostWrapper);
    expect(hostWrapper).toHaveBeenCalledWith('wrapped');
  });
});
