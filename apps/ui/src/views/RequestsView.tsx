import { useEffect, useMemo, useState } from 'react';
import { getPanel } from '../api';
import { usePolledPanel } from '../hooks';
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
import { toAutocannon, toFetch } from '../snippets';
import { useTelemetry } from '../telemetry';
import { parseHashQuery, replaceHashQuery } from '../router';
import {
  deleteView,
  EMPTY_FILTERS,
  filtersToParams,
  loadViews,
  paramsToFilters,
  saveView,
  type RequestFilters,
  type SavedView,
} from '../requestFilters';
import { ReplayPanel } from './ReplayPanel';
import { Waterfall, type WaterfallItem } from './Waterfall';
import type {
  OutgoingData,
  OutgoingRequestEntry,
  QueriesData,
  QueryEntry,
  RequestEntry,
  RequestsData,
} from '../types';

const CLASSES = ['2xx', '3xx', '4xx', '5xx'] as const;

const SKIPPED_CURL_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'accept-encoding',
  'transfer-encoding',
]);

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

export function toCurl(
  entry: Pick<RequestEntry, 'method' | 'path'> &
    Partial<Pick<RequestEntry, 'query' | 'headers' | 'requestBody' | 'requestBodyTruncated'>>,
  origin: string,
): string {
  const search = entry.query ? new URLSearchParams(entry.query).toString() : '';
  const url = `${origin}${entry.path}${search ? `?${search}` : ''}`;
  const parts = [`curl -X ${entry.method} ${shellQuote(url)}`];
  for (const [name, value] of Object.entries(entry.headers ?? {})) {
    // Redacted credentials cannot be replayed; skip them rather than send a placeholder.
    if (SKIPPED_CURL_HEADERS.has(name) || value === '[REDACTED]') continue;
    parts.push(`-H ${shellQuote(`${name}: ${value}`)}`);
  }
  if (entry.requestBody && !entry.requestBodyTruncated) {
    parts.push(`--data-raw ${shellQuote(entry.requestBody)}`);
  }
  return parts.join(' \\\n  ');
}

function DetailBlock({ title, data }: { title: string; data?: Record<string, string> }) {
  const rows = Object.entries(data ?? {});
  if (rows.length === 0) return null;
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <dl className="detail-list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="mono">{k}</dt>
            <dd className="mono wrap-anywhere">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BodyBlock({
  title,
  body,
  truncated,
}: {
  title: string;
  body?: string;
  truncated?: boolean;
}) {
  if (!body) return null;
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <pre className="curl mono">{body}</pre>
      {truncated ? <p className="muted-text">Truncated at the configured size limit.</p> : null}
    </section>
  );
}

