import { useMemo, useState } from 'react';
import { MethodBadge } from '../components/badges';
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
import { formatClock } from '../format';
import { usePanel } from '../telemetry';
import type {
  EnvData,
  EnvEntry,
  LogEntry,
  LogLevel,
  LogsData,
  RoutesData,
  RouteEntry,
} from '../types';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const LEVEL_ICON: Record<LogLevel, string> = { debug: '·', info: 'i', warn: '▲', error: '✕' };

export function LogsView({ intervalMs }: { intervalMs: number }) {
  const { data, error, refetch } = usePanel<LogsData>('logs', '/logs', intervalMs);
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [query, setQuery] = useState('');

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.entries ?? []).filter(
      (e) =>
        (level === 'all' || e.level === level) && (q === '' || e.message.toLowerCase().includes(q)),
    );
  }, [data, level, query]);

  const columns: Column<LogEntry>[] = [
    {
      key: 'time',
      label: 'Time',
      sortValue: (r) => r.timestamp,
      render: (r) => formatClock(r.timestamp),
      className: 'mono nowrap',
      width: 92,
    },
    {
      key: 'level',
      label: 'Level',
      sortValue: (r) => LEVELS.indexOf(r.level),
      render: (r) => (
        <span className={`tag tag-${r.level}`}>
          <span aria-hidden="true">{LEVEL_ICON[r.level]}</span> {r.level}
        </span>
      ),
      width: 90,
    },
    { key: 'message', label: 'Message', render: (r) => r.message, className: 'mono wrap' },
  ];

  return (
    <>
      <ViewHeader
        title="Logs"
        description="Captured application log output."
        actions={<ExportButtons name="nodeui-logs" json={data ?? undefined} csv={entries} />}
      />
      <Card>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <Skeleton lines={6} label="Loading logs" />
        ) : (
          <>
            <div className="toolbar">
              <div className="chip-row" role="group" aria-label="Log level">
                <Chip active={level === 'all'} onClick={() => setLevel('all')}>
                  all
                </Chip>
                {LEVELS.map((l) => (
                  <Chip key={l} active={level === l} onClick={() => setLevel(l)} tone={l}>
                    {l}
                  </Chip>
                ))}
              </div>
              <input
                className="input grow"
                type="search"
                placeholder="Search messages…"
                aria-label="Search log messages"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="muted-text">{entries.length} entries</span>
            </div>
            {entries.length === 0 ? (
              <EmptyState title="No log entries">
                {data.entries.length === 0
                  ? 'Output from console.* and the logger will be captured here.'
                  : 'No entry matches the current level and search.'}
              </EmptyState>
            ) : (
              <DataTable
                caption="Log entries"
                columns={columns}
                rows={entries}
                rowKey={(r) => `${r.timestamp}-${r.level}-${r.message}`}
                defaultSort={{ key: 'time', dir: 'desc' }}
                maxHeight="calc(100vh - 300px)"
              />
            )}
          </>
        )}
      </Card>
    </>
  );
}

function envColumns(): Column<EnvEntry>[] {
  return [
    {
      key: 'key',
      label: 'Key',
      sortValue: (r) => r.key,
      render: (r) => r.key,
      className: 'mono nowrap',
      width: 240,
    },
    {
      key: 'value',
      label: 'Value',
      sortValue: (r) => r.value,
      render: (r) => (
        <span className={r.value === '[REDACTED]' ? 'redacted' : undefined}>
          {r.value === '[REDACTED]' ? <span aria-hidden="true">🔒 </span> : null}
          {r.value}
        </span>
      ),
      className: 'mono truncate',
      title: (r) => r.value,
    },
  ];
}

export function EnvView({ intervalMs }: { intervalMs: number }) {
  const { data, error, refetch } = usePanel<EnvData>('env', '/env', intervalMs);
  const [query, setQuery] = useState('');
  const columns = useMemo(envColumns, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pick = (list: EnvEntry[] | null | undefined): EnvEntry[] =>
      (list ?? []).filter((e) => e.key.toLowerCase().includes(q));
    return {
      environment: pick(data?.environment),
      config: pick(data?.config),
      total: (data?.environment.length ?? 0) + (data?.config?.length ?? 0),
    };
  }, [data, query]);

  return (
    <>
      <ViewHeader
        title="Environment"
        description="Process environment variables and application config. Secrets are masked."
        actions={
          <ExportButtons name="nodeui-env" json={data ?? undefined} csv={rows.environment} />
        }
      />
      {error && !data ? (
        <Card>
          <ErrorState message={error} onRetry={refetch} />
        </Card>
      ) : !data ? (
        <Card>
          <Skeleton lines={6} label="Loading environment" />
        </Card>
      ) : (
        <>
          <div className="toolbar">
            <input
              className="input grow"
              type="search"
              placeholder="Filter keys…"
              aria-label="Filter keys"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="muted-text">{rows.total} entries</span>
          </div>
          <Card title="Environment variables" subtitle={`${rows.environment.length} shown`}>
            {rows.environment.length > 0 ? (
              <DataTable
                caption="Environment variables"
                columns={columns}
                rows={rows.environment}
                rowKey={(r) => `env-${r.key}`}
                maxHeight="calc(100vh - 360px)"
              />
            ) : (
              <EmptyState title="No variables match">Try a different filter.</EmptyState>
            )}
          </Card>
          {rows.config.length > 0 ? (
            <Card title="App config" subtitle={`${rows.config.length} shown`}>
              <DataTable
                caption="App config"
                columns={columns}
                rows={rows.config}
                rowKey={(r) => `cfg-${r.key}`}
                maxHeight={360}
              />
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}

export function RoutesView({ intervalMs }: { intervalMs: number }) {
  const { data, error, refetch } = usePanel<RoutesData>('routes', '/routes', intervalMs);
  const [query, setQuery] = useState('');

  const routes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.routes ?? []).filter(
      (r) =>
        r.method.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q) ||
        r.handler.toLowerCase().includes(q),
    );
  }, [data, query]);

  const columns: Column<RouteEntry>[] = [
    {
      key: 'method',
      label: 'Method',
      sortValue: (r) => r.method,
      render: (r) => <MethodBadge method={r.method} />,
      width: 90,
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
      key: 'handler',
      label: 'Handler',
      sortValue: (r) => r.handler,
      render: (r) => r.handler,
      className: 'mono truncate',
      title: (r) => r.handler,
    },
  ];

  return (
    <>
      <ViewHeader
        title="Routes"
        description="Routes registered by the framework adapter."
        actions={<ExportButtons name="nodeui-routes" json={data ?? undefined} csv={routes} />}
      />
      <Card>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <Skeleton lines={6} label="Loading routes" />
        ) : (
          <>
            <div className="toolbar">
              <input
                className="input grow"
                type="search"
                placeholder="Filter routes…"
                aria-label="Filter routes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="muted-text">{routes.length} routes</span>
            </div>
            {routes.length === 0 ? (
              <EmptyState title="No routes to show">
                {data.routes.length === 0
                  ? 'The adapter has not reported any routes yet.'
                  : 'No route matches the filter.'}
              </EmptyState>
            ) : (
              <DataTable
                caption="Registered routes"
                columns={columns}
                rows={routes}
                rowKey={(r) => `${r.method} ${r.path}`}
                maxHeight="calc(100vh - 300px)"
              />
            )}
          </>
        )}
      </Card>
    </>
  );
}
