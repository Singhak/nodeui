import { getPanel } from '../api';
import { usePolledPanel } from '../hooks';
import type { StartupData } from '../types';
import { formatTime } from '../format';
import { Panel, PanelError, PanelLoading } from './Panel';

export function StartupPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = usePolledPanel<StartupData>(
    '/startup',
    () => getPanel<StartupData>('/startup'),
    intervalMs,
  );

  return (
    <Panel title="Startup Timeline">
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : data.marks.length === 0 ? (
        <p className="muted">No startup marks recorded yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>mark</th>
              <th>since start</th>
              <th>time</th>
            </tr>
          </thead>
          <tbody>
            {data.marks.map((mark) => (
              <tr key={mark.name}>
                <td>{mark.name}</td>
                <td>{mark.sinceFirstMs.toFixed(1)} ms</td>
                <td>{formatTime(mark.atMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
