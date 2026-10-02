import { createRequire } from 'node:module';
import { join } from 'node:path';
import { currentRequestId } from '../context';
import { RingBuffer } from '../ring-buffer';
import type { NodeUIProvider, QueriesData, QueryEntry } from '../types';

const RESPONSE_PAGE_SIZE = 100;
const MAX_SQL_CHARS = 2000;
/** Same normalized statement this many times within one request is flagged as N+1. */
export const N_PLUS_ONE_THRESHOLD = 5;

type Recorder = (entry: Omit<QueryEntry, 'id'>) => void;
type AnyFn = (...args: unknown[]) => unknown;

/** Loads an optional driver from the host app's dependency tree. */
export type DriverLoader = (name: string) => unknown;

const defaultLoader: DriverLoader = (name) => {
  try {
    return createRequire(join(process.cwd(), 'noop.js'))(name);
  } catch {
    return null;
  }
};

const recorders = new Set<Recorder>();
const restorers: Array<() => void> = [];

/** Collapses literals so repeated statements compare equal. */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, '(?)')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function emit(entry: Omit<QueryEntry, 'id'>): void {
  for (const record of recorders) {
    try {
      record(entry);
    } catch {
      // instrumentation must never throw into the host app
    }
  }
}

function sqlOf(arg: unknown): string | null {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object') {
    const candidate =
      (arg as { text?: unknown; sql?: unknown }).text ?? (arg as { sql?: unknown }).sql;
    if (typeof candidate === 'string') return candidate;
  }
  return null;
}

function rowCountOf(result: unknown): number | undefined {
  if (Array.isArray(result)) {
    // mysql2 resolves to [rows, fields]; plain arrays are row lists
    const first = result[0];
    return Array.isArray(first) ? first.length : result.length;
  }
  if (result && typeof result === 'object') {
    const r = result as { rowCount?: unknown; affectedRows?: unknown };
    if (typeof r.rowCount === 'number') return r.rowCount;
    if (typeof r.affectedRows === 'number') return r.affectedRows;
  }
  return undefined;
}

/**
 * Wraps a driver's `query`-style method. Handles callbacks, promises and
 * event-emitter results, records exactly once per call and never alters the
 * value, errors or timing semantics seen by the app.
 */
function wrapQueryMethod(
  proto: Record<string, unknown>,
  method: string,
  system: string,
  rowCount: (result: unknown, extra?: unknown) => number | undefined,
): void {
  const original = proto[method];
  if (typeof original !== 'function') return;
  const orig = original as AnyFn;
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    if (recorders.size === 0) return orig.apply(this, args);
    const sql = sqlOf(args[0]);
    if (sql === null) return orig.apply(this, args);

    const started = process.hrtime.bigint();
    const timestampMs = Date.now();
    const requestId = currentRequestId();
    let done = false;
    const finish = (error?: unknown, result?: unknown): void => {
      if (done) return;
      done = true;
      emit({
        system,
        sql: sql.slice(0, MAX_SQL_CHARS),
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        timestampMs,
        ...(requestId !== undefined ? { requestId } : {}),
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
        ...(!error && rowCount(result) !== undefined ? { rowCount: rowCount(result) } : {}),
      });
    };

    const last = args.length - 1;
    const hasCallback = typeof args[last] === 'function';
    if (hasCallback) {
      const callback = args[last] as AnyFn;
      args[last] = function (this: unknown, err: unknown, result: unknown, ...rest: unknown[]) {
        finish(err, result);
        return callback.call(this, err, result, ...rest);
      };
    }

    const ret = orig.apply(this, args) as unknown;
    if (!hasCallback && ret && typeof (ret as { then?: unknown }).then === 'function') {
      (ret as Promise<unknown>).then(
        (result) => finish(undefined, result),
        (error: unknown) => finish(error ?? new Error('query failed')),
      );
    } else if (!hasCallback && ret && typeof (ret as { once?: unknown }).once === 'function') {
      const emitter = ret as { once(e: string, fn: (...a: unknown[]) => void): void };
      emitter.once('end', (result: unknown) => finish(undefined, result));
      emitter.once('error', (error: unknown) => finish(error ?? new Error('query failed')));
    }
    return ret;
  };
  proto[method] = wrapped;
  restorers.push(() => {
    if (proto[method] === wrapped) proto[method] = original;
  });
}

