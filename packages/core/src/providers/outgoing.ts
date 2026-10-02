import diagnosticsChannel from 'node:diagnostics_channel';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { currentRequestId } from '../context';
import { RingBuffer } from '../ring-buffer';
import type { NodeUIProvider, OutgoingData, OutgoingRequestEntry } from '../types';

const RESPONSE_PAGE_SIZE = 100;

type Recorder = (entry: Omit<OutgoingRequestEntry, 'id'>) => void;
type AnyFn = (...args: unknown[]) => unknown;

const recorders = new Set<Recorder>();
const originals = new Map<string, AnyFn>();
let undiciUnsubscribe: (() => void) | null = null;

function describeTarget(
  defaultProtocol: string,
  args: unknown[],
): { method: string; url: string } | null {
  try {
    let method = 'GET';
    let host = 'unknown';
    let path = '/';
    const [first, second] = args;
    const opts =
      typeof first === 'string' || first instanceof URL
        ? (second as Record<string, unknown> | undefined)
        : (first as Record<string, unknown> | undefined);
    if (typeof first === 'string' || first instanceof URL) {
      const parsed = new URL(first.toString());
      host = parsed.host;
      path = parsed.pathname;
    }
    if (opts && typeof opts === 'object') {
      if (typeof opts.method === 'string') method = opts.method.toUpperCase();
      if (typeof first !== 'string' && !(first instanceof URL)) {
        const name = (opts.hostname ?? opts.host ?? 'localhost') as string;
        host = opts.port ? `${name}:${String(opts.port)}` : name;
        path = typeof opts.path === 'string' ? (opts.path.split('?')[0] ?? '/') : '/';
        const protocol = typeof opts.protocol === 'string' ? opts.protocol : defaultProtocol;
        return { method, url: `${protocol}//${host}${path}` };
      }
    }
    return { method, url: `${defaultProtocol}//${host}${path}` };
  } catch {
    return null;
  }
}

function emit(entry: Omit<OutgoingRequestEntry, 'id'>): void {
  for (const record of recorders) {
    try {
      record(entry);
    } catch {
      // instrumentation must never throw into the host app
    }
  }
}

function wrapModule(mod: typeof http | typeof https, protocol: string): void {
  for (const name of ['request', 'get'] as const) {
    const key = `${protocol}${name}`;
    const original = mod[name] as unknown as AnyFn;
    originals.set(key, original);
    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      const req = original.apply(this, args) as http.ClientRequest;
      const target = recorders.size > 0 ? describeTarget(protocol, args) : null;
      if (target && req && typeof req.once === 'function') {
        const started = process.hrtime.bigint();
        const timestampMs = Date.now();
        const requestId = currentRequestId();
        let done = false;
        const finish = (status: number | null, error?: string): void => {
          if (done) return;
          done = true;
          emit({
            ...target,
            status,
            durationMs: Number(process.hrtime.bigint() - started) / 1e6,
            timestampMs,
            ...(requestId !== undefined ? { requestId } : {}),
            ...(error ? { error } : {}),
          });
        };
        req.once('response', (res: http.IncomingMessage) => {
          const status = res.statusCode ?? null;
          res.once('end', () => finish(status));
          res.once('close', () => finish(status));
        });
        req.once('error', (err: Error) => finish(null, err.message));
      }
      return req;
    };
    (mod as unknown as Record<string, AnyFn>)[name] = wrapped;
  }
  // ESM consumers (`import { request } from 'node:http'`) only see the patch after a sync.
  syncBuiltinESMExports();
}

function unwrapModule(mod: typeof http | typeof https, protocol: string): void {
  for (const name of ['request', 'get'] as const) {
    const original = originals.get(`${protocol}${name}`);
    if (original) (mod as unknown as Record<string, AnyFn>)[name] = original;
    originals.delete(`${protocol}${name}`);
  }
  syncBuiltinESMExports();
}

interface UndiciRequest {
  origin?: string | URL;
  path?: string;
  method?: string;
}

