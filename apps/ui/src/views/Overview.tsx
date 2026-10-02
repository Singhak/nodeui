import { useMemo, useState } from 'react';
import { LineChart, type ChartSeries } from '../charts/LineChart';
import { StackedBar } from '../charts/StackedBar';
import { MethodBadge, STATUS_ICON, STATUS_LABEL, StatusPill } from '../components/badges';
import { Card, EmptyState, ErrorState, Skeleton, ViewHeader } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { Kpi, type Tone } from '../components/Kpi';
import { formatBytes, formatClock, formatDuration, formatSeconds } from '../format';
import { currentRate, useTelemetry, type Pt } from '../telemetry';
import type { HealthCheckResult, RouteStat } from '../types';

const RANGES = [
  { id: '1m', label: '1 min', ms: 60_000 },
  { id: '5m', label: '5 min', ms: 300_000 },
  { id: '10m', label: '10 min', ms: 600_000 },
];

const MB = 1024 * 1024;
const values = (pts: Pt[]): number[] => pts.slice(-60).map((p) => p.v);

function split(text: string): { value: string; unit: string } {
  const i = text.lastIndexOf(' ');
  return i < 0 ? { value: text, unit: '' } : { value: text.slice(0, i), unit: text.slice(i + 1) };
}

function errorTone(rate: number): { tone: Tone; label: string } {
  if (rate >= 0.05) return { tone: 'crit', label: 'High' };
  if (rate >= 0.01) return { tone: 'warn', label: 'Elevated' };
  return { tone: 'good', label: 'Low' };
}

interface RecentError {
  key: string;
  t: number;
  kind: string;
  text: string;
}

