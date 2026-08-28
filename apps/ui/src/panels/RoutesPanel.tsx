import { useMemo, useState } from 'react';
import { getPanel } from '../api';
import { useLivePanel } from '../hooks';
import type { RoutesData } from '../types';
import { Panel, PanelError, PanelLoading } from './Panel';

export function RoutesPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = useLivePanel<RoutesData>(
    'routes',
    () => getPanel<RoutesData>('/routes'),
    intervalMs,
  );
  const [query, setQuery] = useState('');

  const routes = useMemo(() => {
    if (!data) return [];
    const q = query.toLowerCase();
    return data.routes.filter(
      (r) => r.method.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <Panel
      title="Routes"
      exportName="nodeui-routes"
      exportJson={data ?? undefined}
      exportCsv={routes}
    >
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : (
        <>
          <input
            className="filter-input"
            type="search"
            placeholder="Filter routes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="muted">{routes.length} routes</p>
          {routes.length === 0 ? (
            <p className="muted">No routes to show.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>method</th>
                  <th>path</th>
                  <th>handler</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={`${r.method} ${r.path}`}>
                    <td>
                      <span className={`method-badge method-${r.method.toLowerCase()}`}>
                        {r.method}
                      </span>
                    </td>
                    <td className="mono">{r.path}</td>
                    <td className="mono">{r.handler}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Panel>
  );
}
