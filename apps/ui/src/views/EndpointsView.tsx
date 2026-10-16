import { useMemo, useState } from 'react';
import { getPanel, resetRouteMetrics } from '../api';
import { MethodBadge } from '../components/badges';
import { Card, EmptyState, ErrorState, Skeleton, ViewHeader } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { Kpi } from '../components/Kpi';
import { formatBytes, formatDuration, formatPercent } from '../format';
import { usePolledPanel } from '../hooks';
import { Sparkline } from '../Sparkline';
import { usePaused } from '../telemetry';
import type { RouteMetricRow, RouteMetricsData } from '../types';

/** A route is "hot" when it carries a large share of all time spent serving requests. */
function timeShare(row: RouteMetricRow, totalMs: number): number {
  return totalMs > 0 ? row.totalMs / totalMs : 0;
}

export function EndpointsView({ intervalMs }: { intervalMs: number }) {
  const paused = usePaused();
  const [query, setQuery] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const poll = usePolledPanel<RouteMetricsData>(
    'routemetrics',
    () => getPanel<RouteMetricsData>('/routemetrics'),
    Math.min(intervalMs, 3000),
    !paused,
  );
  const data = poll.data;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.routes ?? []).filter(
      (r) =>
        (!errorsOnly || r.errors5xx > 0) &&
        (q === '' || r.path.toLowerCase().includes(q) || r.method.toLowerCase().includes(q)),
    );
  }, [data, query, errorsOnly]);

  const totalMs = data?.totals.totalMs ?? 0;
  const slowest = useMemo(
    () => [...(data?.routes ?? [])].filter((r) => r.count >= 5).sort((a, b) => b.p95 - a.p95)[0],
    [data],
  );
  const mostErrors = useMemo(
    () =>
      [...(data?.routes ?? [])]
        .filter((r) => r.errors5xx > 0)
        .sort((a, b) => b.errorRate - a.errorRate)[0],
    [data],
  );

  const columns: Column<RouteMetricRow>[] = [
    {
      key: 'method',
      label: 'Method',
      sortValue: (r) => r.method,
      render: (r) =>
        r.method === '*' ? (
          <span className="muted-text">any</span>
        ) : (
          <MethodBadge method={r.method} />
        ),
      width: 90,
    },
    {
      key: 'path',
      label: 'Route',
      sortValue: (r) => r.path,
      render: (r) => r.path,
      className: 'mono truncate',
      title: (r) => r.path,
    },
    {
      key: 'count',
      label: 'Requests',
      sortValue: (r) => r.count,
      render: (r) => r.count.toLocaleString(),
      align: 'right',
      width: 90,
    },
    {
      key: 'rps',
      label: 'Trend',
      render: (r) => <Sparkline values={r.sparkRps} height={22} />,
      width: 110,
    },
    {
      key: 'p50',
      label: 'p50',
      sortValue: (r) => r.p50,
      render: (r) => formatDuration(r.p50),
      align: 'right',
      width: 84,
    },
    {
      key: 'p95',
      label: 'p95',
      sortValue: (r) => r.p95,
      render: (r) => formatDuration(r.p95),
      align: 'right',
      width: 84,
    },
    {
      key: 'p99',
      label: 'p99',
      sortValue: (r) => r.p99,
      render: (r) => formatDuration(r.p99),
      align: 'right',
      width: 84,
    },
    {
      key: 'max',
      label: 'Max',
      sortValue: (r) => r.maxMs,
      render: (r) => formatDuration(r.maxMs),
      align: 'right',
      width: 84,
    },
    {
      key: 'errors',
      label: '5xx',
      sortValue: (r) => r.errorRate,
      render: (r) =>
        r.errors5xx > 0 ? (
          <span className="status-critical">
            {r.errors5xx.toLocaleString()} ({formatPercent(r.errorRate)})
          </span>
        ) : (
          <span className="muted-text">0</span>
        ),
      align: 'right',
      width: 110,
    },
    {
      key: 'time',
      label: 'Time share',
      sortValue: (r) => r.totalMs,
      render: (r) => {
        const share = timeShare(r, totalMs);
        return (
          <span className="share-cell" title={`${formatDuration(r.totalMs)} total`}>
            <span className="share-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(2, share * 100)}%` }} />
            </span>
            {formatPercent(share, 0)}
          </span>
        );
      },
      align: 'right',
      width: 130,
    },
    {
      key: 'bytes',
      label: 'Sent',
      sortValue: (r) => r.bytesOut,
      render: (r) => formatBytes(r.bytesOut),
      align: 'right',
      width: 84,
    },
  ];

  const reset = async (): Promise<void> => {
    setResetting(true);
    setResetError(null);
    try {
      await resetRouteMetrics();
      poll.refetch();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <ViewHeader
        title="Endpoints"
        description="Latency, errors and where the time goes, per route. Sorted by total time spent by default."
        actions={
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void reset()}
            disabled={resetting}
          >
            Reset stats
          </button>
        }
      />
      {resetError ? (
        <p className="status-critical" role="alert">
          {resetError}
        </p>
      ) : null}
      {poll.error && !data ? (
        <Card>
          <ErrorState message={poll.error} onRetry={poll.refetch} />
        </Card>
      ) : !data ? (
        <Skeleton lines={6} label="Loading endpoints" />
      ) : data.routes.length === 0 ? (
        <Card>
          <EmptyState title="No requests yet">
            Send some traffic to your app. Each route appears here with its own latency percentiles
            and error rate.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="tile-row">
            <Kpi
              label="Routes"
              value={data.routes.length.toLocaleString()}
              caption={`${data.totals.requests.toLocaleString()} requests`}
            />
            <Kpi
              label="Slowest p95"
              value={slowest ? formatDuration(slowest.p95) : '—'}
              caption={slowest ? `${slowest.method} ${slowest.path}` : 'needs 5+ requests'}
            />
            <Kpi
              label="Busiest route"
              value={data.routes[0] ? formatPercent(timeShare(data.routes[0], totalMs), 0) : '—'}
              unit="of time"
              caption={
                data.routes[0] ? `${data.routes[0].method} ${data.routes[0].path}` : undefined
              }
            />
            <Kpi
              label="Failing"
              value={mostErrors ? formatPercent(mostErrors.errorRate) : '0%'}
              caption={mostErrors ? `${mostErrors.method} ${mostErrors.path}` : 'no 5xx responses'}
              tone={mostErrors ? 'crit' : 'good'}
              toneLabel={mostErrors ? 'Errors' : 'Clean'}
            />
          </div>
          <Card
            actions={
              <div className="toolbar">
                <input
                  type="search"
                  className="input"
                  placeholder="Filter routes…"
                  aria-label="Filter routes"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={errorsOnly}
                    onChange={(e) => setErrorsOnly(e.target.checked)}
                  />
                  Only with 5xx
                </label>
              </div>
            }
          >
            <DataTable
              caption="Per-route performance"
              columns={columns}
              rows={rows}
              rowKey={(r) => `${r.method} ${r.path}`}
              defaultSort={{ key: 'time', dir: 'desc' }}
            />
          </Card>
        </>
      )}
    </>
  );
}
