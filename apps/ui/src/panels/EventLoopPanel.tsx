import { getPanel } from '../api';
import { useMetricSeries, usePolledPanel } from '../hooks';
import type { EventLoopData } from '../types';
import { Sparkline } from '../Sparkline';
import { Panel, PanelError, PanelLoading } from './Panel';

export function EventLoopPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = usePolledPanel<EventLoopData>(
    '/event-loop',
    () => getPanel<EventLoopData>('/event-loop'),
    intervalMs,
  );
  const series = useMetricSeries(
    data,
    (d) => d.currentMs,
    (d) => d.sampleAtMs,
  );

  return (
    <Panel title="Event Loop Lag">
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : (
        <div className="event-loop">
          <dl className="kv">
            <div>
              <dt>current</dt>
              <dd>{data.currentMs.toFixed(1)} ms</dd>
            </div>
            <div>
              <dt>max</dt>
              <dd>{data.maxMs.toFixed(1)} ms</dd>
            </div>
            <div>
              <dt>avg</dt>
              <dd>{data.avgMs.toFixed(1)} ms</dd>
            </div>
            <div>
              <dt>samples</dt>
              <dd>{data.count}</dd>
            </div>
          </dl>
          <Sparkline values={series} stroke="#f87171" />
        </div>
      )}
    </Panel>
  );
}
