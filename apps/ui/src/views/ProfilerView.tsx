import { useEffect, useState } from 'react';
import { getPanel, issueConfirmation, startCpuProfile, stopCpuProfile } from '../api';
import { FlameGraph } from '../charts/FlameGraph';
import { Card, ErrorState, Skeleton, ViewHeader } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { Kpi } from '../components/Kpi';
import { HeapProfiler } from './HeapProfiler';
import { formatClock, formatDuration, formatPercent } from '../format';
import { usePolledPanel } from '../hooks';
import type { CpuProfileData, TopFunction } from '../types';

const DURATIONS = [5, 10, 20, 30, 60];

const columns: Column<TopFunction>[] = [
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
    label: 'Self time',
    align: 'right',
    sortValue: (f) => f.selfMs,
    render: (f) => formatDuration(f.selfMs),
    className: 'mono nowrap',
    width: 100,
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

function Countdown({ startedAtMs, seconds }: { startedAtMs: number; seconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil(seconds - (now - startedAtMs) / 1000));
  return <>{left}s left</>;
}

/** CPU time or sampled heap allocations; one profile runs per kind. */
export function ProfilerView({ intervalMs }: { intervalMs: number }) {
  const [kind, setKind] = useState<'cpu' | 'heap'>('cpu');
  return (
    <>
      <div className="seg" role="group" aria-label="Profile type">
        <button
          type="button"
          className={`seg-btn${kind === 'cpu' ? ' seg-active' : ''}`}
          aria-pressed={kind === 'cpu'}
          onClick={() => setKind('cpu')}
        >
          CPU
        </button>
        <button
          type="button"
          className={`seg-btn${kind === 'heap' ? ' seg-active' : ''}`}
          aria-pressed={kind === 'heap'}
          onClick={() => setKind('heap')}
        >
          Heap allocations
        </button>
      </div>
      {kind === 'cpu' ? (
        <CpuProfiler intervalMs={intervalMs} />
      ) : (
        <HeapProfiler intervalMs={intervalMs} />
      )}
    </>
  );
}

function CpuProfiler({ intervalMs }: { intervalMs: number }) {
  const [hideInternals, setHideInternals] = useState(false);
  const [hideDependencies, setHideDependencies] = useState(false);
  const [running, setRunning] = useState(false);
  const poll = usePolledPanel<CpuProfileData>(
    'cpu-profile',
    () => getPanel<CpuProfileData>('/cpu-profile'),
    running ? 1000 : Math.max(intervalMs, 3000),
  );
  const data = poll.data;
  useEffect(() => {
    setRunning(data?.state === 'running');
  }, [data?.state]);

  const [seconds, setSeconds] = useState(10);
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
      await startCpuProfile(seconds, nonce);
    });

  return (
    <>
      <ViewHeader
        title="Profiler"
        description="Record where your app spends CPU time. Fire your load test while it records, then read the flame graph."
      />
      <Card>
        <div className="toolbar">
          {data?.state === 'running' ? (
            <>
              <span role="status">
                <span className="rec-dot" aria-hidden="true" />
                Profiling · <Countdown startedAtMs={data.startedAtMs} seconds={data.seconds} />
              </span>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void act(stopCpuProfile)}
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
                  aria-label="Profile duration"
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
                ● Start profiling
              </button>
            </>
          )}
        </div>
        <p className="muted-text">
          Sampling adds a small overhead while it runs. The profile covers this process only.
        </p>
        {error ? <ErrorState message={error} /> : null}
      </Card>

      {poll.error && !data ? (
        <Card>
          <ErrorState message={poll.error} onRetry={poll.refetch} />
        </Card>
      ) : !data ? (
        <Skeleton lines={5} label="Loading profiler" />
      ) : data.state === 'error' ? (
        <Card>
          <ErrorState message={data.error} />
        </Card>
      ) : data.state === 'done' ? (
        <>
          <div className="tile-row">
            <Kpi
              label="Recorded"
              value={formatDuration(data.result.durationMs)}
              caption={`at ${formatClock(data.startedAtMs)} · ${data.result.sampleCount.toLocaleString()} samples`}
            />
            <Kpi
              label="Busy"
              value={formatPercent(
                data.result.totalMs > 0 ? 1 - data.result.idleMs / data.result.totalMs : 0,
                0,
              )}
              caption={`${formatDuration(data.result.totalMs - data.result.idleMs)} of CPU work`}
            />
            <Kpi
              label="Hottest function"
              value={data.result.top.find((f) => f.name !== '(idle)')?.name ?? '—'}
              caption={(() => {
                const f = data.result.top.find((x) => x.name !== '(idle)');
                return f ? `${formatPercent(f.share)} of the profile` : undefined;
              })()}
            />
          </div>
          <Card
            title="Flame graph"
            subtitle="Width is time including callees. Grey is idle, red is garbage collection."
          >
            <div className="toolbar">
              <label className="check">
                <input
                  type="checkbox"
                  checked={hideInternals}
                  onChange={(e) => setHideInternals(e.target.checked)}
                />{' '}
                Hide Node internals
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={hideDependencies}
                  onChange={(e) => setHideDependencies(e.target.checked)}
                />{' '}
                Hide dependencies
              </label>
            </div>
            <FlameGraph root={data.result.tree} filter={{ hideInternals, hideDependencies }} />
          </Card>
          <Card title="Top functions by self time">
            <DataTable
              caption="Top functions by self time"
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
            No profile yet. Pick a duration and press Start profiling, then send traffic to your
            app.
          </p>
        </Card>
      )}
    </>
  );
}
