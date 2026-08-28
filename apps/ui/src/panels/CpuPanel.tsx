import { getPanel } from '../api';
import { useMetricSeries, usePolledPanel } from '../hooks';
import type { CpuData } from '../types';
import { Sparkline } from '../Sparkline';
import { Panel, PanelError, PanelLoading } from './Panel';

export function CpuPanel({ intervalMs }: { intervalMs: number }) {
  const { data, error } = usePolledPanel<CpuData>(
    '/cpu',
    () => getPanel<CpuData>('/cpu'),
    intervalMs,
  );
  const series = useMetricSeries(
    data,
    (d) => d.totalPercent,
    (d) => d.sampleAtMs,
  );

  return (
    <Panel title="CPU">
      {error ? (
        <PanelError message={error} />
      ) : !data ? (
        <PanelLoading />
      ) : (
        <div className="cpu">
          <dl className="kv">
            <div>
              <dt>total</dt>
              <dd>{data.totalPercent.toFixed(1)} %</dd>
            </div>
            <div>
              <dt>user</dt>
              <dd>{data.userPercent.toFixed(1)} %</dd>
            </div>
            <div>
              <dt>system</dt>
              <dd>{data.systemPercent.toFixed(1)} %</dd>
            </div>
          </dl>
          <Sparkline values={series} stroke="#fbbf24" />
        </div>
      )}
    </Panel>
  );
}