export function filterRequests(
  entries: RequestEntry[],
  classes: ReadonlySet<string>,
  method: string,
  query: string,
  minMs = 0,
): RequestEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (minMs > 0 && e.durationMs < minMs) return false;
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
  // Live updates carry the newest 100 entries; "full buffer" polls everything held in memory.
  const [full, setFull] = useState(false);
  const fullPoll = usePolledPanel<RequestsData>(
    'requests-full',
    () => getPanel<RequestsData>('/requests?limit=5000'),
    t.intervalMs,
    full,
  );
  const data = full && fullPoll.data ? fullPoll.data : t.requests;
  // Filters live in the URL (`#/requests?status=5xx&min=100`) so a view can be shared.
  const initial = useMemo(() => paramsToFilters(parseHashQuery(window.location.hash)), []);
  const [classes, setClasses] = useState<ReadonlySet<string>>(initial.classes);
  const [method, setMethod] = useState(initial.method);
  const [query, setQuery] = useState(initial.query);
  const [minMs, setMinMs] = useState(initial.minMs);
  const [views, setViews] = useState<SavedView[]>(() => loadViews());
  const [viewName, setViewName] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [selected, setSelected] = useState<RequestEntry | null>(null);

  const methods = useMemo(
    () => [...new Set((data?.entries ?? []).map((e) => e.method))].sort(),
    [data],
  );
  const rows = useMemo(
    () => filterRequests(data?.entries ?? [], classes, method, query, minMs),
    [data, classes, method, query, minMs],
  );

  useEffect(() => {
    replaceHashQuery(filtersToParams({ classes, method, query, minMs }));
  }, [classes, method, query, minMs]);

  const applyFilters = (f: RequestFilters): void => {
    setClasses(f.classes);
    setMethod(f.method);
    setQuery(f.query);
    setMinMs(f.minMs);
  };
  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      setLinkCopied(false);
    }
  };

  const toggleClass = (c: string): void =>
    setClasses((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const sum = data?.summary;
  const filtered = classes.size > 0 || method !== 'all' || query.trim() !== '' || minMs > 0;

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
              caption={
                data
                  ? data.lifetime
                    ? `${data.lifetime.requests.toLocaleString()} since start`
                    : `${data.total} since start`
                  : undefined
              }
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
              <label className="field">
                <span className="sr-only">Minimum duration in milliseconds</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="min ms"
                  aria-label="Minimum duration (ms)"
                  value={minMs > 0 ? minMs : ''}
                  onChange={(e) => setMinMs(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: 96 }}
                />
              </label>
              <label className="field">
                <input
                  type="checkbox"
                  checked={full}
                  onChange={(e) => setFull(e.target.checked)}
                  aria-label="Show full buffer"
                />{' '}
                <span>Full buffer</span>
              </label>
              <span className="muted-text" aria-live="polite">
                {rows.length} of {data?.entries.length ?? 0} shown
                {data && data.total > data.entries.length
                  ? ` · ${data.total - data.entries.length} older in buffer`
                  : ''}
                {data?.capacity && data.lifetime && data.lifetime.requests > data.capacity
                  ? ` · buffer keeps the last ${data.capacity} (raise requestLogSize)`
                  : ''}
              </span>
            </div>
            <div className="toolbar" role="group" aria-label="Saved views">
              <select
                className="input"
                aria-label="Saved views"
                value=""
                onChange={(e) => {
                  const v = views.find((x) => x.name === e.target.value);
                  if (v) applyFilters(paramsToFilters(new URLSearchParams(v.params)));
                }}
              >
                <option value="">
                  {views.length > 0 ? 'Apply saved view…' : 'No saved views'}
                </option>
                {views.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
              <input
                className="input"
                type="text"
                placeholder="Name this view"
                aria-label="View name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                style={{ width: 160 }}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={viewName.trim() === '' || !filtered}
                onClick={() => {
                  setViews((prev) =>
                    saveView(prev, {
                      name: viewName.trim().slice(0, 40),
                      params: filtersToParams({ classes, method, query, minMs }).toString(),
                    }),
                  );
                  setViewName('');
                }}
              >
                Save view
              </button>
              {views.length > 0 ? (
                <select
                  className="input"
                  aria-label="Delete a saved view"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setViews((prev) => deleteView(prev, e.target.value));
                  }}
                >
                  <option value="">Delete view…</option>
                  {views.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <button type="button" className="btn btn-sm" onClick={() => void copyLink()}>
                {linkCopied ? 'Link copied' : 'Copy link'}
              </button>
              {filtered ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => applyFilters(EMPTY_FILTERS)}
                >
                  Clear filters
                </button>
              ) : null}
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

type TimelineItem = WaterfallItem;

/** Outgoing calls and log lines attributed to the request, ordered by time. */
function buildTimeline(
  entry: RequestEntry,
  outgoing: readonly OutgoingRequestEntry[],
  logs: readonly { level: string; message: string; timestamp: number; requestId?: number }[],
  queries: readonly QueryEntry[] = [],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const q of queries) {
    if (q.requestId !== entry.id) continue;
    items.push({
      key: `q${q.id}`,
      at: q.timestampMs,
      durationMs: q.durationMs,
      kind: 'query',
      label: q.sql,
      detail: `${q.system} \u00b7 ${q.error ?? formatDuration(q.durationMs)}${q.nPlusOne ? ' \u00b7 N+1' : ''}`,
      failed: Boolean(q.error),
    });
  }
  for (const o of outgoing) {
    if (o.requestId !== entry.id) continue;
    items.push({
      key: `o${o.id}`,
      at: o.timestampMs,
      durationMs: o.durationMs,
      kind: 'outgoing',
      label: `${o.method} ${o.url}`,
      detail: `${o.error ?? o.status ?? '—'} · ${formatDuration(o.durationMs)}`,
      failed: Boolean(o.error) || (o.status !== null && o.status >= 500),
    });
  }
  logs.forEach((l, i) => {
    if (l.requestId !== entry.id) return;
    items.push({
      key: `l${i}`,
      at: l.timestamp,
      durationMs: 0,
      kind: 'log',
      label: l.message,
      detail: l.level,
      failed: l.level === 'error',
    });
  });
  return items.sort((a, b) => a.at - b.at);
}

function RequestTimeline({ entry }: { entry: RequestEntry }) {
  const t = useTelemetry();
  const [outgoing, setOutgoing] = useState<OutgoingRequestEntry[]>([]);
  const [queries, setQueries] = useState<QueryEntry[]>([]);
  useEffect(() => {
    let live = true;
    getPanel<QueriesData>('/queries')
      .then((d) => {
        if (live) setQueries(d.entries);
      })
      .catch(() => undefined);
    // Fetching also activates the lazy outgoing sampler for later requests.
    getPanel<OutgoingData>('/outgoing')
      .then((d) => {
        if (live) setOutgoing(d.entries);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [entry.id]);
  const items = buildTimeline(entry, outgoing, t.logs?.entries ?? [], queries);
  return (
    <section aria-label="Request timeline">
      <h3>Timeline</h3>
      {items.length === 0 ? (
        <p className="muted-text">
          No outgoing calls, queries or logs were attributed to this request. They are captured only
          while their panels are active.
        </p>
      ) : (
        <Waterfall items={items} startMs={entry.timestampMs} durationMs={entry.durationMs} />
      )}
    </section>
  );
}

function RequestDrawer({ entry, onClose }: { entry: RequestEntry; onClose: () => void }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [replaying, setReplaying] = useState(false);
  const copy = async (build: (e: RequestEntry, origin: string) => string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(build(entry, window.location.origin));
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
        {entry.route ? (
          <div>
            <dt>Route</dt>
            <dd className="mono wrap-anywhere">{entry.route}</dd>
          </div>
        ) : null}
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
        <button type="button" className="btn" onClick={() => void copy(toCurl)}>
          Copy as curl
        </button>
        <button type="button" className="btn" onClick={() => void copy(toFetch)}>
          Copy as fetch
        </button>
        <button type="button" className="btn" onClick={() => void copy(toAutocannon)}>
          Copy as autocannon
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={replaying}
          onClick={() => setReplaying((v) => !v)}
        >
          Replay…
        </button>
        <span className="muted-text" role="status">
          {copied === 'ok'
            ? 'Copied to clipboard'
            : copied === 'fail'
              ? 'Copy failed: clipboard unavailable'
              : ''}
        </span>
      </div>
      {replaying ? <ReplayPanel entry={entry} /> : null}
      <pre className="curl mono">{toCurl(entry, window.location.origin)}</pre>
      {entry.requestBodyTruncated ? (
        <p className="muted-text">Request body was truncated, so it is left out of the curl.</p>
      ) : null}
      <DetailBlock title="Query" data={entry.query} />
      <DetailBlock title="Headers" data={entry.headers} />
      <BodyBlock
        title="Request body"
        body={entry.requestBody}
        truncated={entry.requestBodyTruncated}
      />
      <BodyBlock
        title="Response body"
        body={entry.responseBody}
        truncated={entry.responseBodyTruncated}
      />
      <RequestTimeline entry={entry} />
    </Drawer>
  );
}
