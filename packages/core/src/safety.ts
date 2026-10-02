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
 * Parses an IPv6 literal (`::1`, `fd00::1`, `64:ff9b::1.2.3.4`, optional `%zone`)
 * into its 128-bit value, or null when it is not valid.
 */
function ipv6ToBigInt(address: string): bigint | null {
  const text = address.split('%')[0] ?? '';
  if (!text.includes(':')) return null;
  let head = text;
  let tailGroups: string[] = [];
  const doubleColon = text.indexOf('::');
  if (doubleColon !== -1) {
    if (text.indexOf('::', doubleColon + 1) !== -1) return null;
    head = text.slice(0, doubleColon);
    const tail = text.slice(doubleColon + 2);
    tailGroups = tail === '' ? [] : tail.split(':');
  }
  const headGroups = doubleColon !== -1 ? (head === '' ? [] : head.split(':')) : text.split(':');
  const groups = doubleColon !== -1 ? [...headGroups, ...tailGroups] : headGroups;

  // An embedded IPv4 tail (`::ffff:1.2.3.4`) takes the place of two groups.
  const last = groups[groups.length - 1];
  const v4 = last?.includes('.') ? ipv4ToInt(last) : null;
  if (last?.includes('.')) {
    if (v4 === null) return null;
    groups.splice(
      groups.length - 1,
      1,
      ((v4 >>> 16) & 0xffff).toString(16),
      (v4 & 0xffff).toString(16),
    );
  }
  const expected = 8;
  if (doubleColon === -1 ? groups.length !== expected : groups.length >= expected) return null;
  const parseGroup = (g: string): bigint | null =>
    /^[0-9a-f]{1,4}$/i.test(g) ? BigInt(`0x${g}`) : null;

  const headLen = doubleColon !== -1 ? headGroups.length : groups.length;
  const fill = expected - groups.length;
  const full: string[] = [
    ...groups.slice(0, headLen),
    ...Array<string>(doubleColon !== -1 ? fill : 0).fill('0'),
    ...groups.slice(headLen),
  ];
  let out = 0n;
  for (const g of full) {
    const n = parseGroup(g);
    if (n === null) return null;
    out = (out << 16n) | n;
  }
  return out;
}

/** True when `entry` is an exact IP or an IPv4/IPv6 CIDR that {@link matchesAddress} understands. */
export function isValidAddressEntry(entry: string): boolean {
  const normalized = normalizeIp(entry);
  if (!normalized.includes('/'))
    return ipv4ToInt(normalized) !== null || ipv6ToBigInt(normalized) !== null;
  const [base = '', bitsRaw = ''] = normalized.split('/');
  const bits = Number(bitsRaw);
  if (!/^\d{1,3}$/.test(bitsRaw) || !Number.isInteger(bits)) return false;
  if (ipv4ToInt(base) !== null) return bits <= 32;
  return ipv6ToBigInt(base) !== null && bits <= 128;
}

/**
 * True when `address` matches one of `allowed`, each an exact IP or a CIDR
 * (e.g. `172.17.0.0/16`, the default Docker bridge network, or `fd00::/8`).
 * IPv4-mapped IPv6 addresses compare as their IPv4 form; IPv6 literals compare
 * by value, so `::1` equals `0:0:0:0:0:0:0:1`.
 */
export function matchesAddress(address: string | undefined, allowed: readonly string[]): boolean {
  if (!address) return false;
  const ip = normalizeIp(address);
  const ip4 = ipv4ToInt(ip);
  const ip6 = ip4 === null ? ipv6ToBigInt(ip) : null;
  for (const raw of allowed) {
    const entry = normalizeIp(raw);
    if (!entry.includes('/')) {
      if (entry === ip) return true;
      const e4 = ipv4ToInt(entry);
      if (ip4 !== null && e4 !== null) {
        if (ip4 === e4) return true;
        continue;
      }
      const e6 = ipv6ToBigInt(entry);
      if (ip6 !== null && e6 !== null && ip6 === e6) return true;
      continue;
    }
    const [base = '', bitsRaw = ''] = entry.split('/');
    if (!/^\d{1,3}$/.test(bitsRaw)) continue;
    const bits = Number(bitsRaw);
    const b4 = ipv4ToInt(base);
    if (b4 !== null) {
      if (ip4 === null || bits > 32) continue;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((ip4 & mask) >>> 0 === (b4 & mask) >>> 0) return true;
      continue;
    }
    const b6 = ipv6ToBigInt(base);
    if (b6 === null || ip6 === null || bits > 128) continue;
    const shift = BigInt(128 - bits);
    if (ip6 >> shift === b6 >> shift) return true;
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
