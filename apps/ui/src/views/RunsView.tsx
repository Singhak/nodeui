import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deleteRun, exportRuns, getRuns, importRuns, setBaseline, startRun, stopRun } from '../api';
import { LineChart, type ChartSeries } from '../charts/LineChart';
import { Card, EmptyState, ErrorState, Skeleton, ViewHeader } from '../components/common';
import { Kpi } from '../components/Kpi';
import { formatBytes, formatClock, formatDuration, formatSeconds } from '../format';
import { downloadFile } from '../export';
import { usePolledPanel } from '../hooks';
import { LoadGenerator, type RerunRequest } from './LoadGenerator';
import { COMPARE_ROWS, compareValue, formatDelta, formatRunReport } from '../report';
import type { BenchRun, LoadTestConfig, RunsData } from '../types';

const relTime = (t: number): string => `+${formatSeconds(t / 1000)}`;

function runSeries(
  run: BenchRun,
  color: number,
  pick: 'rps' | 'p99' | 'p50',
  label: string,
): ChartSeries {
  const t0 = run.points[0]?.t ?? run.startMs;
  return {
    id: `${run.id}-${pick}`,
    name: `${run.name} ${label}`,
    color: `var(--series-${color})`,
    points: run.points.map((p) => ({ t: p.t - t0, v: p[pick] })),
    dash: color % 2 === 0 ? '4 3' : undefined,
  };
}

