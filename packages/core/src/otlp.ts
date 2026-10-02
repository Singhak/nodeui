import { randomBytes } from 'node:crypto';
import { runSuppressed } from './context';
import { maskSecretText } from './safety';
import type { OutgoingRequestEntry, QueryEntry, RequestEntry } from './types';

export interface OtlpOptions {
  /** Collector base URL (e.g. `http://localhost:4318`) or a full `/v1/traces` URL. */
  endpoint: string;
  /** `service.name` resource attribute. Default `OTEL_SERVICE_NAME` or `nodeui-app`. */
  serviceName?: string;
  /** Extra HTTP headers, e.g. an auth header for a hosted collector. */
  headers?: Record<string, string>;
  /** Export interval. Default 2000 ms. */
  intervalMs?: number;
}

interface TraceContext {
  traceId: string;
  spanId: string;
}

interface Attribute {
  key: string;
  value: { stringValue: string } | { intValue: string } | { boolValue: boolean };
}

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Attribute[];
  status?: { code: number; message?: string };
}

const KIND_SERVER = 2;
const KIND_CLIENT = 3;
const STATUS_ERROR = 2;
const MAX_QUEUE = 1000;
const MAX_BATCH = 200;
const MAX_TRACKED_REQUESTS = 1000;

const hex = (bytes: number): string => randomBytes(bytes).toString('hex');
const nanos = (ms: number): string => (BigInt(Math.round(ms * 1000)) * 1000n).toString();
const str = (key: string, value: string): Attribute => ({ key, value: { stringValue: value } });
const int = (key: string, value: number): Attribute => ({
  key,
  value: { intValue: String(Math.round(value)) },
});

/** Resolves the traces URL: accepts a base URL or an explicit `/v1/traces` URL. */
export function tracesUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}

/**
 * Exports recorded requests, outgoing calls and database queries as OTLP/HTTP
 * JSON spans. Spans of one request share a trace; outgoing calls and queries
 * are children of the request span. No OpenTelemetry SDK is needed. Failures
 * never reach the host app, and the exporter's own HTTP calls are excluded
 * from outgoing capture.
 */
export class OtlpExporter {
  private readonly url: string;
  private readonly serviceName: string;
  private queue: Span[] = [];
  private timer: NodeJS.Timeout | null = null;
  private contexts = new Map<number, TraceContext>();
  private warned = false;
  exported = 0;
  dropped = 0;

  constructor(
    private readonly options: OtlpOptions,
    env: Record<string, string | undefined> = process.env,
  ) {
    this.url = tracesUrl(options.endpoint);
    this.serviceName = options.serviceName ?? env.OTEL_SERVICE_NAME ?? 'nodeui-app';
  }

  /** Stable ids for a request so children recorded earlier link to its span. */
  private contextFor(requestId: number): TraceContext {
    let ctx = this.contexts.get(requestId);
    if (!ctx) {
      ctx = { traceId: hex(16), spanId: hex(8) };
      this.contexts.set(requestId, ctx);
      if (this.contexts.size > MAX_TRACKED_REQUESTS) {
        const oldest = this.contexts.keys().next().value;
        if (oldest !== undefined) this.contexts.delete(oldest);
      }
    }
    return ctx;
  }

  request(entry: RequestEntry): void {
    const ctx = this.contextFor(entry.id);
    const attributes = [
      str('http.request.method', entry.method),
      str('url.path', maskSecretText(entry.path)),
      int('http.response.status_code', entry.status),
      str('client.address', entry.ip),
    ];
    if (entry.route) attributes.push(str('http.route', entry.route));
    this.push({
      ...ctx,
      name: `${entry.method} ${entry.route ?? entry.path}`,
      kind: KIND_SERVER,
      startTimeUnixNano: nanos(entry.timestampMs),
      endTimeUnixNano: nanos(entry.timestampMs + entry.durationMs),
      attributes,
      ...(entry.status >= 500 ? { status: { code: STATUS_ERROR } } : {}),
    });
  }

  outgoing(entry: OutgoingRequestEntry): void {
    const attributes = [
      str('http.request.method', entry.method),
      str('url.full', maskSecretText(entry.url)),
    ];
    if (entry.status !== null) attributes.push(int('http.response.status_code', entry.status));
    const failed = Boolean(entry.error) || (entry.status !== null && entry.status >= 500);
    this.child(entry.requestId, {
      name: `${entry.method} ${entry.url}`,
      timestampMs: entry.timestampMs,
      durationMs: entry.durationMs,
      attributes,
      ...(failed ? { status: { code: STATUS_ERROR, message: entry.error } } : {}),
    });
  }

  query(entry: QueryEntry): void {
    const statement = maskSecretText(entry.sql);
    this.child(entry.requestId, {
      name: `${statement.split(/\s+/)[0]?.toUpperCase() ?? 'QUERY'} ${entry.system}`,
      timestampMs: entry.timestampMs,
      durationMs: entry.durationMs,
      attributes: [str('db.system.name', entry.system), str('db.query.text', statement)],
      ...(entry.error ? { status: { code: STATUS_ERROR, message: entry.error } } : {}),
    });
  }

  private child(
    requestId: number | undefined,
    span: {
      name: string;
      timestampMs: number;
      durationMs: number;
      attributes: Attribute[];
      status?: { code: number; message?: string };
    },
  ): void {
    const parent = requestId === undefined ? undefined : this.contextFor(requestId);
    this.push({
      traceId: parent?.traceId ?? hex(16),
      spanId: hex(8),
      ...(parent ? { parentSpanId: parent.spanId } : {}),
      name: span.name,
      kind: KIND_CLIENT,
      startTimeUnixNano: nanos(span.timestampMs),
      endTimeUnixNano: nanos(span.timestampMs + span.durationMs),
      attributes: span.attributes,
      ...(span.status ? { status: span.status } : {}),
    });
  }

  private push(span: Span): void {
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
      this.dropped += 1;
    }
    this.queue.push(span);
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.options.intervalMs ?? 2000);
      if (typeof this.timer.unref === 'function') this.timer.unref();
    }
  }

  body(spans: Span[]): string {
    return JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: [str('service.name', this.serviceName)] },
          scopeSpans: [{ scope: { name: '@singhak/nodeui' }, spans }],
        },
      ],
    });
  }

  async flush(): Promise<void> {
    this.timer = null;
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, MAX_BATCH);
      try {
        const res = await runSuppressed(() =>
          fetch(this.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...this.options.headers },
            body: this.body(batch),
            signal: AbortSignal.timeout(5000),
          }),
        );
        if (!res.ok) throw new Error(`collector answered ${res.status}`);
        this.exported += batch.length;
      } catch (err) {
        this.dropped += batch.length;
        if (!this.warned) {
          this.warned = true;
          console.warn(
            `[nodeui] OTLP export to ${this.url} failed (${
              err instanceof Error ? err.message : String(err)
            }); dropping spans.`,
          );
        }
        return; // do not hammer a down collector; the next record re-arms the timer
      }
    }
  }

  /** Cancels the timer and makes a best-effort final export. */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.flush();
  }
}
