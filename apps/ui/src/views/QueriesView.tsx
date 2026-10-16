import { useMemo, useState } from 'react';
import {
  Card,
  Chip,
  Drawer,
  EmptyState,
  ErrorState,
  ExportButtons,
  Skeleton,
  ViewHeader,
} from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { formatClock, formatDuration, formatPercent } from '../format';
import { usePanel } from '../telemetry';
import type { QueriesData, QueryEntry, QueryStatement } from '../types';

const columns: Column<QueryEntry>[] = [
  {
    key: 'time',
    label: 'Time',
    sortValue: (q) => q.timestampMs,
    render: (q) => formatClock(q.timestampMs),
    className: 'mono nowrap',
    width: 92,
  },
  {
    key: 'system',
    label: 'Source',
    sortValue: (q) => q.system,
    render: (q) => q.system,
    className: 'nowrap',
    width: 90,
  },
  {
    key: 'sql',
    label: 'Statement',
    sortValue: (q) => q.sql,
    render: (q) => q.sql,
    className: 'mono truncate',
    title: (q) => q.sql,
  },
  {
    key: 'rows',
    label: 'Rows',
    align: 'right',
    sortValue: (q) => q.rowCount ?? -1,
    render: (q) => (q.rowCount === undefined ? '' : q.rowCount),
    className: 'mono nowrap',
    width: 72,
  },
  {
    key: 'duration',
    label: 'Duration',
    align: 'right',
    sortValue: (q) => q.durationMs,
    render: (q) => (
      <>
        {formatDuration(q.durationMs)}
        {q.slow ? <span className="badge-slowest">slow</span> : null}
        {q.nPlusOne ? <span className="badge-slowest">N+1 ×{q.repeats}</span> : null}
      </>
    ),
    className: 'mono nowrap',
    width: 170,
  },
];

function statementColumns(totalMs: number): Column<QueryStatement>[] {
  return [
    {
      key: 'sample',
      label: 'Statement',
      sortValue: (s) => s.key,
      render: (s) => s.sample,
      className: 'mono truncate',
      title: (s) => s.sample,
    },
    {
      key: 'count',
      label: 'Calls',
      align: 'right',
      sortValue: (s) => s.count,
      render: (s) => s.count.toLocaleString(),
      className: 'mono nowrap',
      width: 76,
    },
    {
      key: 'total',
      label: 'Total time',
      align: 'right',
      sortValue: (s) => s.totalMs,
      render: (s) => (
        <span className="share-cell" title={`${formatDuration(s.totalMs)} in total`}>
          <span className="share-bar" aria-hidden="true">
            <span
              style={{ width: `${Math.max(2, (totalMs > 0 ? s.totalMs / totalMs : 0) * 100)}%` }}
            />
          </span>
          {formatPercent(totalMs > 0 ? s.totalMs / totalMs : 0, 0)}
        </span>
      ),
      width: 130,
    },
    {
      key: 'avg',
      label: 'Avg',
      align: 'right',
      sortValue: (s) => s.avgMs,
      render: (s) => formatDuration(s.avgMs),
      className: 'mono nowrap',
      width: 84,
    },
    {
      key: 'p95',
      label: 'p95',
      align: 'right',
      sortValue: (s) => s.p95Ms,
      render: (s) => formatDuration(s.p95Ms),
      className: 'mono nowrap',
      width: 84,
    },
    {
      key: 'max',
      label: 'Max',
      align: 'right',
      sortValue: (s) => s.maxMs,
      render: (s) => formatDuration(s.maxMs),
      className: 'mono nowrap',
      width: 84,
    },
    {
      key: 'flags',
      label: 'Flags',
      sortValue: (s) => s.nPlusOneRequests * 1000 + s.errors,
      render: (s) => (
        <>
          {s.nPlusOneRequests > 0 ? (
            <span className="badge-slowest" title={`Ran ${s.maxRepeats}× in one request`}>
              N+1 ×{s.maxRepeats}
            </span>
          ) : null}
          {s.errors > 0 ? <span className="badge-slowest">{s.errors} failed</span> : null}
        </>
      ),
      width: 150,
    },
  ];
}

