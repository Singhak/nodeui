import { SECRET_MASKED } from './constants';

/** Keys whose values are redacted in any panel output. */
export const SECRET_KEY_PATTERN = /token|key|secret|password|credential/i;

export interface ActivationDecision {
  active: boolean;
  reason: string;
}

/**
 * Safety-gate activation. The console is active when `NODEUI_ENABLED=true`
 * or when `NODE_ENV` is not `production`. `NODEUI_ENABLED=false` explicitly
 * disables it everywhere (including development). Otherwise it fails closed.
 */
export function resolveActivation(env: Record<string, string | undefined>): ActivationDecision {
  if (env.NODEUI_ENABLED === 'true') {
    return { active: true, reason: 'activated by NODEUI_ENABLED=true' };
  }
  if (env.NODEUI_ENABLED === 'false') {
    return { active: false, reason: 'inactive: explicitly disabled by NODEUI_ENABLED=false' };
  }
  if (env.NODE_ENV !== 'production') {
    return {
      active: true,
      reason: `activated by NODE_ENV="${env.NODE_ENV ?? 'unset'}" (non-production)`,
    };
  }
  return {
    active: false,
    reason: "inactive: NODE_ENV=production and NODEUI_ENABLED is not 'true' (fail-closed)",
  };
}

/** True when the socket address is a loopback address. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return (
    address.startsWith('127.') ||
    address === '::1' ||
    address.startsWith('::ffff:127.') ||
    address === 'localhost'
  );
}

/**
 * Deep-clone a value, replacing any value under a key matching the secret
 * pattern with `[REDACTED]`. The input is not mutated.
 */
export function maskSecrets<T>(value: T, pattern: RegExp = SECRET_KEY_PATTERN): T {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map((v) => maskSecrets(v, pattern)) as T;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length === 2 &&
      keys.includes('key') &&
      keys.includes('value') &&
      typeof record.key === 'string'
    ) {
      const masked = pattern.test(record.key) ? SECRET_MASKED : record.value;
      return { key: record.key, value: maskSecrets(masked, pattern) } as T;
    }
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (pattern.test(key)) {
        out[key] = SECRET_MASKED;
      } else {
        out[key] = maskSecrets(v, pattern);
      }
    }
    return out as T;
  }
  return value;
}
