import http from 'node:http';
import { SECRET_MASKED } from './constants';
import { isLoopbackAddress } from './safety';
import type { ReplayRequest, ReplayResult } from './types';

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const SKIP_HEADERS =
  /^(host|connection|content-length|transfer-encoding|keep-alive|upgrade|expect)$/i;
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 30_000;
const TEXTUAL = /json|text|xml|x-www-form-urlencoded|javascript|graphql|html|svg/i;

/** Where the app is listening, learned from the socket of a real request. */
export interface ReplayTarget {
  host: string;
  port: number;
}

export class ReplayError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A single-slash absolute path with no whitespace or control characters. */
function isSafePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** Validates user input; only the path, never the host, is user-controlled. */
export function normalizeReplayRequest(input: ReplayRequest): Required<ReplayRequest> {
  const method = String(input.method ?? 'GET').toUpperCase();
  if (!METHODS.has(method)) throw new ReplayError('bad-request', `Unsupported method ${method}`);
  const path = String(input.path ?? '');
  if (!isSafePath(path)) {
    throw new ReplayError('bad-request', 'path must start with a single "/" and contain no spaces');
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (typeof value !== 'string' || value === SECRET_MASKED) continue; // never send masked placeholders
    if (SKIP_HEADERS.test(name) || !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) continue;
    if (/[\r\n]/.test(value))
      throw new ReplayError('bad-request', `Invalid header value for ${name}`);
    headers[name.toLowerCase()] = value;
  }
  const body = typeof input.body === 'string' ? input.body : '';
  return { method, path, headers, body };
}

/**
 * Re-sends a request to the app itself (the address of its own listening socket).
 * The target is never taken from user input, so this cannot be pointed elsewhere.
 */
export function replayRequest(
  target: ReplayTarget | null,
  input: ReplayRequest,
): Promise<ReplayResult> {
  const req = normalizeReplayRequest(input);
  if (!target || !isLoopbackAddress(target.host)) {
    return Promise.reject(
      new ReplayError(
        'no-target',
        target
          ? 'Replay is limited to apps listening on a loopback address.'
          : 'No request has reached the app yet, so its address is unknown. Send one first.',
      ),
    );
  }
  const headers: Record<string, string | number> = {
    ...req.headers,
    'x-nodeui-replay': '1',
  };
  if (req.body.length > 0 && req.method !== 'GET' && req.method !== 'HEAD') {
    headers['content-length'] = Buffer.byteLength(req.body);
  }
  return new Promise<ReplayResult>((resolve, reject) => {
    const started = process.hrtime.bigint();
    const out = http.request(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: req.path,
        headers,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (size < MAX_RESPONSE_BYTES) {
            const take = chunk.subarray(0, MAX_RESPONSE_BYTES - size);
            chunks.push(take);
            size += take.length;
          }
        });
        res.on('end', () => {
          const responseHeaders: Record<string, string> = {};
          for (const [name, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            responseHeaders[name] = Array.isArray(value) ? value.join(', ') : value;
          }
          const type = responseHeaders['content-type'] ?? '';
          const textual = type === '' || TEXTUAL.test(type);
          resolve({
            status: res.statusCode ?? 0,
            statusMessage: res.statusMessage ?? '',
            headers: responseHeaders,
            durationMs: Number(process.hrtime.bigint() - started) / 1e6,
            sizeBytes: total,
            body: textual ? Buffer.concat(chunks).toString('utf8') : '',
            bodyTruncated: textual && total > MAX_RESPONSE_BYTES,
            binary: !textual,
          });
        });
        res.on('error', (err) => reject(new ReplayError('upstream-error', err.message)));
      },
    );
    out.on('timeout', () => out.destroy(new Error('Request timed out after 30s')));
    out.on('error', (err) => reject(new ReplayError('upstream-error', err.message)));
    if (req.body.length > 0 && req.method !== 'GET' && req.method !== 'HEAD') out.write(req.body);
    out.end();
  });
}
