import { SECRET_MASKED } from './constants';

/** Keys whose values are redacted in any panel output. */
export const SECRET_KEY_PATTERN =
  /token|key|secret|passw(?:or)?d|credential|auth|cookie|dsn|private|signature|session|bearer|connection.?string|database.?url|conn.?str/i;

/** Secret-looking `name=value` / `"name":"value"` pairs inside free text. */
const TEXT_PAIR_PATTERN =
  /\b([\w.-]*(?:token|secret|passw(?:or)?d|api[_-]?key|credential|authorization|cookie|dsn)[\w.-]*["']?)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&"'}]+)/gi;
const URL_CREDENTIALS_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi;
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;

/**
 * Redacts secrets embedded in free text: credentials in URLs
 * (`postgres://user:pass@host`), bearer/basic tokens, JWTs and
 * `password=...`-style pairs. Used for log lines and any string value.
 */
export function maskSecretText(text: string): string {
  if (text.length < 6) return text;
  return text
    .replace(URL_CREDENTIALS_PATTERN, `$1${SECRET_MASKED}$2`)
    .replace(BEARER_PATTERN, `$1 ${SECRET_MASKED}`)
    .replace(JWT_PATTERN, SECRET_MASKED)
    .replace(TEXT_PAIR_PATTERN, (_m, name: string, sep: string, value: string) => {
      // Keep quotes so masked JSON-ish text stays well-formed.
      const quote = value.startsWith('"') || value.startsWith("'") ? value[0] : '';
      return `${name}${sep}${quote}${SECRET_MASKED}${quote}`;
    });
}

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

/** Strips the IPv4-mapped IPv6 prefix so `::ffff:10.0.0.1` compares as `10.0.0.1`. */
function normalizeIp(address: string): string {
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

/**
 * True when `address` matches one of `allowed`, each an exact IP or an IPv4
 * CIDR (e.g. `172.17.0.0/16`, the default Docker bridge network).
 */
export function matchesAddress(address: string | undefined, allowed: readonly string[]): boolean {
  if (!address) return false;
  const ip = normalizeIp(address);
  for (const entry of allowed) {
    if (!entry.includes('/')) {
      if (normalizeIp(entry) === ip) return true;
      continue;
    }
    const [base, bitsRaw] = entry.split('/');
    const bits = Number(bitsRaw);
    const a = ipv4ToInt(ip);
    const b = ipv4ToInt(base ?? '');
    if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((a & mask) >>> 0 === (b & mask) >>> 0) return true;
  }
  return false;
}

/** Extracts the lower-cased hostname from a `Host` header value (no port). */
export function hostnameFromHostHeader(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end === -1 ? null : trimmed.slice(1, end);
  }
  return trimmed.split(':')[0] || null;
}

/** True for the hostnames a browser uses to reach a loopback server. */
export function isLoopbackHostname(hostname: string | null): boolean {
  if (!hostname) return false;
  return hostname === 'localhost' || hostname.endsWith('.localhost') || isLoopbackAddress(hostname);
}

/**
 * Deep-clone a value, replacing any value under a key matching the secret
 * pattern with `[REDACTED]` and scrubbing secrets embedded in string values
 * (URL credentials, bearer tokens, `password=...`). The input is not mutated.
 */
export function maskSecrets<T>(value: T, pattern: RegExp = SECRET_KEY_PATTERN): T {
  if (typeof value === 'string') {
    return maskSecretText(value) as T;
  }
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
