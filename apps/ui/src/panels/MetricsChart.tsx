import { useLivePanel } from '../hooks';
import { getPanel } from '../api';
import type { MetricsData } from '../types';

export function MetricsChart({ intervalMs }: { intervalMs: number }) {
  const { data } = useLivePanel<MetricsData>(
    'metrics',
    () => getPanel<MetricsData>('/metrics'),
    intervalMs,
  );
  if (!data) return null;
  const max = Math.max(1, ...data.buckets.map((b) => Math.max(b.requests, b.errors)));
  return (
    <div className="metrics-chart">
      <div className="metrics-bars">
        {data.buckets.map((b) => (
          <div
            key={b.ts}
            className="metrics-bar-wrap"
            title={`${b.requests} req / ${b.errors} err`}
          >
            <div
              className="metrics-bar metrics-bar-errors"
              style={{ height: `${(b.errors / max) * 100}%` }}
            />
            <div
              className="metrics-bar metrics-bar-requests"
              style={{ height: `${(b.requests / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="metrics-legend">
        <span className="muted">rps · last 60s · max {max}</span>
      </div>
    </div>
  );
}