export function QueriesView({ intervalMs }: { intervalMs: number }) {
  const { data, error, refetch } = usePanel<QueriesData>('queries', '/queries', intervalMs);
  const [slowOnly, setSlowOnly] = useState(false);
  const [repeatedOnly, setRepeatedOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<QueryEntry | null>(null);
  const [mode, setMode] = useState<'log' | 'statements'>('log');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.entries ?? []).filter(
      (e) =>
        (!slowOnly || e.slow) &&
        (!repeatedOnly || e.nPlusOne) &&
        (q === '' || `${e.system} ${e.sql} ${e.error ?? ''}`.toLowerCase().includes(q)),
    );
  }, [data, slowOnly, repeatedOnly, query]);

  const statements = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.statements ?? []).filter(
      (s) =>
        (!slowOnly || s.maxMs >= (data?.slowQueryMs ?? Infinity)) &&
        (!repeatedOnly || s.nPlusOneRequests > 0) &&
        (q === '' || `${s.system} ${s.sample}`.toLowerCase().includes(q)),
    );
  }, [data, slowOnly, repeatedOnly, query]);
  const statementTotalMs = (data?.statements ?? []).reduce((sum, s) => sum + s.totalMs, 0);

  return (
    <>
      <ViewHeader
        title="Queries"
        description="Database statements issued by the app (pg, mysql2, Prisma, or recorded manually). Parameter values are never recorded."
        actions={<ExportButtons name="nodeui-queries" json={data ?? undefined} csv={rows} />}
      />
      <Card>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <Skeleton lines={6} label="Loading queries" />
        ) : (
          <>
            <div className="toolbar">
              <div className="chip-row" role="group" aria-label="Query view">
                <button
                  type="button"
                  className={`chip${mode === 'log' ? ' chip-active' : ''}`}
                  aria-pressed={mode === 'log'}
                  onClick={() => setMode('log')}
                >
                  Log
                </button>
                <button
                  type="button"
                  className={`chip${mode === 'statements' ? ' chip-active' : ''}`}
                  aria-pressed={mode === 'statements'}
                  onClick={() => setMode('statements')}
                >
                  By statement
                </button>
              </div>
              <Chip active={slowOnly} onClick={() => setSlowOnly((v) => !v)} tone="4xx">
                slow only
              </Chip>
              <Chip active={repeatedOnly} onClick={() => setRepeatedOnly((v) => !v)} tone="5xx">
                N+1 suspects
              </Chip>
              <input
                className="input grow"
                type="search"
                placeholder="Filter by statement or source…"
                aria-label="Filter queries"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="muted-text">
                {data.total} total · {data.slow} slow (≥ {data.slowQueryMs} ms) ·{' '}
                {data.nPlusOneGroups} N+1 {data.nPlusOneGroups === 1 ? 'group' : 'groups'}
              </span>
            </div>
            {mode === 'statements' ? (
              statements.length === 0 ? (
                <EmptyState title="No statements to show">
                  {data.entries.length === 0
                    ? 'Nothing captured yet. Run some queries and they are grouped here.'
                    : 'No statement matches the current filters.'}
                </EmptyState>
              ) : (
                <DataTable
                  caption="Statements by total time"
                  columns={statementColumns(statementTotalMs)}
                  rows={statements}
                  rowKey={(s) => s.key}
                  defaultSort={{ key: 'total', dir: 'desc' }}
                  maxHeight="calc(100vh - 300px)"
                />
              )
            ) : rows.length === 0 ? (
              <EmptyState title="No queries to show">
                {data.entries.length === 0
                  ? 'Queries from pg and mysql2 are captured automatically while this view is open. For Prisma call server.trackPrisma(client); for other ORMs use server.recordQuery().'
                  : 'No query matches the current filters.'}
              </EmptyState>
            ) : (
              <DataTable
                caption="Database queries"
                columns={columns}
                rows={rows}
                rowKey={(q) => q.id}
                defaultSort={{ key: 'time', dir: 'desc' }}
                onRowClick={setSelected}
                selectedKey={selected?.id}
                rowClass={(q) => (q.error ? 'row-failed' : undefined)}
                maxHeight="calc(100vh - 300px)"
              />
            )}
          </>
        )}
      </Card>
      {selected ? (
        <Drawer title="Query details" onClose={() => setSelected(null)}>
          <dl className="detail-list">
            <div>
              <dt>Source</dt>
              <dd className="mono">{selected.system}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd className="mono">{formatDuration(selected.durationMs)}</dd>
            </div>
            {selected.rowCount !== undefined ? (
              <div>
                <dt>Rows</dt>
                <dd className="mono">{selected.rowCount}</dd>
              </div>
            ) : null}
            {selected.requestId !== undefined ? (
              <div>
                <dt>Request</dt>
                <dd className="mono">#{selected.requestId}</dd>
              </div>
            ) : null}
            {selected.nPlusOne ? (
              <div>
                <dt>N+1</dt>
                <dd>Repeated {selected.repeats}× in the same request. Consider batching.</dd>
              </div>
            ) : null}
            {selected.error ? (
              <div>
                <dt>Error</dt>
                <dd className="mono wrap-anywhere">{selected.error}</dd>
              </div>
            ) : null}
          </dl>
          <h3>Statement</h3>
          <pre className="curl mono">{selected.sql}</pre>
        </Drawer>
      ) : null}
    </>
  );
}
