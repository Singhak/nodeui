import type { EnvData, EnvEntry, NodeUIProvider, ProviderContext } from '../types';

function stringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function toEntries(source: Record<string, unknown>): EnvEntry[] {
  return Object.entries(source)
    .map(([key, value]) => ({ key, value: stringify(value) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Environment and app-config viewer. The environment comes from the process
 * env snapshot; secret masking is applied later at serialization time.
 */
export class EnvProvider implements NodeUIProvider<EnvData> {
  readonly id = 'env' as const;

  get(ctx: ProviderContext): { ok: true; data: EnvData } {
    const environment = toEntries(ctx.env as Record<string, unknown>);
    const rawConfig = ctx.store['app-config'];
    let config: EnvEntry[] | null = null;
    if (rawConfig !== undefined) {
      const resolved = typeof rawConfig === 'function' ? rawConfig() : rawConfig;
      if (resolved !== undefined && resolved !== null) {
        config = toEntries(resolved as Record<string, unknown>);
      }
    }
    return { ok: true, data: { environment, config } };
  }
}
