import { useEffect, useMemo, useState } from 'react';
import { addAnnotation, getPanel, saveRun } from '../api';
import { Heatmap } from '../charts/Heatmap';
import { LineChart, type ChartSeries } from '../charts/LineChart';
import { Card, EmptyState, ErrorState, Skeleton, ViewHeader } from '../components/common';
import { Kpi } from '../components/Kpi';
import { formatBytes, formatClock, formatDuration, formatSpan } from '../format';
import { usePolledPanel } from '../hooks';
import { hrefFor } from '../router';
import { usePaused } from '../telemetry';
import type { TimeSeriesData, TimeSeriesPoint } from '../types';

const RANGES = [
  { id: '5m', label: '5m', ms: 5 * 60_000 },
  { id: '15m', label: '15m', ms: 15 * 60_000 },
  { id: '1h', label: '1h', ms: 60 * 60_000 },
  { id: '3h', label: '3h', ms: 3 * 60 * 60_000 },
  { id: '8h', label: '8h', ms: 8 * 60 * 60_000 },
] as const;

const MB = 1024 * 1024;

interface Zoom {
  from: number;
  to: number;
}

type Picker = (p: TimeSeriesPoint) => number;

function line(
  points: TimeSeriesPoint[],
  id: string,
  name: string,
  color: number,
  pick: Picker,
  extra: Partial<ChartSeries> = {},
): ChartSeries {
  return {
    id,
    name,
    color: `var(--series-${color})`,
    points: points.map((p) => ({ t: p.t, v: pick(p) })),
    ...extra,
  };
}

const fmtRate = (v: number): string => `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} /s`;
const fmtMs = (v: number): string => formatDuration(v);
const fmtMb = (v: number): string => `${(v / MB).toFixed(1)} MB`;
const fmtBps = (v: number): string => `${formatBytes(v)}/s`;

