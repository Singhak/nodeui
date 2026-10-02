/** A running NodeUI console that the CLI talks to over its REST API. */
export interface ServiceTarget {
  name: string;
  /** Console base URL without a trailing slash, e.g. `http://127.0.0.1:3000/nodeui`. */
  base: string;
  token?: string;
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/**
 * Parses `name=url` or a bare `url`. A URL without a path means the default
 * console path `/nodeui`; a `?token=` query becomes the access token.
 */
export function parseTarget(spec: string): ServiceTarget {
  const eq = spec.indexOf('=');
  const hasName = eq > 0 && !spec.slice(0, eq).includes('/') && !spec.slice(0, eq).includes(':');
  const rawUrl = hasName ? spec.slice(eq + 1) : spec;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`);
  } catch {
    throw new Error(`invalid service URL "${rawUrl}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`service URL must be http(s), got "${rawUrl}"`);
  }
  const name = hasName ? spec.slice(0, eq) : `${url.hostname}-${url.port || '80'}`;
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`invalid service name "${name}" (letters, digits, ".", "-" and "_")`);
  }
  const token = url.searchParams.get('token') ?? undefined;
  const path = url.pathname.replace(/\/+$/, '') || '/nodeui';
  return { name, base: `${url.origin}${path}`, token };
}

export class PanelError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PanelError';
  }
}

/** Reads one panel (`/api/<panel>`) from a service and unwraps the `{ok,data}` envelope. */
export async function fetchPanel<T>(
  target: ServiceTarget,
  panel: string,
  timeoutMs = 3000,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (target.token) headers.authorization = `Bearer ${target.token}`;
  let res: Response;
  try {
    res = await fetch(`${target.base}/api/${panel}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new PanelError(
      `cannot reach ${target.name} at ${target.base}: ${err instanceof Error ? err.message : String(err)}`,
      'unreachable',
    );
  }
  let body: { ok?: boolean; data?: T; error?: { code?: string; message?: string } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new PanelError(`${target.name}: invalid response (HTTP ${res.status})`, 'invalid');
  }
  if (!body.ok) {
    throw new PanelError(body.error?.message ?? `HTTP ${res.status}`, body.error?.code ?? 'error');
  }
  return body.data as T;
}
