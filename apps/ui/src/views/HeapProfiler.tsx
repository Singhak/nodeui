import { useEffect, useMemo, useState } from 'react';
import { getPanel, issueConfirmation, startHeapProfile, stopHeapProfile } from '../api';
import { FlameGraph } from '../charts/FlameGraph';
import { Card, ErrorState, Skeleton, ViewHeader } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { Kpi } from '../components/Kpi';
import { formatBytes, formatClock, formatPercent } from '../format';
import { usePolledPanel } from '../hooks';
import type { AllocNode, FlameNode, HeapProfileData, TopAllocator } from '../types';

const DURATIONS = [5, 10, 20, 30, 60];

const columns: Column<TopAllocator>[] = [
  {
    key: 'name',
    label: 'Function',
    sortValue: (f) => f.name,
    render: (f) => f.name,
    className: 'mono truncate',
    title: (f) => f.name,
  },
  {
    key: 'file',
    label: 'Location',
    sortValue: (f) => f.file,
    render: (f) => (f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '—'),
    className: 'mono truncate muted-text',
    title: (f) => f.file,
  },
  {
    key: 'self',
    label: 'Live bytes',
    align: 'right',
    sortValue: (f) => f.selfBytes,
    render: (f) => formatBytes(f.selfBytes),
    className: 'mono nowrap',
    width: 110,
  },
  {
    key: 'share',
    label: 'Share',
    align: 'right',
    sortValue: (f) => f.share,
    render: (f) => formatPercent(f.share),
    className: 'mono nowrap',
    width: 80,
  },
];

/** The flame graph measures `totalMs`; for heap profiles that field carries bytes. */
export function allocToFlame(n: AllocNode): FlameNode {
  return {
    name: n.name,
    file: n.file,
    line: n.line,
    totalMs: n.totalBytes,
    selfMs: n.selfBytes,
    children: n.children.map(allocToFlame),
  };
}

function Countdown({ startedAtMs, seconds }: { startedAtMs: number; seconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  return <>{Math.max(0, Math.ceil(seconds - (now - startedAtMs) / 1000))}s left</>;
}

export function HeapProfiler({ intervalMs }: { intervalMs: number }) {
  const [running, setRunning] = useState(false);
  const poll = usePolledPanel<HeapProfileData>(
    'heap-profile',
    () => getPanel<HeapProfileData>('/heap-profile'),
    running ? 1000 : Math.max(intervalMs, 3000),
  );
  const data = poll.data;
  useEffect(() => {
    setRunning(data?.state === 'running');
  }, [data?.state]);

  const [seconds, setSeconds] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      poll.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const start = (): Promise<void> =>
    act(async () => {
      const { nonce } = await issueConfirmation();
      await startHeapProfile(seconds, nonce);
    });

  const tree = useMemo(
    () => (data?.state === 'done' ? allocToFlame(data.result.tree) : null),
    [data],
  );

  return (
    <>
      <ViewHeader
        title="Heap profiler"
        description="See which functions allocated the memory that is still alive. Run it while the leak grows, then read the allocation graph."
      />
      <Card>
        <div className="toolbar">
          {data?.state === 'running' ? (
            <>
              <span role="status">
                <span className="rec-dot" aria-hidden="true" />
                Sampling allocations ·{' '}
                <Countdown startedAtMs={data.startedAtMs} seconds={data.seconds} />
              </span>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void act(stopHeapProfile)}
              >
                ■ Stop now
              </button>
            </>
          ) : (
            <>
              <label className="field">
                <span>Duration</span>
                <select
                  className="input"
                  aria-label="Heap profile duration"
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} seconds
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn" disabled={busy} onClick={() => void start()}>
                ● Start sampling
              </button>
            </>
          )}
        </div>
        <p className="muted-text">
          Sampling is lightweight but not free. Only objects still alive when it stops are shown, so
          short-lived garbage does not appear.
        </p>
        {error ? <ErrorState message={error} /> : null}
      </Card>

      {poll.error && !data ? (
        <Card>
          <ErrorState message={poll.error} onRetry={poll.refetch} />
        </Card>
      ) : !data ? (
        <Skeleton lines={5} label="Loading heap profiler" />
      ) : data.state === 'error' ? (
        <Card>
          <ErrorState message={data.error} />
        </Card>
      ) : data.state === 'done' && tree ? (
        <>
          <div className="tile-row">
            <Kpi
              label="Live sampled bytes"
              value={formatBytes(data.result.totalBytes)}
              caption={`recorded at ${formatClock(data.startedAtMs)}`}
            />
            <Kpi
              label="Top allocator"
              value={data.result.top[0]?.name ?? '—'}
              caption={
                data.result.top[0]
                  ? `${formatPercent(data.result.top[0].share)} of live bytes`
                  : undefined
              }
            />
          </div>
          <Card
            title="Allocation graph"
            subtitle="Width is live bytes allocated by a function and its callees."
          >
            <FlameGraph root={tree} format={formatBytes} />
          </Card>
          <Card title="Top allocators">
            <DataTable
              caption="Top allocating functions"
              columns={columns}
              rows={data.result.top}
              rowKey={(f) => `${f.name}|${f.file}|${f.line}`}
              defaultSort={{ key: 'self', dir: 'desc' }}
              maxHeight={420}
            />
          </Card>
        </>
      ) : (
        <Card>
          <p className="muted-text">
            No heap profile yet. Press Start sampling, exercise the suspect code, and wait for it to
            finish.
          </p>
        </Card>
      )}
    </>
  );
}
