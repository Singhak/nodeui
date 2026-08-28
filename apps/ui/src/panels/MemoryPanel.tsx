import { getPanel } from '../api';
import { useMetricSeries, usePolledPanel } from '../hooks';
import type { MemoryData } from '../types';
import { formatBytes } from '../format';
import { Sparkline } from '../Sparkline';
import { Panel, PanelError, PanelLoading } from './Panel';

export function MemoryPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = usePolledPanel<MemoryData>(
    '/memory',
    () => getPanel<MemoryData>('/memory'),
    intervalMs,
  );
  const series = useMetricSeries(
    data,
    (d) => d.heapUsed,
    (d) => d.sampleAtMs,
  );

  return (
    <Panel title="Memory">
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : (
        <div className="memory">
          <dl className="kv">
            <div>
              <dt>heap used</dt>
              <dd>{formatBytes(data.heapUsed)}</dd>
            </div>
            <div>
              <dt>heap total</dt>
              <dd>{formatBytes(data.heapTotal)}</dd>
            </div>
            <div>
              <dt>rss</dt>
              <dd>{formatBytes(data.rss)}</dd>
            </div>
            <div>
              <dt>external</dt>
              <dd>{formatBytes(data.external)}</dd>
            </div>
            <div>
              <dt>system</dt>
              <dd>
                {formatBytes(data.totalMem - data.freeMem)} / {formatBytes(data.totalMem)}
              </dd>
            </div>
          </dl>
          <Sparkline values={series} />
        </div>
      )}
    </Panel>
  );
}
