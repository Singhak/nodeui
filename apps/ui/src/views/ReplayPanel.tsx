import { useMemo, useState } from 'react';
import { issueConfirmation, replayRequest } from '../api';
import { StatusCode } from '../components/badges';
import { diffLines, normalizeForDiff } from '../diff';
import { formatBytes, formatDuration } from '../format';
import type { ReplayResult, RequestEntry } from '../types';

const SKIP = /^(host|content-length|connection|transfer-encoding|accept-encoding)$/i;

function headersToText(headers?: Record<string, string>): string {
  return Object.entries(headers ?? {})
    .filter(([name, value]) => !SKIP.test(name) && value !== '[REDACTED]')
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}

export function textToHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    if (name) out[name] = line.slice(i + 1).trim();
  }
  return out;
}

function pathWithQuery(entry: RequestEntry): string {
  const search = entry.query ? new URLSearchParams(entry.query).toString() : '';
  return `${entry.path}${search ? `?${search}` : ''}`;
}

/** Edit-and-resend a captured request, then compare the new response with the original. */
export function ReplayPanel({ entry }: { entry: RequestEntry }) {
  const [method, setMethod] = useState(entry.method);
  const [path, setPath] = useState(pathWithQuery(entry));
  const [headers, setHeaders] = useState(headersToText(entry.headers));
  const [body, setBody] = useState(entry.requestBody ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);

  const send = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { nonce } = await issueConfirmation();
      setResult(
        await replayRequest({ method, path, headers: textToHeaders(headers), body }, nonce),
      );
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Replay failed');
    } finally {
      setBusy(false);
    }
  };

  const diff = useMemo(() => {
    if (!result || result.binary || entry.responseBody === undefined) return null;
    return diffLines(normalizeForDiff(entry.responseBody), normalizeForDiff(result.body));
  }, [result, entry.responseBody]);
  const changed = diff?.some((l) => l.type !== 'same') ?? false;

  return (
    <section aria-label="Replay request" className="replay">
      <h3>Replay</h3>
      <p className="muted-text">
        Sends this request to your app again. Credentials are never stored, so add any Authorization
        or Cookie header yourself.
      </p>
      <div className="replay-line">
        <select
          className="input"
          aria-label="Replay method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          className="input mono"
          aria-label="Replay path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </div>
      <label className="replay-field">
        <span>Headers (one per line)</span>
        <textarea
          className="input mono"
          aria-label="Replay headers"
          rows={4}
          value={headers}
          onChange={(e) => setHeaders(e.target.value)}
        />
      </label>
      {method !== 'GET' && method !== 'HEAD' ? (
        <label className="replay-field">
          <span>Body</span>
          <textarea
            className="input mono"
            aria-label="Replay body"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
      ) : null}
      {entry.requestBodyTruncated ? (
        <p className="muted-text">The captured body was truncated; edit it before sending.</p>
      ) : null}
      <div className="drawer-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error ? (
        <p className="status-critical" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <div aria-label="Replay result" role="region">
          <dl className="detail-list">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusCode status={result.status} />
                {result.status !== entry.status ? (
                  <span className="muted-text"> (was {entry.status})</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd className="mono">
                {formatDuration(result.durationMs)}{' '}
                <span className="muted-text">(was {formatDuration(entry.durationMs)})</span>
              </dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd className="mono">{formatBytes(result.sizeBytes)}</dd>
            </div>
          </dl>
          {result.binary ? (
            <p className="muted-text">Binary response body not shown.</p>
          ) : diff ? (
            <>
              <h4>{changed ? 'Response changed' : 'Response identical to the original'}</h4>
              {changed ? (
                <pre className="curl mono diff" aria-label="Response diff">
                  {diff.map((l, i) => (
                    <div key={i} className={`diff-${l.type}`}>
                      {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
                      {l.text}
                    </div>
                  ))}
                </pre>
              ) : null}
            </>
          ) : (
            <>
              <h4>Response body</h4>
              <pre className="curl mono">{result.body}</pre>
              <p className="muted-text">
                Enable body capture (<code>captureRequestDetail.bodies</code>) to diff against the
                original response.
              </p>
            </>
          )}
          {result.bodyTruncated ? <p className="muted-text">Body truncated at 64 kB.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
