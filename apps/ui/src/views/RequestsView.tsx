import { useMemo, useState } from 'react';
import { MethodBadge, StatusCode } from '../components/badges';
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
import { Kpi } from '../components/Kpi';
import { formatClock, formatDuration } from '../format';
import { useTelemetry } from '../telemetry';
import type { RequestEntry } from '../types';

const CLASSES = ['2xx', '3xx', '4xx', '5xx'] as const;

export function toCurl(entry: Pick<RequestEntry, 'method' | 'path'>, origin: string): string {
  const url = `${origin}${entry.path}`.replace(/'/g, "'\\''");
  return `curl -X ${entry.method} '${url}'`;
}

export function filterRequests(
  entries: RequestEntry[],
  classes: ReadonlySet<string>,
  method: string,
  query: string,
): RequestEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (classes.size > 0 && !classes.has(`${Math.floor(e.status / 100)}xx`)) return false;
    if (method !== 'all' && e.method !== method) return false;
    if (q && !`${e.method} ${e.path} ${e.status} ${e.ip}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

const columns: Column<RequestEntry>[] = [
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
    key: 'path',
    label: 'Path',
    sortValue: (r) => r.path,
    render: (r) => r.path,
    className: 'mono truncate',
    title: (r) => r.path,
  },
  {
    key: 'status',
    label: 'Status',
    align: 'right',
    sortValue: (r) => r.status,
    render: (r) => <StatusCode status={r.status} />,
    className: 'nowrap',
    width: 84,
  },
  {
    key: 'duration',
    label: 'Duration',
    align: 'right',
    sortValue: (r) => r.durationMs,
    render: (r) => formatDuration(r.durationMs),
    className: 'mono nowrap',
    width: 98,
  },
];

export function RequestsView() {
  const t = useTelemetry();
  const data = t.requests;
  const [classes, setClasses] = useState<ReadonlySet<string>>(new Set());
  const [method, setMethod] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<RequestEntry | null>(null);

  const methods = useMemo(
    () => [...new Set((data?.entries ?? []).map((e) => e.method))].sort(),
    [data],
  );
  const rows = useMemo(
    () => filterRequests(data?.entries ?? [], classes, method, query),
    [data, classes, method, query],
  );

  const toggleClass = (c: string): void =>
    setClasses((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const sum = data?.summary;
  const filtered = classes.size > 0 || method !== 'all' || query.trim() !== '';

  return (
    <>
      <ViewHeader
        title="Requests"
        description="Incoming HTTP requests held in the ring buffer. Click a row for details."
        actions={<ExportButtons name="nodeui-requests" json={data ?? undefined} csv={rows} />}
      />
      {t.errors.requests && !data ? (
        <Card>
          <ErrorState message={t.errors.requests} onRetry={t.retry} />
        </Card>
      ) : (
        <>
          <div className="tile-row">
            <Kpi
              label="Requests"
              value={sum ? sum.count : (data?.entries.length ?? '—')}
              caption={data ? `${data.total} since start` : undefined}
            />
            <Kpi label="p50" value={sum ? formatDuration(sum.p50Ms) : '—'} caption="median" />
            <Kpi label="p95" value={sum ? formatDuration(sum.p95Ms) : '—'} caption="slowest 5%" />
            <Kpi label="p99" value={sum ? formatDuration(sum.p99Ms) : '—'} caption="slowest 1%" />
            <Kpi
              label="Error rate"
              value={sum ? `${(sum.errorRate * 100).toFixed(1)}%` : '—'}
              caption={sum ? `${sum.errors} server errors` : undefined}
              tone={
                sum
                  ? sum.errorRate >= 0.05
                    ? 'crit'
                    : sum.errorRate >= 0.01
                      ? 'warn'
                      : 'good'
                  : 'neutral'
              }
              toneLabel={
                sum
                  ? sum.errorRate >= 0.05
                    ? 'High'
                    : sum.errorRate >= 0.01
                      ? 'Elevated'
                      : 'Low'
                  : undefined
              }
            />
          </div>
          <Card>
            <div className="toolbar">
              <div className="chip-row" role="group" aria-label="Status class">
                {CLASSES.map((c) => (
                  <Chip key={c} active={classes.has(c)} onClick={() => toggleClass(c)} tone={c}>
                    {c}
                  </Chip>
                ))}
              </div>
              <label className="field">
                <span className="sr-only">Method</span>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  aria-label="Method"
                >
                  <option value="all">All methods</option>
                  {methods.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <input
                className="input grow"
                type="search"
                placeholder="Search path, method, status, ip…"
                aria-label="Search requests"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="muted-text" aria-live="polite">
                {rows.length} of {data?.entries.length ?? 0} shown
              </span>
            </div>
            {!data ? (
              <Skeleton lines={6} label="Loading requests" />
            ) : data.entries.length === 0 ? (
              <EmptyState title="No requests observed yet">
                Send a request to the app and it will appear here.
              </EmptyState>
            ) : rows.length === 0 ? (
              <EmptyState title="No requests match the filters">
                {filtered ? 'Clear the status chips, method or search to see all requests.' : ''}
              </EmptyState>
            ) : (
              <DataTable
                caption="Incoming requests"
                columns={columns}
                rows={rows}
                rowKey={(r) => r.id}
                defaultSort={{ key: 'time', dir: 'desc' }}
                onRowClick={setSelected}
                selectedKey={selected?.id}
                rowClass={(r) => (r.status >= 500 ? 'row-failed' : undefined)}
                maxHeight="calc(100vh - 360px)"
              />
            )}
          </Card>
        </>
      )}
      {selected ? <RequestDrawer entry={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function RequestDrawer({ entry, onClose }: { entry: RequestEntry; onClose: () => void }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(toCurl(entry, window.location.origin));
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };
  return (
    <Drawer title="Request details" onClose={onClose}>
      <dl className="detail-list">
        <div>
          <dt>Method</dt>
          <dd>
            <MethodBadge method={entry.method} />
          </dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd className="mono wrap-anywhere">{entry.path}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <StatusCode status={entry.status} />
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd className="mono">{formatDuration(entry.durationMs)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd className="mono">
            {formatClock(entry.timestampMs)}{' '}
            <span className="muted-text">{new Date(entry.timestampMs).toLocaleDateString()}</span>
          </dd>
        </div>
        <div>
          <dt>Client IP</dt>
          <dd className="mono">{entry.ip}</dd>
        </div>
      </dl>
      <div className="drawer-actions">
        <button type="button" className="btn" onClick={() => void copy()}>
          Copy as curl
        </button>
        <span className="muted-text" role="status">
          {copied === 'ok'
            ? 'Copied to clipboard'
            : copied === 'fail'
              ? 'Copy failed: clipboard unavailable'
              : ''}
        </span>
      </div>
      <pre className="curl mono">{toCurl(entry, window.location.origin)}</pre>
    </Drawer>
  );
}