function subscribeUndici(): () => void {
  const started = new WeakMap<object, { at: bigint; ts: number; requestId?: number }>();
  const statuses = new WeakMap<object, number>();
  const target = (req: UndiciRequest): { method: string; url: string } => ({
    method: (req.method ?? 'GET').toUpperCase(),
    url: `${String(req.origin ?? '')}${(req.path ?? '/').split('?')[0]}`,
  });
  const onCreate = (message: unknown): void => {
    const request = (message as { request?: object }).request;
    if (request) {
      started.set(request, {
        at: process.hrtime.bigint(),
        ts: Date.now(),
        requestId: currentRequestId(),
      });
    }
  };
  const onHeaders = (message: unknown): void => {
    const { request, response } = message as {
      request?: object;
      response?: { statusCode?: number };
    };
    if (request && typeof response?.statusCode === 'number') {
      statuses.set(request, response.statusCode);
    }
  };
  const finish = (request: object | undefined, error?: string): void => {
    if (!request) return;
    const begin = started.get(request);
    if (!begin) return;
    started.delete(request);
    emit({
      ...target(request as UndiciRequest),
      status: statuses.get(request) ?? null,
      durationMs: Number(process.hrtime.bigint() - begin.at) / 1e6,
      timestampMs: begin.ts,
      ...(begin.requestId !== undefined ? { requestId: begin.requestId } : {}),
      ...(error ? { error } : {}),
    });
  };
  const onTrailers = (message: unknown): void => finish((message as { request?: object }).request);
  const onError = (message: unknown): void => {
    const { request, error } = message as { request?: object; error?: Error };
    finish(request, error?.message ?? 'request failed');
  };

  diagnosticsChannel.subscribe('undici:request:create', onCreate);
  diagnosticsChannel.subscribe('undici:request:headers', onHeaders);
  diagnosticsChannel.subscribe('undici:request:trailers', onTrailers);
  diagnosticsChannel.subscribe('undici:request:error', onError);
  return () => {
    diagnosticsChannel.unsubscribe('undici:request:create', onCreate);
    diagnosticsChannel.unsubscribe('undici:request:headers', onHeaders);
    diagnosticsChannel.unsubscribe('undici:request:trailers', onTrailers);
    diagnosticsChannel.unsubscribe('undici:request:error', onError);
  };
}

/**
 * Refcounted instrumentation of outgoing HTTP calls made via `http`,
 * `https` (axios, got, node-fetch, ...) and global `fetch` (undici). The
 * first consumer installs the hooks, the last release restores everything.
 */
export function interceptOutgoing(record: Recorder): () => void {
  const first = recorders.size === 0;
  recorders.add(record);
  if (first) {
    wrapModule(http, 'http:');
    wrapModule(https, 'https:');
    try {
      undiciUnsubscribe = subscribeUndici();
    } catch {
      undiciUnsubscribe = null;
    }
  }
  return () => {
    if (!recorders.delete(record) || recorders.size > 0) return;
    unwrapModule(http, 'http:');
    unwrapModule(https, 'https:');
    undiciUnsubscribe?.();
    undiciUnsubscribe = null;
  };
}

/** Recent outgoing HTTP calls, recorded lazily while the panel is active. */
export class OutgoingProvider implements NodeUIProvider<OutgoingData> {
  readonly id = 'outgoing' as const;

  private buffer: RingBuffer<OutgoingRequestEntry>;
  private nextId = 1;
  private failed = 0;
  private release: (() => void) | null = null;

  constructor(size: number) {
    this.buffer = new RingBuffer<OutgoingRequestEntry>(size);
  }

  start(): void {
    if (this.release) return;
    this.release = interceptOutgoing((entry) => this.record(entry));
  }

  stop(): void {
    this.release?.();
    this.release = null;
  }

  record(entry: Omit<OutgoingRequestEntry, 'id'>): void {
    this.buffer.push({ id: this.nextId, ...entry });
    this.nextId += 1;
    if (entry.error || (entry.status !== null && entry.status >= 500)) this.failed += 1;
  }

  get(): { ok: true; data: OutgoingData } {
    const entries = this.buffer.slice(Math.max(0, this.buffer.length - RESPONSE_PAGE_SIZE));
    return { ok: true, data: { total: this.nextId - 1, failed: this.failed, entries } };
  }
}
