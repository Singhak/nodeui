import { getPanel } from '../api';
import { usePolledPanel } from '../hooks';
import type { HealthData } from '../types';
import { formatSeconds } from '../format';
import { Panel, PanelError, PanelLoading } from './Panel';

export function HealthPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = usePolledPanel<HealthData>(
    '/health',
    () => getPanel<HealthData>('/health'),
    intervalMs,
  );

  return (
    <Panel title="Health">
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : (
        <div className="health">
          <span className={`status-pill status-${data.status}`}>{data.status}</span>
          <p className="muted">{data.statusReason}</p>
          <dl className="kv">
            <div>
              <dt>uptime</dt>
              <dd>{formatSeconds(data.uptimeSeconds)}</dd>
            </div>
            <div>
              <dt>pid</dt>
              <dd>{data.pid}</dd>
            </div>
            <div>
              <dt>node</dt>
              <dd>{data.nodeVersion}</dd>
            </div>
            <div>
              <dt>platform</dt>
              <dd>{data.platform}</dd>
            </div>
            <div>
              <dt>event-loop lag</dt>
              <dd>{data.eventLoopLagMs === null ? '—' : `${data.eventLoopLagMs.toFixed(1)} ms`}</dd>
            </div>
            <div>
              <dt>memory used</dt>
              <dd>
                {data.memoryUsedPercent === null ? '—' : `${data.memoryUsedPercent.toFixed(1)} %`}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Panel>
  );
}
