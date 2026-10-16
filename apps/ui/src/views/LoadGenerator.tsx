import { useEffect, useRef, useState } from 'react';
import { getPanel, issueConfirmation, startLoadTest, stopLoadTest } from '../api';
import { Card, ErrorState } from '../components/common';
import { usePolledPanel } from '../hooks';
import type { LoadTestConfig, LoadTestStatus } from '../types';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export interface RerunRequest {
  /** Changes on every click so the same config can be run again. */
  token: number;
  config: LoadTestConfig;
}

function Elapsed({ since, total }: { since: number; total: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.min(total, Math.max(0, Math.round((now - since) / 1000)));
  return (
    <>
      {s}s / {total}s
    </>
  );
}

/**
 * Fires load at the app from a worker thread and records it as a run. A quick
 * way to get a before/after number without leaving the console; for peak
 * throughput use a dedicated tool (autocannon, k6, wrk) in another process.
 */
export function LoadGenerator({
  intervalMs,
  rerun,
  onFinished,
}: {
  intervalMs: number;
  rerun: RerunRequest | null;
  onFinished: (runId: number | undefined) => void;
}) {
  const [running, setRunning] = useState(false);
  const poll = usePolledPanel<LoadTestStatus>(
    'loadtest',
    () => getPanel<LoadTestStatus>('/loadtest'),
    running ? 700 : Math.max(intervalMs, 3000),
  );
  const status = poll.data;
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
  const [connections, setConnections] = useState('10');
  const [durationSec, setDurationSec] = useState('10');
  const [body, setBody] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previous = useRef<LoadTestStatus['state']>('idle');

  useEffect(() => {
    setRunning(status?.state === 'running');
    if (previous.current === 'running' && status?.state === 'done') onFinished(status.runId);
    previous.current = status?.state ?? 'idle';
  }, [status?.state]);

  const launch = async (config: Partial<LoadTestConfig>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { nonce } = await issueConfirmation();
      await startLoadTest(config, nonce);
      setRunning(true);
      poll.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the load test');
    } finally {
      setBusy(false);
    }
  };

  const form = (): Partial<LoadTestConfig> => ({
    method,
    path,
    connections: Number(connections),
    durationSec: Number(durationSec),
    ...(method !== 'GET' && body ? { body } : {}),
    ...(name.trim() ? { name: name.trim() } : {}),
  });

  const lastRerun = useRef(0);
  useEffect(() => {
    if (!rerun || rerun.token === lastRerun.current) return;
    lastRerun.current = rerun.token;
    const c = rerun.config;
    setMethod(c.method);
    setPath(c.path);
    setConnections(String(c.connections));
    setDurationSec(String(c.durationSec));
    setBody(c.body);
    setName(`${c.name.replace(/ \(re-run\)$/, '')} (re-run)`);
    void launch({ ...c, name: `${c.name.replace(/ \(re-run\)$/, '')} (re-run)` });
  }, [rerun?.token]);

  const isRunning = status?.state === 'running';

  return (
    <Card
      title="Generate load"
      subtitle="Fires requests at your app from a worker thread and saves the result as a run."
    >
      {isRunning && status.config ? (
        <div className="toolbar">
          <span role="status">
            <span className="rec-dot" aria-hidden="true" />
            Running {status.config.method} {status.config.path} ·{' '}
            <Elapsed since={status.startedAtMs ?? Date.now()} total={status.config.durationSec} /> ·{' '}
            {status.completed.toLocaleString()} done
            {status.errors > 0 ? ` · ${status.errors} failed` : ''}
          </span>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void stopLoadTest().then(poll.refetch)}
          >
            ■ Stop
          </button>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <select
              className="input"
              aria-label="Load method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              className="input grow mono"
              aria-label="Load path"
              placeholder="/api/users"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <label className="field">
              <span>Connections</span>
              <input
                className="input"
                type="number"
                min={1}
                max={100}
                aria-label="Connections"
                value={connections}
                onChange={(e) => setConnections(e.target.value)}
                style={{ width: 80 }}
              />
            </label>
            <label className="field">
              <span>Seconds</span>
              <input
                className="input"
                type="number"
                min={1}
                max={60}
                aria-label="Duration in seconds"
                value={durationSec}
                onChange={(e) => setDurationSec(e.target.value)}
                style={{ width: 80 }}
              />
            </label>
          </div>
          <div className="toolbar">
            <input
              className="input grow"
              aria-label="Load run name"
              placeholder="Run name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || path.trim() === ''}
              onClick={() => void launch(form())}
            >
              ▶ Run load test
            </button>
          </div>
          {method !== 'GET' ? (
            <textarea
              className="input mono"
              aria-label="Load body"
              rows={3}
              placeholder="Request body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ width: '100%' }}
            />
          ) : null}
          <p className="muted-text">
            Shares CPU with your app, so use it for relative before/after checks. For peak
            throughput run autocannon, k6 or wrk in another process and record it below.
          </p>
        </>
      )}
      {status?.state === 'error' ? (
        <ErrorState message={status.error ?? 'Load test failed'} />
      ) : null}
      {error ? <ErrorState message={error} /> : null}
    </Card>
  );
}
