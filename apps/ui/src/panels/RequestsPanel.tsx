import { getPanel } from '../api';
import { useLivePanel } from '../hooks';
import type { RequestsData } from '../types';
import { formatDuration, formatTime } from '../format';
import { Panel, PanelError, PanelLoading } from './Panel';
import { MetricsChart } from './MetricsChart';

export function RequestsPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = useLivePanel<RequestsData>(
    'requests',
    () => getPanel<RequestsData>('/requests'),
    intervalMs,
  );

  return (
    <Panel
      title="Requests"
      exportName="nodeui-requests"
      exportJson={data ?? undefined}
      exportCsv={data?.entries ?? []}
    >
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : (
        <>
          <MetricsChart intervalMs={intervalMs} />
          <p className="muted">
            {data.total} total · showing last {data.entries.length}
          </p>
          {data.entries.length === 0 ? (
            <p className="muted">No requests observed yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>method</th>
                  <th>path</th>
                  <th>status</th>
                  <th>duration</th>
                  <th>time</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="mono">{entry.method}</td>
                    <td className="mono">{entry.path}</td>
                    <td>
                      <span className={`status-code status-code-${Math.floor(entry.status / 100)}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="mono">{formatDuration(entry.durationMs)}</td>
                    <td className="mono">{formatTime(entry.timestampMs)}</td>
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
