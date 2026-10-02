import { useMemo, useState } from 'react';
import { MethodBadge, StatusCode } from '../components/badges';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  ExportButtons,
  Skeleton,
  ViewHeader,
} from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { formatClock, formatDuration } from '../format';
import { usePanel } from '../telemetry';
import type { OutgoingData, OutgoingRequestEntry } from '../types';

export function isFailedCall(entry: OutgoingRequestEntry): boolean {
  return Boolean(entry.error) || (entry.status !== null && entry.status >= 500);
}

export function OutgoingView({ intervalMs }: { intervalMs: number }) {
  const { data, error, refetch } = usePanel<OutgoingData>('outgoing', '/outgoing', intervalMs);
  const [failedOnly, setFailedOnly] = useState(false);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.entries ?? []).filter(
      (e) =>
        (!failedOnly || isFailedCall(e)) &&
        (q === '' || `${e.method} ${e.url} ${e.error ?? ''}`.toLowerCase().includes(q)),
    );
  }, [data, failedOnly, query]);

  const slowest = useMemo(() => {
    let best: OutgoingRequestEntry | undefined;
    for (const e of data?.entries ?? []) if (!best || e.durationMs > best.durationMs) best = e;
    return best;
  }, [data]);

  const columns: Column<OutgoingRequestEntry>[] = [
    {
      key: 'time',
      label: 'Time',
      sortValue: (r) => r.timestampMs,
      render: (r) => formatClock(r.timestampMs),
      className: 'mono nowrap',
      width: 92,
    },
    {
      key: 'method',
      label: 'Method',
      sortValue: (r) => r.method,
      render: (r) => <MethodBadge method={r.method} />,
      width: 84,
    },
    {
      key: 'url',
      label: 'URL',
      sortValue: (r) => r.url,
      render: (r) => r.url,
      className: 'mono truncate',
      title: (r) => r.url,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'right',
      sortValue: (r) => r.status ?? 0,
      render: (r) => <StatusCode status={r.status} />,
      className: 'nowrap',
      width: 84,
    },
    {
      key: 'duration',
      label: 'Duration',
      align: 'right',
      sortValue: (r) => r.durationMs,
      render: (r) => (
        <>
          {formatDuration(r.durationMs)}
          {r.id === slowest?.id ? <span className="badge-slowest">slowest</span> : null}
        </>
      ),
      className: 'mono nowrap',
      width: 150,
    },
    {
      key: 'error',
      label: 'Error',
      sortValue: (r) => r.error ?? '',
      render: (r) => r.error ?? '',
      className: 'mono truncate',
      title: (r) => r.error ?? '',
    },
  ];

  return (
    <>
      <ViewHeader
        title="Outgoing calls"
        description="HTTP calls the app makes to other services."
        actions={<ExportButtons name="nodeui-outgoing" json={data ?? undefined} csv={rows} />}
      />
      <Card>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <Skeleton lines={6} label="Loading outgoing calls" />
        ) : (
          <>
            <div className="toolbar">
              <Chip active={failedOnly} onClick={() => setFailedOnly((v) => !v)} tone="5xx">
                failed only
              </Chip>
              <input
                className="input grow"
                type="search"
                placeholder="Filter by method or url…"
                aria-label="Filter outgoing calls"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="muted-text">
                {data.total} total · {data.failed} failed
                {slowest ? ` · slowest ${formatDuration(slowest.durationMs)}` : ''}
              </span>
            </div>
            {rows.length === 0 ? (
              <EmptyState title="No outgoing calls to show">
                {data.entries.length === 0
                  ? 'Calls made with fetch, http or https will appear here once the app sends them.'
                  : 'No call matches the current filters.'}
              </EmptyState>
            ) : (
              <DataTable
                caption="Outgoing HTTP calls"
                columns={columns}
                rows={rows}
                rowKey={(r) => r.id}
                defaultSort={{ key: 'time', dir: 'desc' }}
                rowClass={(r) =>
                  [isFailedCall(r) ? 'row-failed' : '', r.id === slowest?.id ? 'row-slowest' : '']
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                maxHeight="calc(100vh - 300px)"
              />
            )}
          </>
        )}
      </Card>
    </>
  );
}
