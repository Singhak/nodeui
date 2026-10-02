import type { IncomingMessage, ServerResponse } from 'node:http';
import { SECRET_MASKED } from './constants';
import { maskSecrets, maskSecretText, SECRET_KEY_PATTERN } from './safety';
import type { RequestDetail, RequestDetailOptions } from './types';

export const DEFAULT_REQUEST_DETAIL: Required<RequestDetailOptions> = {
  query: true,
  headers: true,
  bodies: false,
  maxBodyBytes: 4096,
};

/** Merges user options over the defaults; `false` turns every capture off. */
export function resolveRequestDetail(
  option: boolean | RequestDetailOptions | undefined,
  bodiesFromEnv: boolean,
): Required<RequestDetailOptions> {
  if (option === false) {
    return { query: false, headers: false, bodies: false, maxBodyBytes: 0 };
  }
  const given = typeof option === 'object' ? option : {};
  const maxBodyBytes = given.maxBodyBytes ?? DEFAULT_REQUEST_DETAIL.maxBodyBytes;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0 || maxBodyBytes > 1_048_576) {
    throw new Error('captureRequestDetail.maxBodyBytes must be an integer in 1..1048576');
  }
  return {
    query: given.query ?? DEFAULT_REQUEST_DETAIL.query,
    headers: given.headers ?? DEFAULT_REQUEST_DETAIL.headers,
    bodies: given.bodies ?? (bodiesFromEnv || DEFAULT_REQUEST_DETAIL.bodies),
    maxBodyBytes,
  };
}

/** Header names whose values are never stored, regardless of `maskSecrets`. */
const ALWAYS_REDACT = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i;
const TEXTUAL_TYPE = /json|text|xml|x-www-form-urlencoded|javascript|graphql/i;

function queryOf(req: IncomingMessage): Record<string, string> | undefined {
  const raw = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '';
  const index = raw.indexOf('?');
  if (index === -1) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw.slice(index + 1))) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? SECRET_MASKED : value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function headersOf(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    out[name] =
      ALWAYS_REDACT.test(name) || SECRET_KEY_PATTERN.test(name)
        ? SECRET_MASKED
        : Array.isArray(value)
          ? value.join(', ')
          : value;
  }
  return out;
}

/**
 * Response content type. `writeHead(status, headers)` bypasses `getHeader`, so
 * fall back to the serialized header block once it has been flushed.
 */
function responseType(res: ServerResponse): string {
  const header = res.getHeader('content-type');
  if (header !== undefined) return String(header);
  const raw = (res as ServerResponse & { _header?: unknown })._header;
  const match = typeof raw === 'string' ? /^content-type:[ \t]*(.*?)\r?$/im.exec(raw) : null;
  return match?.[1] ?? '';
}

/** Collects up to `max` bytes and notes whether anything was dropped. */
class BodyCollector {
  private chunks: Buffer[] = [];
  private size = 0;
  total = 0;

  constructor(private readonly max: number) {}

  add(chunk: unknown, encoding?: unknown): void {
    let buf: Buffer;
    if (Buffer.isBuffer(chunk)) buf = chunk;
    else if (typeof chunk === 'string') {
      buf = Buffer.from(
        chunk,
        typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8',
      );
    } else if (chunk instanceof Uint8Array) buf = Buffer.from(chunk);
    else return;
    this.total += buf.length;
    if (this.size >= this.max) return;
    const slice = buf.subarray(0, this.max - this.size);
    this.chunks.push(slice);
    this.size += slice.length;
  }

  get truncated(): boolean {
    return this.total > this.size;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/** Masks a captured body: structured JSON by key, everything else by text patterns. */
function maskBody(text: string, contentType: string, mask: boolean, truncated: boolean): string {
  if (!mask) return text;
  if (!truncated && /json/i.test(contentType)) {
    try {
      return JSON.stringify(maskSecrets(JSON.parse(text) as unknown));
    } catch {
      // fall through to text masking
    }
  }
  return maskSecretText(text);
}

/**
 * Attaches non-invasive capture to a request/response pair. The request body is
 * observed by wrapping `emit('data')` (never by adding a listener, which would
 * switch the stream to flowing mode and starve the app's body parser).
 * Returns a function that yields the captured detail once the response finishes.
 */
export function captureRequestDetail(
  req: IncomingMessage,
  res: ServerResponse,
  settings: Required<RequestDetailOptions>,
  mask: boolean,
): () => RequestDetail {
  let reqBody: BodyCollector | null = null;
  let resBody: BodyCollector | null = null;

  if (settings.bodies) {
    const reqType = String(req.headers['content-type'] ?? '');
    if (TEXTUAL_TYPE.test(reqType)) {
      const collector = new BodyCollector(settings.maxBodyBytes);
      reqBody = collector;
      const emit = req.emit.bind(req) as (event: string | symbol, ...args: unknown[]) => boolean;
      req.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
        if (event === 'data') {
          try {
            collector.add(args[0]);
          } catch {
            // capture must never break the app
          }
        }
        return emit(event, ...args);
      }) as typeof req.emit;
    }

    const collector = new BodyCollector(settings.maxBodyBytes);
    resBody = collector;
    const write = res.write.bind(res) as (...a: unknown[]) => boolean;
    const end = res.end.bind(res) as (...a: unknown[]) => ServerResponse;
    const textual = (): boolean => TEXTUAL_TYPE.test(responseType(res));
    res.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      try {
        if (textual()) collector.add(chunk, rest[0]);
      } catch {
        // capture must never break the app
      }
      return write(chunk, ...rest);
    }) as typeof res.write;
    res.end = ((chunk?: unknown, ...rest: unknown[]): ServerResponse => {
      try {
        if (chunk && typeof chunk !== 'function' && textual()) collector.add(chunk, rest[0]);
      } catch {
        // capture must never break the app
      }
      return end(chunk, ...rest);
    }) as typeof res.end;
  }

  return () => {
    const detail: RequestDetail = {};
    if (settings.query) {
      const query = queryOf(req);
      if (query) detail.query = query;
    }
    if (settings.headers) detail.headers = headersOf(req);
    if (reqBody && reqBody.total > 0) {
      detail.requestBody = maskBody(
        reqBody.text(),
        String(req.headers['content-type'] ?? ''),
        mask,
        reqBody.truncated,
      );
      if (reqBody.truncated) detail.requestBodyTruncated = true;
    }
    if (resBody && resBody.total > 0) {
      detail.responseBody = maskBody(resBody.text(), responseType(res), mask, resBody.truncated);
      if (resBody.truncated) detail.responseBodyTruncated = true;
    }
    return detail;
  };
}