export function Overview() {
  const t = useTelemetry();
  const [rangeMs, setRangeMs] = useState(300_000);
  const { health, requests, memory, cpu, loop, history, buckets } = t;
  const summary = requests?.summary;

  const cut = useMemo(() => {
    return (pts: Pt[]): Pt[] => {
      const last = pts[pts.length - 1];
      return last ? pts.filter((p) => p.t >= last.t - rangeMs) : pts;
    };
  }, [rangeMs]);

  const rate = currentRate(buckets);
  const lag = loop?.currentMs ?? health?.eventLoopLagMs ?? null;
  const p95 = summary ? split(formatDuration(summary.p95Ms)) : null;
  const heap = memory ? split(formatBytes(memory.heapUsed)) : null;
  const et = summary ? errorTone(summary.errorRate) : null;

  const reqSeries: ChartSeries[] = [
    {
      id: 'req',
      name: 'Requests',
      color: 'var(--series-1)',
      area: true,
      points: cut(history.rps),
    },
    {
      id: 'err',
      name: 'Errors',
      color: 'var(--series-8)',
      dash: '5 4',
      points: cut(history.errs),
    },
  ];
  const memSeries: ChartSeries[] = [
    {
      id: 'heap',
      name: 'Heap used',
      color: 'var(--series-1)',
      area: true,
      points: cut(history.heap).map((p) => ({ t: p.t, v: p.v / MB })),
    },
    {
      id: 'rss',
      name: 'RSS',
      color: 'var(--series-2)',
      dash: '5 4',
      points: cut(history.rss).map((p) => ({ t: p.t, v: p.v / MB })),
    },
  ];
  const cpuSeries: ChartSeries[] = [
    { id: 'cpu', name: 'CPU', color: 'var(--series-1)', area: true, points: cut(history.cpu) },
  ];
  const loopSeries: ChartSeries[] = [
    {
      id: 'loop',
      name: 'Event-loop lag',
      color: 'var(--series-1)',
      area: true,
      points: cut(history.loop),
    },
  ];

  const recent = useMemo<RecentError[]>(() => {
    const items: RecentError[] = [];
    for (const r of requests?.entries ?? []) {
      if (r.status >= 500) {
        items.push({
          key: `r${r.id}`,
          t: r.timestampMs,
          kind: `HTTP ${r.status}`,
          text: `${r.method} ${r.path}`,
        });
      }
    }
    (t.logs?.entries ?? []).forEach((l, i) => {
      if (l.level === 'error') {
        items.push({
          key: `l${l.timestamp}-${i}`,
          t: l.timestamp,
          kind: 'log error',
          text: l.message,
        });
      }
    });
    return items.sort((a, b) => b.t - a.t).slice(0, 8);
  }, [requests, t.logs]);

  const routeCols: Column<RouteStat>[] = [
    {
      key: 'route',
      label: 'Route',
      sortValue: (r) => `${r.path} ${r.method}`,
      render: (r) => (
        <span className="route-cell">
          <MethodBadge method={r.method} /> <span className="mono">{r.path}</span>
        </span>
      ),
      className: 'truncate',
      title: (r) => `${r.method} ${r.path}`,
    },
    {
      key: 'count',
      label: 'Requests',
      align: 'right',
      sortValue: (r) => r.count,
      render: (r) => r.count,
      className: 'mono',
      width: 84,
    },
    {
      key: 'avg',
      label: 'Avg',
      align: 'right',
      sortValue: (r) => r.avgMs,
      render: (r) => formatDuration(r.avgMs),
      className: 'mono nowrap',
      width: 86,
    },
    {
      key: 'p95',
      label: 'p95',
      align: 'right',
      sortValue: (r) => r.p95Ms,
      render: (r) => formatDuration(r.p95Ms),
      className: 'mono nowrap',
      width: 86,
    },
    {
      key: 'errors',
      label: 'Errors',
      align: 'right',
      sortValue: (r) => r.errors,
      render: (r) => (r.errors > 0 ? `✕ ${r.errors}` : '0'),
      className: 'mono',
      width: 74,
    },
  ];

  const checkCols: Column<HealthCheckResult>[] = [
    {
      key: 'name',
      label: 'Check',
      sortValue: (c) => c.name,
      render: (c) => c.name,
      className: 'mono',
    },
    {
      key: 'status',
      label: 'Status',
      sortValue: (c) => c.status,
      render: (c) => (
        <StatusPill
          status={c.status === 'up' ? 'ok' : 'critical'}
          label={c.status === 'up' ? 'Up' : 'Down'}
        />
      ),
      width: 96,
    },
    {
      key: 'dur',
      label: 'Duration',
      align: 'right',
      sortValue: (c) => c.durationMs,
      render: (c) => formatDuration(c.durationMs),
      className: 'mono nowrap',
      width: 90,
    },
    {
      key: 'error',
      label: 'Error',
      render: (c) => c.error ?? '',
      className: 'mono truncate',
      title: (c) => c.error ?? '',
    },
  ];

  const status = health?.status ?? 'unknown';
  const statusTone: Tone =
    status === 'ok'
      ? 'good'
      : status === 'degraded'
        ? 'warn'
        : status === 'critical'
          ? 'crit'
          : 'neutral';

  return (
    <>
      <ViewHeader
        title="Overview"
        description="Is the app healthy right now? Live indicators and the last few minutes of history."
        actions={
          <div className="seg" role="group" aria-label="Chart time range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`seg-btn${rangeMs === r.ms ? ' seg-active' : ''}`}
                aria-pressed={rangeMs === r.ms}
                onClick={() => setRangeMs(r.ms)}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {t.errors.health && !health ? (
        <Card>
          <ErrorState message={t.errors.health} onRetry={t.retry} />
        </Card>
      ) : null}

      <div className="kpi-grid" aria-label="Key indicators">
        {t.loading && !t.errors.health ? (
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="kpi">
              <Skeleton lines={3} label="Loading indicator" />
            </div>
          ))
        ) : (
          <>
            <Kpi
              label="Status"
              testId="kpi-status"
              value={
                health ? (
                  <>
                    <span aria-hidden="true">{STATUS_ICON[status]}</span> {STATUS_LABEL[status]}
                  </>
                ) : (
                  '—'
                )
              }
              tone={statusTone}
              caption={health?.statusReason ?? 'No health data yet'}
            />
            <Kpi
              label="Uptime"
              testId="kpi-uptime"
              value={health ? formatSeconds(health.uptimeSeconds) : '—'}
              caption={health ? `pid ${health.pid} · ${health.nodeVersion}` : undefined}
            />
            <Kpi
              label="Requests / s"
              testId="kpi-rps"
              value={rate === null ? '—' : rate.toFixed(1)}
              unit="req/s"
              caption="avg of last 10 s"
              spark={values(history.rps)}
            />
            <Kpi
              label="Error rate"
              testId="kpi-errors"
              value={summary ? (summary.errorRate * 100).toFixed(1) : '—'}
              unit="%"
              tone={et?.tone ?? 'neutral'}
              toneLabel={et?.label}
              caption={summary ? `${summary.errors} of ${summary.count} (5xx)` : undefined}
              spark={values(history.errorRate)}
            />
            <Kpi
              label="p95 latency"
              testId="kpi-p95"
              value={p95?.value ?? '—'}
              unit={p95?.unit}
              caption={summary ? `p50 ${formatDuration(summary.p50Ms)}` : undefined}
              spark={values(history.p95)}
            />
            <Kpi
              label="Heap used"
              testId="kpi-heap"
              value={heap?.value ?? '—'}
              unit={heap?.unit}
              caption={memory ? `of ${formatBytes(memory.heapTotal)} total` : undefined}
              spark={values(history.heap)}
            />
            <Kpi
              label="CPU"
              testId="kpi-cpu"
              value={cpu ? cpu.totalPercent.toFixed(1) : '—'}
              unit="%"
              caption={
                cpu
                  ? `user ${cpu.userPercent.toFixed(1)}% · sys ${cpu.systemPercent.toFixed(1)}%`
                  : undefined
              }
              spark={values(history.cpu)}
            />
            <Kpi
              label="Event-loop lag"
              testId="kpi-lag"
              value={lag === null ? '—' : lag.toFixed(1)}
              unit="ms"
              caption={loop ? `max ${loop.maxMs.toFixed(1)} ms` : undefined}
              spark={values(history.loop)}
            />
          </>
        )}
      </div>

      <div className="chart-grid">
        <Card title="Requests & errors per second" subtitle="from request metrics, 1 s buckets">
          {t.errors.metrics && buckets.length === 0 ? (
            <ErrorState message={t.errors.metrics} onRetry={t.retry} />
          ) : (
            <LineChart
              title="Requests and errors per second"
              unit="req/s"
              series={reqSeries}
              format={(v) => `${Number.isInteger(v) ? v : v.toFixed(1)} /s`}
              tickFormat={(v) => String(v)}
              yMax={4}
            />
          )}
        </Card>
        <Card title="Memory" subtitle="heap used and resident set size">
          {t.errors.memory && !memory ? (
            <ErrorState message={t.errors.memory} onRetry={t.retry} />
          ) : (
            <LineChart
              title="Memory"
              unit="MB"
              series={memSeries}
              format={(v) => `${v.toFixed(1)} MB`}
              tickFormat={(v) => String(Math.round(v * 10) / 10)}
            />
          )}
        </Card>
        <Card title="CPU" subtitle="process CPU, user + system">
          {t.errors.cpu && !cpu ? (
            <ErrorState message={t.errors.cpu} onRetry={t.retry} />
          ) : (
            <LineChart
              title="CPU"
              unit="%"
              series={cpuSeries}
              format={(v) => `${v.toFixed(1)} %`}
              tickFormat={(v) => `${v}`}
              yMax={10}
            />
          )}
        </Card>
        <Card title="Event-loop lag" subtitle="sampled delay of the event loop">
          {t['errors']['event-loop'] && !loop ? (
            <ErrorState message={t['errors']['event-loop']} onRetry={t.retry} />
          ) : (
            <LineChart
              title="Event-loop lag"
              unit="ms"
              series={loopSeries}
              format={(v) => `${v.toFixed(2)} ms`}
              tickFormat={(v) => `${v}`}
              yMax={5}
            />
          )}
        </Card>
      </div>

      <div className="detail-grid">
        <Card
          title="Status codes"
          subtitle={summary ? `${summary.count} requests in buffer` : undefined}
          className="area-status"
        >
          {t.loading ? (
            <Skeleton lines={3} />
          ) : summary ? (
            <StackedBar
              title="Status code breakdown"
              segments={[
                {
                  id: '2xx',
                  label: '2xx success',
                  count: summary.byStatus['2xx'],
                  color: 'var(--mark-good)',
                },
                {
                  id: '3xx',
                  label: '3xx redirect',
                  count: summary.byStatus['3xx'],
                  color: 'var(--series-1)',
                },
                {
                  id: '4xx',
                  label: '4xx client error',
                  count: summary.byStatus['4xx'],
                  color: 'var(--mark-warn)',
                },
                {
                  id: '5xx',
                  label: '5xx server error',
                  count: summary.byStatus['5xx'],
                  color: 'var(--mark-crit)',
                },
              ]}
            />
          ) : (
            <EmptyState title="No request data">
              Status codes appear after the first request.
            </EmptyState>
          )}
        </Card>

        <Card title="Slowest routes" subtitle="by p95 latency" className="area-routes">
          {t.loading ? (
            <Skeleton lines={4} />
          ) : summary && summary.routes.length > 0 ? (
            <DataTable
              caption="Slowest routes"
              columns={routeCols}
              rows={summary.routes}
              rowKey={(r) => `${r.method} ${r.path}`}
              defaultSort={{ key: 'p95', dir: 'desc' }}
              maxHeight={280}
            />
          ) : (
            <EmptyState title="No routes measured yet">
              Send a few requests to the app and per-route latency will show up here.
            </EmptyState>
          )}
        </Card>

        <Card title="Dependency checks" className="area-checks">
          {t.loading ? (
            <Skeleton lines={3} />
          ) : health?.checks && health.checks.length > 0 ? (
            <DataTable
              caption="Dependency checks"
              columns={checkCols}
              rows={health.checks}
              rowKey={(c) => c.name}
              rowClass={(c) => (c.status === 'down' ? 'row-failed' : undefined)}
              maxHeight={240}
            />
          ) : (
            <EmptyState title="No dependency checks registered">
              Register checks (database, cache, upstream APIs) in the nodeui options to see their
              status here.
            </EmptyState>
          )}
        </Card>

        <Card
          title="Recent errors"
          subtitle="failed requests and error logs"
          className="area-errors"
        >
          {t.loading ? (
            <Skeleton lines={3} />
          ) : recent.length === 0 ? (
            <EmptyState title="No recent errors">
              Nothing failed lately. 5xx responses and error logs show here.
            </EmptyState>
          ) : (
            <ul className="recent">
              {recent.map((e) => (
                <li key={e.key} className="recent-row">
                  <span className="mono nowrap muted-text">{formatClock(e.t)}</span>
                  <span className="tag tag-crit">
                    <span aria-hidden="true">✕</span> {e.kind}
                  </span>
                  <span className="mono truncate" title={e.text}>
                    {e.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
