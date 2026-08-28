import { DEFAULT_LOG_SIZE } from '../constants';
import { RingBuffer } from '../ring-buffer';
import type { LogEntry, LogLevel, LogsData, NodeUIProvider, ProviderContext } from '../types';

const CONSOLE_METHODS: Array<[keyof Console, LogLevel]> = [
  ['debug', 'debug'],
  ['info', 'info'],
  ['log', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
];

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  try {
    const json = JSON.stringify(arg);
    return json === undefined ? String(arg) : json;
  } catch {
    return String(arg);
  }
}

let refs = 0;
const pushes = new Set<(entry: Omit<LogEntry, 'timestamp'>) => void>();
const wrappers = new Map<keyof Console, (...args: unknown[]) => void>();
let originals: Partial<Record<keyof Console, (...args: unknown[]) => void>> = {};

function consoleRef(): Record<string, (...args: unknown[]) => void> {
  return console as unknown as Record<string, (...args: unknown[]) => void>;
}

function installWrappers(): void {
  for (const [method, level] of CONSOLE_METHODS) {
    const original = consoleRef()[method];
    originals[method] = original;
    const wrapper = (...args: unknown[]): void => {
      for (const push of pushes) {
        try {
          push({ level, message: args.map(formatArg).join(' ') });
        } catch {
          // interception must never throw into the caller
        }
      }
      if (original) original(...args);
    };
    wrappers.set(method, wrapper);
    consoleRef()[method] = wrapper;
  }
}

function uninstallWrappers(): void {
  for (const [method] of CONSOLE_METHODS) {
    const current = consoleRef()[method];
    if (current === wrappers.get(method)) {
      const original = originals[method];
      if (original) {
        consoleRef()[method] = original;
      } else {
        delete consoleRef()[method];
      }
    }
    // If another layer patched console after us, the current method is not
    // ours — leave the chain intact so the host app's interceptor survives.
  }
  wrappers.clear();
  originals = {};
}

/**
 * Wraps `console.debug/info/log/warn/error` to tee entries to every active
 * `push` callback. Refcounted: the first install replaces the methods, the
 * last release restores the originals. Supports concurrent consumers (e.g.
 * multiple `createNodeUI()` instances) — each registers its own push and is
 * removed independently. Never throws into the caller.
 */
export function interceptConsole(push: (entry: Omit<LogEntry, 'timestamp'>) => void): () => void {
  refs += 1;
  pushes.add(push);
  if (refs === 1) installWrappers();
  return () => {
    pushes.delete(push);
    refs = Math.max(0, refs - 1);
    if (refs === 0) uninstallWrappers();
  };
}

/**
 * Log viewer provider. While active it intercepts `console.*` output and
 * also accepts entries pushed via {@link addSource}. Filtering happens
 * server-side via `ctx.query.level` and `ctx.query.query`.
 */
export class LogsProvider implements NodeUIProvider<LogsData> {
  readonly id = 'logs' as const;

  private buffer: RingBuffer<LogEntry>;
  private release: (() => void) | null = null;

  constructor(size: number = DEFAULT_LOG_SIZE) {
    this.buffer = new RingBuffer<LogEntry>(size);
  }

  start(): void {
    if (this.release) return;
    this.release = interceptConsole(({ level, message }) => {
      this.buffer.push({ level, message, timestamp: Date.now() });
    });
  }

  stop(): void {
    this.release?.();
    this.release = null;
  }

  /** Pushes an external entry (logger adapter). */
  addSource(entry: { level: LogLevel; message: string }): void {
    this.buffer.push({ ...entry, timestamp: Date.now() });
  }

  get(ctx: ProviderContext): { ok: true; data: LogsData } {
    let entries = this.buffer.toArray();
    const level = ctx.query?.level;
    if (level) entries = entries.filter((e) => e.level === level);
    const query = ctx.query?.query;
    if (query) {
      const needle = query.toLowerCase();
      entries = entries.filter((e) => e.message.toLowerCase().includes(needle));
    }
    return { ok: true, data: { entries } };
  }
}
