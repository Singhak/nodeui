import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  hostnameFromHostHeader,
  isLoopbackAddress,
  isLoopbackHostname,
  matchesAddress,
} from './safety';

export const AUTH_COOKIE = 'nodeui_token';

export interface GuardOptions {
  /** Configured console host; a loopback value enables the strict checks. */
  host: string;
  /** Extra `Host` header hostnames accepted (e.g. `myapp.local`). */
  allowedHosts: readonly string[];
  /** Extra `Origin` values accepted for cross-origin calls. */
  allowedOrigins: readonly string[];
  /** Extra remote IPs / IPv4 CIDRs accepted (e.g. `172.17.0.0/16` for Docker). */
  allowedRemoteAddresses: readonly string[];
  /** Accept requests carrying `X-Forwarded-*` headers. Default false. */
  trustProxy: boolean;
  /** When set, every request must present this token. */
  authToken?: string;
}

export type GuardResult =
  { ok: true; setToken?: string } | { ok: false; status: number; code: string; message: string };

const FORWARD_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip'];

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function tokenEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function deny(status: number, code: string, message: string): GuardResult {
  return { ok: false, status, code, message };
}

/**
 * Builds the request guard for the console. It combines: loopback/remote
 * address policy, `Host` validation (DNS-rebinding defence), `Origin`
 * validation (cross-site request defence) and an optional shared token.
 */
export function createGuard(options: GuardOptions): (req: IncomingMessage) => GuardResult {
  const strict = isLoopbackAddress(options.host);
  const allowedHosts = options.allowedHosts.map((h) => h.toLowerCase());
  const allowedOrigins = options.allowedOrigins.map((o) => o.toLowerCase().replace(/\/+$/, ''));

  return (req) => {
    const remote = req.socket.remoteAddress;
    const remoteLoopback = isLoopbackAddress(remote);
    const remoteAllowed = remoteLoopback || matchesAddress(remote, options.allowedRemoteAddresses);

    if (strict && !remoteAllowed) {
      return deny(
        403,
        'forbidden',
        'nodeui is loopback-only; requests from other hosts are rejected',
      );
    }
    if (!strict && options.allowedRemoteAddresses.length > 0 && !remoteAllowed) {
      return deny(403, 'forbidden', 'remote address is not in the nodeui allow-list');
    }

    if (strict && !options.trustProxy && !matchesAddress(remote, options.allowedRemoteAddresses)) {
      if (FORWARD_HEADERS.some((h) => req.headers[h] !== undefined)) {
        return deny(
          403,
          'forbidden',
          'proxied requests are rejected (set trustProxy to allow forwarded traffic)',
        );
      }
    }

    const hostHeader = firstHeader(req.headers.host);
    const hostname = hostnameFromHostHeader(hostHeader);
    if (hostname !== null) {
      const hostOk =
        isLoopbackHostname(hostname) ||
        allowedHosts.includes(hostname) ||
        (!strict && allowedHosts.length === 0);
      if (!hostOk) {
        return deny(
          403,
          'forbidden',
          `Host "${hostname}" is not allowed (add it to allowedHosts to use nodeui via this name)`,
        );
      }
    }

    const origin = firstHeader(req.headers.origin);
    if (origin !== undefined) {
      let originOk = false;
      const normalized = origin.toLowerCase().replace(/\/+$/, '');
      if (allowedOrigins.includes(normalized)) {
        originOk = true;
      } else {
        try {
          originOk = hostHeader !== undefined && new URL(origin).host === hostHeader.toLowerCase();
        } catch {
          originOk = false;
        }
      }
      if (!originOk) {
        return deny(403, 'forbidden', 'cross-origin requests to nodeui are rejected');
      }
    }

    if (options.authToken) {
      const authHeader = firstHeader(req.headers.authorization);
      const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      const queryToken = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token');
      const cookieToken = readCookie(firstHeader(req.headers.cookie), AUTH_COOKIE);
      const candidates = [
        bearer,
        firstHeader(req.headers['x-nodeui-token']),
        cookieToken,
        queryToken ?? undefined,
      ];
      const matched = candidates.find((c) => c !== undefined && tokenEquals(c, options.authToken!));
      if (matched === undefined) {
        return deny(401, 'unauthorized', 'a valid nodeui token is required');
      }
      if (queryToken !== null && matched === queryToken) {
        return { ok: true, setToken: queryToken };
      }
    }

    return { ok: true };
  };
}
