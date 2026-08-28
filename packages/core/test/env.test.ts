import { describe, expect, it } from 'vitest';
import { EnvProvider } from '../src/providers/env';
import type { NodeUIConfig, ProviderContext } from '../src/types';

function makeCtx(
  env: Record<string, string | undefined>,
  store: Record<string, unknown> = {},
): ProviderContext {
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
  return { config, env, store };
}

describe('EnvProvider', () => {
  it('returns the environment sorted by key', () => {
    const provider = new EnvProvider();
    const result = provider.get(makeCtx({ ZETA: '1', ALPHA: '2', BETA: undefined }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.environment).toEqual([
      { key: 'ALPHA', value: '2' },
      { key: 'BETA', value: '' },
      { key: 'ZETA', value: '1' },
    ]);
    expect(result.data.config).toBeNull();
  });

  it('surfaces the app config from the store, resolving getters', () => {
    const provider = new EnvProvider();
    const ctx = makeCtx({}, { 'app-config': () => ({ name: 'demo', PORT: 3000 }) });
    const result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.config).toEqual([
      { key: 'PORT', value: '3000' },
      { key: 'name', value: 'demo' },
    ]);
  });

  it('stringifies non-string config values', () => {
    const provider = new EnvProvider();
    const ctx = makeCtx({}, { 'app-config': { nested: { deep: true } } });
    const result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.config?.[0]).toEqual({ key: 'nested', value: '{"deep":true}' });
  });
});
