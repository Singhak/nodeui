import { useMemo, useState } from 'react';
import { getPanel } from '../api';
import { useLivePanel } from '../hooks';
import type { EnvData } from '../types';
import { Panel, PanelError, PanelLoading } from './Panel';

export function EnvPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = useLivePanel<EnvData>('env', () => getPanel<EnvData>('/env'), intervalMs);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    if (!data) return { environment: [], config: [], total: 0 };
    const environment = data.environment.filter((e) =>
      e.key.toLowerCase().includes(query.toLowerCase()),
    );
    const config =
      data.config?.filter((e) => e.key.toLowerCase().includes(query.toLowerCase())) ?? [];
    return {
      environment,
      config,
      total: data.environment.length + (data.config?.length ?? 0),
    };
  }, [data, query]);

  return (
    <Panel
      title="Environment"
      exportName="nodeui-env"
      exportJson={data ?? undefined}
      exportCsv={rows.environment}
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
            placeholder="Filter keys…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="muted">{rows.total} entries</p>
          {rows.environment.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>key</th>
                  <th>value</th>
                </tr>
              </thead>
              <tbody>
                {rows.environment.map((e) => (
                  <tr key={`env-${e.key}`}>
                    <td className="mono">{e.key}</td>
                    <td className={`mono${e.value === '[REDACTED]' ? ' redacted' : ''}`}>
                      {e.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {rows.config && rows.config.length > 0 ? (
            <>
              <h3 className="panel-sub">app config</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>key</th>
                    <th>value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.config.map((e) => (
                    <tr key={`cfg-${e.key}`}>
                      <td className="mono">{e.key}</td>
                      <td className={`mono${e.value === '[REDACTED]' ? ' redacted' : ''}`}>
                        {e.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      )}
    </Panel>
  );
}
