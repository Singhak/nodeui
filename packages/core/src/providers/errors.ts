import { createHash } from 'node:crypto';
import { currentRequestId } from '../context';
import type { ErrorGroup, ErrorSource, ErrorsData, NodeUIProvider } from '../types';

const MAX_GROUPS = 100;
const MAX_STACK_CHARS = 4000;
const MAX_MESSAGE_CHARS = 500;
const FINGERPRINT_FRAMES = 3;

function toError(value: unknown): { name: string; message: string; stack: string } {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? '' };
  }
  let message: string;
  try {
    message = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    message = String(value);
  }
  return { name: 'NonError', message: message ?? String(value), stack: '' };
}

/** Function + file of the top frames, without line/column so edits don't split a group. */
function topFrames(stack: string): string[] {
  const frames: string[] = [];
  for (const line of stack.split('\n')) {
    const match = /^\s*at\s+(?:(.+?)\s+\()?(?:.*[\\/])?([^\\/:()]+?)(?::\d+){0,2}\)?\s*$/.exec(
      line,
    );
    if (match) frames.push(`${match[1] ?? ''}@${match[2] ?? ''}`);
    if (frames.length >= FINGERPRINT_FRAMES) break;
  }
  return frames;
}

/** Groups equal failures: same type, same message shape (numbers and ids collapsed), same origin. */
export function fingerprintError(name: string, message: string, stack: string): string {
  const shape = message
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, '#')
    .replace(/\b[0-9a-f]{24}\b/gi, '#')
    .replace(/\d+/g, '#');
  return createHash('sha1')
    .update([name, shape, ...topFrames(stack)].join('\n'))
    .digest('hex')
    .slice(0, 12);
}

/**
 * Groups errors by fingerprint with counts. Process-level failures are observed
 * with `uncaughtExceptionMonitor`, which never changes Node's crash behaviour
 * (unlike an `uncaughtException` or `unhandledRejection` listener, which would
 * suppress the default exit).
 */
export class ErrorsProvider implements NodeUIProvider<ErrorsData> {
  readonly id = 'errors' as const;

  private groups = new Map<string, ErrorGroup>();
  private total = 0;
  private listener: ((err: Error, origin: string) => void) | null = null;

  /** Starts observing process-level failures. Idempotent. */
  attach(): void {
    if (this.listener) return;
    this.listener = (err, origin) =>
      this.record(err, origin === 'unhandledRejection' ? 'rejection' : 'uncaught');
    process.on('uncaughtExceptionMonitor', this.listener);
  }

  detach(): void {
    if (!this.listener) return;
    process.removeListener('uncaughtExceptionMonitor', this.listener);
    this.listener = null;
  }

  record(
    error: unknown,
    source: ErrorSource,
    context: { requestId?: number; route?: string; status?: number } = {},
  ): void {
    try {
      const { name, message, stack } = toError(error);
      const fingerprint = fingerprintError(name, message, stack);
      const now = Date.now();
      const requestId = context.requestId ?? currentRequestId();
      const existing = this.groups.get(fingerprint);
      this.total += 1;
      if (existing) {
        existing.count += 1;
        existing.lastSeenMs = now;
        existing.message = message.slice(0, MAX_MESSAGE_CHARS);
        existing.stack = stack.slice(0, MAX_STACK_CHARS);
        if (requestId !== undefined) existing.lastRequestId = requestId;
        if (context.route) existing.lastRoute = context.route;
        if (context.status !== undefined) existing.lastStatus = context.status;
        return;
      }
      if (this.groups.size >= MAX_GROUPS) {
        let oldest: ErrorGroup | undefined;
        for (const g of this.groups.values()) {
          if (!oldest || g.lastSeenMs < oldest.lastSeenMs) oldest = g;
        }
        if (oldest) this.groups.delete(oldest.id);
      }
      this.groups.set(fingerprint, {
        id: fingerprint,
        name,
        message: message.slice(0, MAX_MESSAGE_CHARS),
        stack: stack.slice(0, MAX_STACK_CHARS),
        source,
        count: 1,
        firstSeenMs: now,
        lastSeenMs: now,
        ...(requestId !== undefined ? { lastRequestId: requestId } : {}),
        ...(context.route ? { lastRoute: context.route } : {}),
        ...(context.status !== undefined ? { lastStatus: context.status } : {}),
      });
    } catch {
      // recording an error must never raise another one
    }
  }

  get(): { ok: true; data: ErrorsData } {
    const groups = [...this.groups.values()].sort((a, b) => b.lastSeenMs - a.lastSeenMs);
    return { ok: true, data: { total: this.total, groups } };
  }
}
