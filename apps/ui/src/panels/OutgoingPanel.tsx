import { useMemo, useState } from 'react';
import { getPanel } from '../api';
import { useLivePanel } from '../hooks';
import type { OutgoingData, OutgoingRequestEntry } from '../types';
import { formatDuration, formatTime } from '../format';
import { Panel, PanelError, PanelLoading } from './Panel';

export function isFailedCall(entry: OutgoingRequestEntry): boolean {
  return Boolean(entry.error) || (entry.status !== null && entry.status >= 500);
}

export function OutgoingPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = useLivePanel<OutgoingData>(
    'outgoing',
    () => getPanel<OutgoingData>('/outgoing'),
    intervalMs,
  );
  const [failedOnly, setFailedOnly] = useState(false);
  const [query, setQuery] = useState('');

  const entries = useMemo(() => {
    if (!data) return [];
    const q = query.toLowerCase();
    return data.entries.filter(
      (e) =>
        (!failedOnly || isFailedCall(e)) &&
        (q === '' || `${e.method} ${e.url} ${e.error ?? ''}`.toLowerCase().includes(q)),
    );
  }, [data, failedOnly, query]);

  const slowest = useMemo(() => {
    let best: OutgoingRequestEntry | undefined;
    for (const e of data?.entries ?? []) {
      if (!best || e.durationMs > best.durationMs) best = e;
    }
    return best;
  }, [data]);

  return (
    <Panel
      title="Outgoing Calls"
      exportName="nodeui-outgoing"
      exportJson={data ?? undefined}
      exportCsv={entries}
    >
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : (
        <>
          <p className="muted">
            {data.total} total · {data.failed} failed
            {slowest ? ` · slowest ${formatDuration(slowest.durationMs)}` : ''}
          </p>
          <div className="log-toolbar">
            <div className="log-levels">
              <button
                type="button"
                className={`chip${failedOnly ? ' chip-active' : ''}`}
                onClick={() => setFailedOnly((v) => !v)}
              >
                failed only
              </button>
            </div>
            <input
              className="filter-input"
              type="search"
              placeholder="Filter by method or url…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {entries.length === 0 ? (
            <p className="muted">No outgoing calls observed yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>method</th>
                  <th>url</th>
                  <th>status</th>
                  <th>duration</th>
                  <th>time</th>
                  <th>error</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isSlowest = entry.id === slowest?.id;
                  const classes = [
                    isFailedCall(entry) ? 'row-failed' : '',
                    isSlowest ? 'row-slowest' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <tr key={entry.id} className={classes || undefined}>
                      <td className="mono">{entry.method}</td>
                      <td className="mono">{entry.url}</td>
                      <td>
                        {entry.status === null ? (
                          '—'
                        ) : (
                          <span
                            className={`status-code status-code-${Math.floor(entry.status / 100)}`}
                          >
                            {entry.status}
                          </span>
                        )}
                      </td>
                      <td className="mono">
                        {formatDuration(entry.durationMs)}
                        {isSlowest ? <span className="badge-slowest">slowest</span> : null}
                      </td>
                      <td className="mono">{formatTime(entry.timestampMs)}</td>
                      <td className="mono">{entry.error ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </Panel>
  );
}
