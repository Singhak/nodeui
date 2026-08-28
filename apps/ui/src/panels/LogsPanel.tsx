import { useMemo, useState } from 'react';
import { getPanel } from '../api';
import { useLivePanel } from '../hooks';
import type { LogLevel, LogsData } from '../types';
import { formatTime } from '../format';
import { Panel, PanelError, PanelLoading } from './Panel';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export function LogsPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = useLivePanel<LogsData>(
    'logs',
    () => getPanel<LogsData>('/logs'),
    intervalMs,
  );
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [query, setQuery] = useState('');

  const entries = useMemo(() => {
    if (!data) return [];
    const q = query.toLowerCase();
    return data.entries.filter(
      (e) =>
        (level === 'all' || e.level === level) && (q === '' || e.message.toLowerCase().includes(q)),
    );
  }, [data, level, query]);

  return (
    <Panel title="Logs" exportName="nodeui-logs" exportJson={data ?? undefined} exportCsv={entries}>
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : (
        <>
          <div className="log-toolbar">
            <div className="log-levels">
              <button
                type="button"
                className={`chip${level === 'all' ? ' chip-active' : ''}`}
                onClick={() => setLevel('all')}
              >
                all
              </button>
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`chip chip-${l}${level === l ? ' chip-active' : ''}`}
                  onClick={() => setLevel(l)}
                >
                  {l}
                </button>
              ))}
            </div>
            <input
              className="filter-input"
              type="search"
              placeholder="Search messages…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {entries.length === 0 ? (
            <p className="muted">No log entries.</p>
          ) : (
            <ul className="log-list">
              {entries.map((e, i) => (
                <li key={`${e.timestamp}-${i}`} className={`log-line log-${e.level}`}>
                  <span className="log-level">{e.level}</span>
                  <span className="log-time mono">{formatTime(e.timestamp)}</span>
                  <span className="log-message">{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