export function MetricsView({ intervalMs }: { intervalMs: number }) {
  const paused = usePaused();
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]['id']>('15m');
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [follow, setFollow] = useState(true);
  const [cursorT, setCursorT] = useState<number | null>(null);
  const [saveName, setSaveName] = useState('');
  const [markLabel, setMarkLabel] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rangeMs = RANGES.find((r) => r.id === rangeId)?.ms ?? 15 * 60_000;
  const query = zoom
    ? `/timeseries?from=${Math.floor(zoom.from)}&to=${Math.ceil(zoom.to)}&points=300&heatmap=1`
    : `/timeseries?range=${rangeMs}&points=300&heatmap=1`;

  const live = follow && !zoom && !paused;
  const poll = usePolledPanel<TimeSeriesData>(
    'timeseries',
    () => getPanel<TimeSeriesData>(query),
    Math.min(intervalMs, 2000),
  );
  const { refetch } = poll;
  useEffect(() => {
    refetch();
  }, [query]);

  // While not following, freeze the displayed snapshot so charts hold still.
  const [frozen, setFrozen] = useState<TimeSeriesData | null>(null);
  useEffect(() => {
    if (poll.data && (live || zoom !== null || frozen === null)) setFrozen(poll.data);
  }, [poll.data, live, zoom, frozen]);
  const data = live || zoom ? (poll.data ?? frozen) : frozen;

  const points = useMemo(() => data?.points ?? [], [data]);
  const stepSec = (data?.stepMs ?? 1000) / 1000;
  const sum = data?.summary;

  const throughput = useMemo<ChartSeries[]>(
    () => [
      line(points, 'rps', 'Requests', 1, (p) => p.rps, { area: true }),
      line(points, 'e5', '5xx', 8, (p) => p.errors / stepSec, { dash: '4 3' }),
      line(points, 'e4', '4xx', 5, (p) => p.errors4xx / stepSec, { dash: '2 3' }),
    ],
    [points, stepSec],
  );
  const latency = useMemo<ChartSeries[]>(
    () => [
      line(points, 'p50', 'p50', 3, (p) => p.p50),
      line(points, 'p95', 'p95', 2, (p) => p.p95),
      line(points, 'p99', 'p99', 4, (p) => p.p99),
      line(points, 'max', 'max', 8, (p) => p.maxMs, { dash: '4 3' }),
    ],
    [points],
  );
  const inflight = useMemo<ChartSeries[]>(
    () => [line(points, 'inflight', 'In flight (peak)', 6, (p) => p.inflight, { area: true })],
    [points],
  );
  const network = useMemo<ChartSeries[]>(
    () => [
      line(points, 'out', 'Sent', 1, (p) => p.bytesOutPerSec, { area: true }),
      line(points, 'in', 'Received', 2, (p) => p.bytesInPerSec, { dash: '4 3' }),
    ],
    [points],
  );
  const loop = useMemo<ChartSeries[]>(
    () => [
      line(points, 'l50', 'p50', 3, (p) => p.loopP50),
      line(points, 'l99', 'p99', 4, (p) => p.loopP99),
      line(points, 'lmax', 'max', 8, (p) => p.loopMax, { dash: '4 3' }),
    ],
    [points],
  );
  const memory = useMemo<ChartSeries[]>(
    () => [
      line(points, 'rss', 'RSS', 2, (p) => p.rss),
      line(points, 'heap', 'Heap used', 1, (p) => p.heapUsed, { area: true }),
      line(points, 'heapT', 'Heap total', 7, (p) => p.heapTotal, { dash: '4 3' }),
    ],
    [points],
  );
  const cpu = useMemo<ChartSeries[]>(
    () => [line(points, 'cpu', 'CPU', 5, (p) => p.cpu, { area: true })],
    [points],
  );
  const gc = useMemo<ChartSeries[]>(
    () => [line(points, 'gc', 'GC pause', 6, (p) => p.gcMs / stepSec, { area: true })],
    [points, stepSec],
  );

  const markers = useMemo(
    () => (data?.annotations ?? []).map((a) => ({ t: a.atMs, label: a.label, kind: a.kind })),
    [data],
  );

  const shared = {
    markers,
    cursorT,
    onCursorT: setCursorT,
    onBrush: (t0: number, t1: number) => {
      setZoom({ from: t0, to: t1 });
      setFollow(false);
    },
  };

  const trend = data?.heapTrend;
  const spanLabel = data ? formatSpan(data.toMs - data.fromMs) : '';
  const errRate = sum && sum.requests > 0 ? sum.errors5xx / sum.requests : 0;

  const onMark = async (): Promise<void> => {
    const label = markLabel.trim();
    if (!label) return;
    setSaveError(null);
    try {
      await addAnnotation(label);
      setMarkLabel('');
      refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to add marker');
    }
  };

  const onSave = async (): Promise<void> => {
    if (!data) return;
    setSaveError(null);
    try {
      const run = await saveRun(
        saveName.trim() || `Metrics ${formatClock(data.fromMs)}`,
        data.fromMs,
        data.toMs,
      );
      setSaved(run.name);
      setSaveName('');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save run');
    }
  };

  const showError = poll.error && !data;

  return (
    <>
      <ViewHeader
        title="Metrics"
        description="Request rate, latency percentiles, concurrency, event loop, memory, CPU and GC over time. Drag across any chart to zoom."
      />
      <div className="dash-bar" role="toolbar" aria-label="Time range">
        <div className="chip-row" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`chip${!zoom && rangeId === r.id ? ' chip-active' : ''}`}
              aria-pressed={!zoom && rangeId === r.id}
              onClick={() => {
                setZoom(null);
                setRangeId(r.id);
              }}
            >
              Last {r.label}
            </button>
          ))}
        </div>
        {zoom ? (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setZoom(null);
              setFollow(true);
            }}
          >
            Reset zoom
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            aria-pressed={!follow}
            onClick={() => setFollow((f) => !f)}
            title={follow ? 'Freeze the charts' : 'Follow live data'}
          >
            {follow ? 'Pause' : 'Resume'}
          </button>
        )}
        <span className="muted-text" aria-live="polite">
          {data
            ? `${formatClock(data.fromMs)} – ${formatClock(data.toMs)} · ${spanLabel} · ${formatSpan(data.stepMs)} per point`
            : ''}
        </span>
        <span className="spacer" />
        {data?.recording ? (
          <a className="btn btn-sm" href={hrefFor('runs')}>
            <span className="rec-dot" aria-hidden="true" />
            Recording “{data.recording.name}”
          </a>
        ) : null}
        <input
          className="input"
          type="text"
          placeholder="Mark now: deployed, cache on…"
          aria-label="Marker label"
          value={markLabel}
          onChange={(e) => setMarkLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onMark();
          }}
          style={{ width: 200 }}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={markLabel.trim() === ''}
          onClick={() => void onMark()}
          title="Drop a marker on every chart at this moment"
        >
          Add marker
        </button>
        <input
          className="input"
          type="text"
          placeholder="Name this range…"
          aria-label="Run name"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          style={{ width: 170 }}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={!data || points.length === 0}
          onClick={() => void onSave()}
          title="Save this time range as a run you can compare later"
        >
          Save as run
        </button>
      </div>
      {saved ? (
        <p className="ok-text" role="status">
          ✓ Saved “{saved}”. <a href={hrefFor('runs')}>Open Load tests</a>
        </p>
      ) : null}
      {saveError ? <ErrorState message={saveError} /> : null}

      {showError ? (
        <Card>
          <ErrorState message={poll.error ?? ''} onRetry={poll.refetch} />
        </Card>
      ) : !data ? (
        <Skeleton lines={8} label="Loading metrics" />
      ) : points.length === 0 ? (
        <Card>
          <EmptyState title="No data in this range">
            Metrics are collected from the moment the app starts. Send some traffic and the charts
            fill in.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="tile-row">
            <Kpi
              label="Requests"
              value={sum ? sum.requests.toLocaleString() : '—'}
              caption={data.totals.requests.toLocaleString() + ' since start'}
            />
            <Kpi
              label="Throughput"
              value={sum ? sum.avgRps.toFixed(1) : '—'}
              unit="req/s"
              caption={sum ? `peak ${sum.peakRps.toFixed(0)} req/s` : undefined}
            />
            <Kpi
              label="Latency p95"
              value={sum ? formatDuration(sum.p95) : '—'}
              caption={
                sum ? `p50 ${formatDuration(sum.p50)} · p99 ${formatDuration(sum.p99)}` : undefined
              }
            />
            <Kpi
              label="Error rate"
              value={`${(errRate * 100).toFixed(2)}%`}
              caption={sum ? `${sum.errors5xx} 5xx · ${sum.errors4xx} 4xx` : undefined}
              tone={errRate >= 0.05 ? 'crit' : errRate >= 0.01 ? 'warn' : 'good'}
              toneLabel={errRate >= 0.05 ? 'High' : errRate >= 0.01 ? 'Elevated' : 'Low'}
            />
            <Kpi
              label="Event loop p99"
              value={sum ? formatDuration(sum.loopP99) : '—'}
              caption={sum ? `max ${formatDuration(sum.loopMax)}` : undefined}
              tone={sum && sum.loopP99 >= 200 ? 'crit' : sum && sum.loopP99 >= 50 ? 'warn' : 'good'}
              toneLabel={
                sum && sum.loopP99 >= 200
                  ? 'Blocked'
                  : sum && sum.loopP99 >= 50
                    ? 'Busy'
                    : 'Healthy'
              }
            />
            {trend ? (
              <Kpi
                label="Heap trend"
                value={
                  trend.windowMs >= 5 * 60_000
                    ? `${trend.slopeMbPerMin >= 0 ? '+' : ''}${trend.slopeMbPerMin.toFixed(1)}`
                    : '—'
                }
                unit={trend.windowMs >= 5 * 60_000 ? 'MB/min' : undefined}
                caption={
                  trend.windowMs >= 5 * 60_000
                    ? `floor ${trend.floorStartMb.toFixed(0)} → ${trend.floorEndMb.toFixed(0)} MB`
                    : trend.reason
                }
                tone={trend.suspect ? 'warn' : trend.windowMs >= 5 * 60_000 ? 'good' : 'neutral'}
                toneLabel={trend.suspect ? 'Possible leak' : 'Stable'}
                testId="heap-trend"
              />
            ) : null}
          </div>
          <div className="dash-grid">
            <Card title="Throughput" subtitle="requests per second, with 5xx and 4xx">
              <LineChart
                title="Requests per second"
                unit="req/s"
                series={throughput}
                format={fmtRate}
                tickFormat={(v) => String(Math.round(v * 10) / 10)}
                {...shared}
              />
            </Card>
            <Card title="Latency" subtitle="percentiles per window (histogram-based)">
              <LineChart
                title="Latency percentiles"
                unit="ms"
                series={latency}
                format={fmtMs}
                tickFormat={(v) => String(Math.round(v * 10) / 10)}
                {...shared}
              />
            </Card>
            {data.heatmap ? (
              <Card
                className="span-2"
                title="Latency heatmap"
                subtitle="every request, by time and latency band (log scale); brighter means more requests"
              >
                <Heatmap heatmap={data.heatmap} />
              </Card>
            ) : null}
            <Card title="Concurrency" subtitle="peak requests in flight">
              <LineChart
                title="In-flight requests"
                unit="requests"
                series={inflight}
                format={(v) => String(Math.round(v))}
                yMax={4}
                {...shared}
              />
            </Card>
            <Card title="Network" subtitle="bytes on the wire, headers included">
              <LineChart
                title="Network throughput"
                unit="bytes/s"
                series={network}
                format={fmtBps}
                tickFormat={(v) => formatBytes(v).replace(/\.0/, '')}
                {...shared}
              />
            </Card>
            <Card
              title="Event loop lag"
              subtitle="how long callbacks waited; high p99 means blocked code"
            >
              <LineChart
                title="Event loop delay"
                unit="ms"
                series={loop}
                format={fmtMs}
                tickFormat={(v) => String(Math.round(v * 10) / 10)}
                yMax={5}
                {...shared}
              />
            </Card>
            <Card title="Memory" subtitle="heap and resident set size">
              <LineChart
                title="Memory"
                unit="MB"
                series={memory}
                format={fmtMb}
                tickFormat={(v) => String(Math.round(v / MB))}
                {...shared}
              />
            </Card>
            <Card title="CPU" subtitle="process CPU, user + system">
              <LineChart
                title="CPU"
                unit="%"
                series={cpu}
                format={(v) => `${v.toFixed(1)} %`}
                tickFormat={(v) => String(Math.round(v))}
                yMax={10}
                {...shared}
              />
            </Card>
            <Card title="Garbage collection" subtitle="time spent in GC pauses, ms per second">
              <LineChart
                title="GC pause"
                unit="ms/s"
                series={gc}
                format={(v) => `${v.toFixed(1)} ms/s`}
                tickFormat={(v) => String(Math.round(v * 10) / 10)}
                yMax={5}
                {...shared}
              />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