function instrumentDrivers(load: DriverLoader): void {
  const pg = load('pg') as { Client?: { prototype: Record<string, unknown> } } | null;
  if (pg?.Client?.prototype) wrapQueryMethod(pg.Client.prototype, 'query', 'pg', rowCountOf);

  const mysql2 = load('mysql2') as { Connection?: { prototype: Record<string, unknown> } } | null;
  const proto = mysql2?.Connection?.prototype;
  if (proto) {
    wrapQueryMethod(proto, 'query', 'mysql2', rowCountOf);
    wrapQueryMethod(proto, 'execute', 'mysql2', rowCountOf);
  }
}

/**
 * Refcounted instrumentation of installed database drivers (`pg`, `mysql2`),
 * resolved from the host app's dependencies. Drivers that are not installed are
 * skipped. The last release restores the original methods.
 */
export function interceptQueries(record: Recorder, load: DriverLoader = defaultLoader): () => void {
  const first = recorders.size === 0;
  recorders.add(record);
  if (first) {
    try {
      instrumentDrivers(load);
    } catch {
      // a driver we cannot patch must not break the host app
    }
  }
  return () => {
    if (!recorders.delete(record) || recorders.size > 0) return;
    while (restorers.length > 0) restorers.pop()?.();
  };
}

export interface QueriesProviderOptions {
  size: number;
  slowQueryMs: number;
  loader?: DriverLoader;
}

/** Recent database queries with slow-query and N+1 flags. */
export class QueriesProvider implements NodeUIProvider<QueriesData> {
  readonly id = 'queries' as const;

  private buffer: RingBuffer<QueryEntry>;
  private nextId = 1;
  private release: (() => void) | null = null;
  private failed = 0;

  constructor(private readonly options: QueriesProviderOptions) {
    this.buffer = new RingBuffer<QueryEntry>(options.size);
  }

  start(): void {
    if (this.release) return;
    this.release = interceptQueries((entry) => this.record(entry), this.options.loader);
  }

  stop(): void {
    this.release?.();
    this.release = null;
  }

  record(entry: Omit<QueryEntry, 'id'>): void {
    this.buffer.push({ id: this.nextId, ...entry });
    this.nextId += 1;
    if (entry.error) this.failed += 1;
  }

  get(): { ok: true; data: QueriesData } {
    const all = this.buffer.toArray();
    // N+1: the same normalized statement repeated within one request.
    const counts = new Map<string, number>();
    const keyOf = (e: QueryEntry): string | null =>
      e.requestId === undefined ? null : `${e.requestId}|${normalizeSql(e.sql)}`;
    for (const e of all) {
      const key = keyOf(e);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const flagged = new Set<string>();
    const entries = all.map((e) => {
      const key = keyOf(e);
      const repeats = key ? (counts.get(key) ?? 0) : 0;
      const nPlusOne = repeats >= N_PLUS_ONE_THRESHOLD;
      if (nPlusOne && key) flagged.add(key);
      return {
        ...e,
        slow: e.durationMs >= this.options.slowQueryMs,
        ...(nPlusOne ? { nPlusOne, repeats } : {}),
      };
    });
    return {
      ok: true,
      data: {
        total: this.nextId - 1,
        failed: this.failed,
        slow: entries.filter((e) => e.slow).length,
        nPlusOneGroups: flagged.size,
        slowQueryMs: this.options.slowQueryMs,
        entries: entries.slice(Math.max(0, entries.length - RESPONSE_PAGE_SIZE)),
      },
    };
  }
}
