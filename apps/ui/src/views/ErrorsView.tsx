import { useMemo, useState } from 'react';
import {
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  ExportButtons,
  Skeleton,
  ViewHeader,
} from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { formatClock } from '../format';
import { usePanel } from '../telemetry';
import type { ErrorGroup, ErrorsData } from '../types';

const columns: Column<ErrorGroup>[] = [
  {
    key: 'last',
    label: 'Last seen',
    sortValue: (g) => g.lastSeenMs,
    render: (g) => formatClock(g.lastSeenMs),
    className: 'mono nowrap',
    width: 100,
  },
  {
    key: 'count',
    label: 'Count',
    align: 'right',
    sortValue: (g) => g.count,
    render: (g) => g.count,
    className: 'mono nowrap',
    width: 80,
  },
  {
    key: 'error',
    label: 'Error',
    sortValue: (g) => g.name,
    render: (g) => `${g.name}: ${g.message}`,
    className: 'mono truncate',
    title: (g) => `${g.name}: ${g.message}`,
  },
  {
    key: 'route',
    label: 'Route',
    sortValue: (g) => g.lastRoute ?? '',
    render: (g) => g.lastRoute ?? '',
    className: 'mono truncate',
    width: 180,
  },
  {
    key: 'source',
    label: 'Source',
    sortValue: (g) => g.source,
    render: (g) => g.source,
    className: 'nowrap',
    width: 96,
  },
];

export function ErrorsView({ intervalMs }: { intervalMs: number }) {
  const { data, error, refetch } = usePanel<ErrorsData>('errors', '/errors', intervalMs);
  const [selected, setSelected] = useState<ErrorGroup | null>(null);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.groups ?? []).filter(
      (g) => q === '' || `${g.name} ${g.message} ${g.lastRoute ?? ''}`.toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <>
      <ViewHeader
        title="Errors"
        description="Failures grouped by type, message shape and origin. Unhandled exceptions and rejections are observed without changing how Node reacts to them."
        actions={<ExportButtons name="nodeui-errors" json={data ?? undefined} csv={rows} />}
      />
      <Card>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <Skeleton lines={6} label="Loading errors" />
        ) : (
          <>
            <div className="toolbar">
              <input
                className="input grow"
                type="search"
                placeholder="Filter by type, message or route…"
                aria-label="Filter errors"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="muted-text">
                {data.total} total · {data.groups.length} distinct
              </span>
            </div>
            {rows.length === 0 ? (
              <EmptyState title="No errors recorded">
                {data.groups.length === 0
                  ? 'Handler errors (Express: app.use(errorHandler), Fastify, Nest), uncaught exceptions and unhandled rejections show up here.'
                  : 'No error matches the filter.'}
              </EmptyState>
            ) : (
              <DataTable
                caption="Error groups"
                columns={columns}
                rows={rows}
                rowKey={(g) => g.id}
                defaultSort={{ key: 'last', dir: 'desc' }}
                onRowClick={setSelected}
                selectedKey={selected?.id}
                rowClass={() => 'row-failed'}
                maxHeight="calc(100vh - 300px)"
              />
            )}
          </>
        )}
      </Card>
      {selected ? (
        <Drawer title="Error details" onClose={() => setSelected(null)}>
          <dl className="detail-list">
            <div>
              <dt>Type</dt>
              <dd className="mono">{selected.name}</dd>
            </div>
            <div>
              <dt>Message</dt>
              <dd className="mono wrap-anywhere">{selected.message}</dd>
            </div>
            <div>
              <dt>Occurrences</dt>
              <dd className="mono">{selected.count}</dd>
            </div>
            <div>
              <dt>First / last seen</dt>
              <dd className="mono">
                {formatClock(selected.firstSeenMs)} / {formatClock(selected.lastSeenMs)}
              </dd>
            </div>
            {selected.lastRoute ? (
              <div>
                <dt>Route</dt>
                <dd className="mono wrap-anywhere">{selected.lastRoute}</dd>
              </div>
            ) : null}
            {selected.lastRequestId !== undefined ? (
              <div>
                <dt>Last request</dt>
                <dd className="mono">#{selected.lastRequestId}</dd>
              </div>
            ) : null}
          </dl>
          <h3>Stack trace</h3>
          <pre className="curl mono">{selected.stack || 'No stack trace available.'}</pre>
        </Drawer>
      ) : null}
    </>
  );
}
