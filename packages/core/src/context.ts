import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage } from 'node:http';

interface RequestContext {
  requestId: number;
}

const storage = new AsyncLocalStorage<RequestContext>();
const ids = new WeakMap<object, number>();
const suppression = new AsyncLocalStorage<true>();

/** Runs `fn` so NodeUI's own outgoing HTTP calls (e.g. OTLP export) are not captured. */
export function runSuppressed<T>(fn: () => T): T {
  return suppression.run(true, fn);
}

export function isSuppressed(): boolean {
  return suppression.getStore() === true;
}

/** Id of the app request the current async call chain belongs to, if any. */
export function currentRequestId(): number | undefined {
  return storage.getStore()?.requestId;
}

/** Associates a request with its id so adapters can re-enter its context. */
export function bindRequestId(req: IncomingMessage, requestId: number): void {
  ids.set(req, requestId);
}

/** Runs `fn` so outgoing calls and logs made inside are attributed to the request. */
export function runWithRequestId<T>(requestId: number, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/**
 * Runs `fn` inside the request's context when it was recorded by the NodeUI
 * middleware (otherwise just calls `fn`). For adapters that own the `next` call.
 */
export function runInRequestContext<T>(req: IncomingMessage, fn: () => T): T {
  const requestId = ids.get(req);
  return requestId === undefined ? fn() : storage.run({ requestId }, fn);
}

/**
 * Attributes the rest of the current async chain to the request. For adapters
 * (Fastify) whose hooks cannot wrap the downstream handler in `run`.
 */
export function enterRequestContext(req: IncomingMessage): void {
  const requestId = ids.get(req);
  if (requestId !== undefined) storage.enterWith({ requestId });
}