/** Compact p99 / throughput deltas of a run against the pinned baseline. */
function VsBaseline({ base, run }: { base: BenchRun; run: BenchRun }) {
  const p99 = compareValue(base.summary.p99, run.summary.p99, 'lower');
  const rps = compareValue(base.summary.avgRps, run.summary.avgRps, 'higher');
  const cell = (label: string, d: ReturnType<typeof compareValue>): ReactNode => (
    <span
      className={`delta ${d.verdict === 'better' ? 'delta-good' : d.verdict === 'worse' ? 'delta-bad' : ''}`}
    >
      {label} {formatDelta(d)}
    </span>
  );
  return (
    <span className="vs-baseline">
      {cell('p99', p99)} {cell('req/s', rps)}
    </span>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{formatSeconds(Math.max(0, (now - since) / 1000))}</>;
}

function CompareTable({ a, b }: { a: BenchRun; b: BenchRun }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">
          Comparison of {a.name} and {b.name}
        </caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col" className="num">
              {a.name} (baseline)
            </th>
            <th scope="col" className="num">
              {b.name}
            </th>
            <th scope="col" className="num">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((row) => {
            const av = a.summary[row.key] as number;
            const bv = b.summary[row.key] as number;
            const d = compareValue(av, bv, row.better);
            const cls =
              d.verdict === 'better' ? 'delta-good' : d.verdict === 'worse' ? 'delta-bad' : '';
            const icon = d.verdict === 'better' ? '▲ ' : d.verdict === 'worse' ? '▼ ' : '';
            const fmt = (v: number): string =>
              `${v.toLocaleString('en-US', { minimumFractionDigits: row.digits, maximumFractionDigits: row.digits })}${row.unit ? ` ${row.unit}` : ''}`;
            return (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td className="num mono">{fmt(av)}</td>
                <td className="num mono">{fmt(bv)}</td>
                <td className={`num mono ${cls}`}>
                  {icon}
                  {formatDelta(d)}
                  <span className="sr-only"> ({d.verdict})</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunDetail({ run }: { run: BenchRun }) {
  const s = run.summary;
  const [copied, setCopied] = useState(false);
  const report = formatRunReport(run);
  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(report)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  const series: ChartSeries[] = [{ ...runSeries(run, 1, 'rps', 'req/s'), area: true }];
  const lat: ChartSeries[] = [runSeries(run, 3, 'p50', 'p50'), runSeries(run, 4, 'p99', 'p99')].map(
    (x, i) => ({ ...x, name: i === 0 ? 'p50' : 'p99' }),
  );
  return (
    <Card
      title={run.name}
      subtitle={`${formatClock(run.startMs)} – ${formatClock(run.endMs)} · ${s.durationSec}s`}
      actions={
        <button type="button" className="btn btn-sm" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy report'}
        </button>
      }
    >
      <div className="tile-row">
        <Kpi
          label="Requests"
          value={s.requests.toLocaleString()}
          caption={`${s.errors5xx} 5xx · ${s.errors4xx} 4xx`}
        />
        <Kpi
          label="Throughput"
          value={s.avgRps.toFixed(1)}
          unit="req/s"
          caption={`peak ${s.peakRps.toFixed(0)} · ${s.mbPerSec.toFixed(2)} MB/s`}
        />
        <Kpi label="p50" value={formatDuration(s.p50)} caption={`avg ${formatDuration(s.avgMs)}`} />
        <Kpi label="p99" value={formatDuration(s.p99)} caption={`max ${formatDuration(s.maxMs)}`} />
        <Kpi
          label="Event loop p99"
          value={formatDuration(s.loopP99)}
          caption={`CPU ${s.cpuAvg.toFixed(0)}% · RSS ${formatBytes(s.rssPeak)}`}
        />
      </div>
      <div className="dash-grid">
        <LineChart
          title="Run throughput"
          unit="req/s"
          series={series}
          format={(v) => `${v.toFixed(1)} /s`}
          timeFormat={relTime}
        />
        <LineChart
          title="Run latency"
          unit="ms"
          series={lat}
          format={formatDuration}
          tickFormat={(v) => String(Math.round(v * 10) / 10)}
          timeFormat={relTime}
        />
      </div>
      <pre className="report mono" aria-label="Run report">
        {report}
      </pre>
    </Card>
  );
}

export function RunsView({ intervalMs }: { intervalMs: number }) {
  const poll = usePolledPanel<RunsData>('runs', () => getRuns(), Math.min(intervalMs, 2000));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [rerun, setRerun] = useState<RerunRequest | null>(null);
  // After a re-run finishes, compare the new run against the one it repeated.
  const rerunOf = useRef<number | null>(null);

  const data = poll.data;
  const runs = useMemo(() => data?.runs ?? [], [data]);
  const selected = picked
    .map((id) => runs.find((r) => r.id === id))
    .filter((r): r is BenchRun => !!r);

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

  const toggle = (id: number): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));

  const baselineRun = runs.find((r) => r.id === data?.baselineId);
  const fileRef = useRef<HTMLInputElement>(null);
  // One run selected while a baseline is pinned compares against that baseline.
  const first = selected[0];
  const [a, b] =
    selected.length === 1 && first && baselineRun && baselineRun.id !== first.id
      ? [baselineRun, first]
      : selected;

  const doExport = (): Promise<void> =>
    act(async () => {
      downloadFile('nodeui-runs.json', await exportRuns(), 'application/json');
    });
  const doImport = (file: File | undefined): Promise<void> =>
    act(async () => {
      if (!file) return;
      await importRuns(JSON.parse(await file.text()) as unknown);
    });
  const cmpSeries: ChartSeries[] =
    a && b
      ? [
          { ...runSeries(a, 1, 'p99', 'p99'), name: `${a.name} p99` },
          { ...runSeries(b, 2, 'p99', 'p99'), name: `${b.name} p99` },
        ]
      : [];
  const cmpRps: ChartSeries[] =
    a && b
      ? [
          { ...runSeries(a, 1, 'rps', 'req/s'), name: `${a.name} req/s` },
          { ...runSeries(b, 2, 'rps', 'req/s'), name: `${b.name} req/s` },
        ]
      : [];

  return (
    <>
      <ViewHeader
        title="Load tests"
        description="Record a run while you fire traffic (autocannon, k6, wrk…), then compare runs before and after a change."
      />
      <LoadGenerator
        intervalMs={intervalMs}
        rerun={rerun}
        onFinished={(runId) => {
          poll.refetch();
          if (runId === undefined) return;
          const original = rerunOf.current;
          rerunOf.current = null;
          setPicked(original === null ? [runId] : [original, runId]);
        }}
      />
      <Card>
        <div className="toolbar">
          {data?.active ? (
            <>
              <span role="status">
                <span className="rec-dot" aria-hidden="true" />
                Recording <strong>{data.active.name}</strong> ·{' '}
                <Elapsed since={data.active.startMs} />
              </span>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void act(stopRun)}
              >
                ■ Stop and save
              </button>
            </>
          ) : (
            <>
              <input
                className="input grow"
                type="text"
                placeholder="Run name, e.g. before-cache"
                aria-label="Run name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')
                    void act(() => startRun(name.trim()).then(() => setName('')));
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void act(() => startRun(name.trim()).then(() => setName('')))}
              >
                ● Start recording
              </button>
            </>
          )}
        </div>
        <p className="muted-text">
          Tip: forgot to press record? Open <a href="#/metrics">Metrics</a>, drag across the
          interval that contains your test, and choose “Save as run”.
        </p>
        <div className="toolbar">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void doExport()}
          >
            Export runs
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Import runs
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            aria-label="Import runs file"
            hidden
            onChange={(e) => {
              void doImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <span className="muted-text">
            {data && !data.persisted
              ? 'Runs are kept in memory. Set the persist or runsFile option to keep them across restarts.'
              : 'Runs are saved to disk.'}
          </span>
        </div>
        {error ? <ErrorState message={error} /> : null}
      </Card>

      {poll.error && !data ? (
        <Card>
          <ErrorState message={poll.error} onRetry={poll.refetch} />
        </Card>
      ) : !data ? (
        <Skeleton lines={5} label="Loading runs" />
      ) : runs.length === 0 ? (
        <Card>
          <EmptyState title="No runs yet">
            Start a recording, run your load test against the app, then stop to see a report.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card
            title="Saved runs"
            subtitle="Select two to compare. The first selected is the baseline."
          >
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Saved runs</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Select</span>
                    </th>
                    <th scope="col">Name</th>
                    <th scope="col">When</th>
                    <th scope="col" className="num">
                      Duration
                    </th>
                    <th scope="col" className="num">
                      Requests
                    </th>
                    <th scope="col" className="num">
                      req/s
                    </th>
                    <th scope="col" className="num">
                      p50
                    </th>
                    <th scope="col" className="num">
                      p99
                    </th>
                    <th scope="col" className="num">
                      5xx
                    </th>
                    <th scope="col">vs baseline</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className={picked.includes(r.id) ? 'row-selected' : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name}`}
                          checked={picked.includes(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                      </td>
                      <td>{r.name}</td>
                      <td className="mono nowrap">{formatClock(r.startMs)}</td>
                      <td className="num mono">{r.summary.durationSec}s</td>
                      <td className="num mono">{r.summary.requests.toLocaleString()}</td>
                      <td className="num mono">{r.summary.avgRps.toFixed(1)}</td>
                      <td className="num mono">{formatDuration(r.summary.p50)}</td>
                      <td className="num mono">{formatDuration(r.summary.p99)}</td>
                      <td className="num mono">{r.summary.errors5xx}</td>
                      <td className="nowrap">
                        {baselineRun && r.id === baselineRun.id ? (
                          <strong>Baseline</strong>
                        ) : baselineRun ? (
                          <VsBaseline base={baselineRun} run={r} />
                        ) : (
                          <span className="muted-text">—</span>
                        )}
                      </td>
                      <td className="nowrap">
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy}
                          aria-label={
                            baselineRun?.id === r.id
                              ? `Clear baseline ${r.name}`
                              : `Set ${r.name} as baseline`
                          }
                          onClick={() =>
                            void act(() => setBaseline(baselineRun?.id === r.id ? null : r.id))
                          }
                        >
                          {baselineRun?.id === r.id ? 'Unpin' : 'Set baseline'}
                        </button>{' '}
                        {r.loadTest ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={busy || data?.active !== null}
                              aria-label={`Re-run ${r.name}`}
                              title="Run the same load test again and compare"
                              onClick={() => {
                                rerunOf.current = r.id;
                                setRerun({
                                  token: Date.now(),
                                  config: r.loadTest as LoadTestConfig,
                                });
                              }}
                            >
                              Re-run
                            </button>{' '}
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy}
                          aria-label={`Delete ${r.name}`}
                          onClick={() => {
                            setPicked((p) => p.filter((x) => x !== r.id));
                            void act(() => deleteRun(r.id));
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {a && b ? (
            <>
              <Card title="Comparison" subtitle={`${b.name} against baseline ${a.name}`}>
                <CompareTable a={a} b={b} />
              </Card>
              <div className="dash-grid">
                <Card title="p99 latency overlay" subtitle="aligned to each run's start">
                  <LineChart
                    title="p99 overlay"
                    unit="ms"
                    series={cmpSeries}
                    format={formatDuration}
                    tickFormat={(v) => String(Math.round(v * 10) / 10)}
                    timeFormat={relTime}
                  />
                </Card>
                <Card title="Throughput overlay" subtitle="aligned to each run's start">
                  <LineChart
                    title="Throughput overlay"
                    unit="req/s"
                    series={cmpRps}
                    format={(v) => `${v.toFixed(1)} /s`}
                    timeFormat={relTime}
                  />
                </Card>
              </div>
            </>
          ) : a ? (
            <RunDetail run={a} />
          ) : (
            <p className="muted-text">Select a run to see its report, or two runs to compare.</p>
          )}
        </>
      )}
    </>
  );
}
