import type { RequestEntry } from './types';

type Entry = Pick<RequestEntry, 'method' | 'path'> &
  Partial<Pick<RequestEntry, 'query' | 'headers' | 'requestBody' | 'requestBodyTruncated'>>;

const SKIPPED = new Set([
  'host',
  'content-length',
  'connection',
  'accept-encoding',
  'transfer-encoding',
]);

function urlOf(entry: Entry, origin: string): string {
  const search = entry.query ? new URLSearchParams(entry.query).toString() : '';
  return `${origin}${entry.path}${search ? `?${search}` : ''}`;
}

function usableHeaders(entry: Entry): Array<[string, string]> {
  return Object.entries(entry.headers ?? {}).filter(
    ([name, value]) => !SKIPPED.has(name) && value !== '[REDACTED]',
  );
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

/** `fetch()` call that reproduces the request (credentials left out). */
export function toFetch(entry: Entry, origin: string): string {
  const headers = usableHeaders(entry);
  const lines = [`method: ${JSON.stringify(entry.method)},`];
  if (headers.length > 0) {
    lines.push(
      'headers: {',
      ...headers.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
      '},',
    );
  }
  if (entry.requestBody && !entry.requestBodyTruncated) {
    lines.push(`body: ${JSON.stringify(entry.requestBody)},`);
  }
  return `await fetch(${JSON.stringify(urlOf(entry, origin))}, {\n${lines.map((l) => `  ${l}`).join('\n')}\n});`;
}

/** autocannon command that hammers this request (10 connections for 10 seconds). */
export function toAutocannon(entry: Entry, origin: string): string {
  const parts = ['npx autocannon -c 10 -d 10', `-m ${entry.method}`];
  for (const [k, v] of usableHeaders(entry)) parts.push(`-H ${shellQuote(`${k}=${v}`)}`);
  if (entry.requestBody && !entry.requestBodyTruncated) {
    parts.push(`-b ${shellQuote(entry.requestBody)}`);
  }
  parts.push(shellQuote(urlOf(entry, origin)));
  return parts.join(' \\n  ');
}
