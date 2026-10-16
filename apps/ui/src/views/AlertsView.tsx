import { useState, type ReactNode } from 'react';
import { addAlert, getPanel, removeAlert } from '../api';
import { Card, EmptyState, ErrorState, Skeleton, ViewHeader } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { formatClock } from '../format';
import { usePolledPanel } from '../hooks';
import type { AlertEvent, AlertMetric, AlertRuleView, AlertsData } from '../types';

const PRESETS: Array<{ label: string; metric: AlertMetric; op: '>' | '<'; threshold: number }> = [
  { label: 'p99 > 500 ms', metric: 'p99', op: '>', threshold: 500 },
  { label: '5xx rate > 1%', metric: 'errorRate', op: '>', threshold: 1 },
  { label: 'Event loop p99 > 100 ms', metric: 'loopP99', op: '>', threshold: 100 },
  { label: 'Heap > 512 MB', metric: 'heapMb', op: '>', threshold: 512 },
];

export function describeRule(
  r: Pick<AlertRuleView, 'metric' | 'op' | 'threshold' | 'forSeconds' | 'windowSeconds'>,
  metrics: AlertsData['metrics'],
): string {
  const m = metrics.find((x) => x.id === r.metric);
  const hold = r.forSeconds > 0 ? ` for ${r.forSeconds}s` : '';
  return `${m?.label ?? r.metric} ${r.op} ${r.threshold} ${m?.unit ?? ''}${hold} (over ${r.windowSeconds}s)`;
}

function StateBadge({ state }: { state: AlertRuleView['state'] }) {
  if (state === 'firing') {
    return (
      <span className="status-pill status-critical">
        <span aria-hidden="true">✕</span> Firing
      </span>
    );
  }
  if (state === 'pending') {
    return (
      <span className="status-pill status-degraded">
        <span aria-hidden="true">▲</span> Pending
      </span>
    );
  }
  return (
    <span className="status-pill status-ok">
      <span aria-hidden="true">✓</span> OK
    </span>
  );
}

export function AlertsView({ intervalMs }: { intervalMs: number }) {
  const poll = usePolledPanel<AlertsData>(
    'alerts',
    () => getPanel<AlertsData>('/alerts'),
    Math.min(intervalMs, 2000),
  );
  const data = poll.data;
  const [metric, setMetric] = useState<AlertMetric>('p99');
  const [op, setOp] = useState<'>' | '<'>('>');
  const [threshold, setThreshold] = useState('300');
  const [forSeconds, setForSeconds] = useState('5');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      poll.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const add = (): Promise<void> =>
    act(async () => {
      await addAlert({
        metric,
        op,
        threshold: Number(threshold),
        forSeconds: Number(forSeconds),
        name: name.trim() || undefined,
      });
      setName('');
    });

  const metrics = data?.metrics ?? [];
  const unit = metrics.find((m) => m.id === metric)?.unit ?? '';

  const columns: Column<AlertRuleView>[] = [
    {
      key: 'state',
      label: 'State',
      sortValue: (r) => (r.state === 'firing' ? 0 : r.state === 'pending' ? 1 : 2),
      render: (r) => <StateBadge state={r.state} />,
      width: 120,
    },
    { key: 'name', label: 'Rule', sortValue: (r) => r.name, render: (r) => r.name },
    {
      key: 'cond',
      label: 'Condition',
      render: (r) => describeRule(r, metrics),
      className: 'muted-text',
    },
    {
      key: 'value',
      label: 'Now',
      sortValue: (r) => r.value ?? -1,
      render: (r) =>
        r.value === null ? (
          <span className="muted-text" title="Needs a few requests in the window">
            no data
          </span>
        ) : (
          `${r.value} ${metrics.find((m) => m.id === r.metric)?.unit ?? ''}`
        ),
      align: 'right',
      width: 120,
    },
    {
      key: 'actions',
      label: '',
      render: (r) =>
        r.source === 'ui' ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            aria-label={`Remove ${r.name}`}
            onClick={() => void act(() => removeAlert(r.id))}
          >
            Remove
          </button>
        ) : (
          <span className="muted-text" title="Defined in the nodeui options">
            config
          </span>
        ),
      width: 90,
    },
  ];

  let body: ReactNode;
  if (poll.error && !data) {
    body = (
      <Card>
        <ErrorState message={poll.error} onRetry={poll.refetch} />
      </Card>
    );
  } else if (!data) {
    body = <Skeleton lines={5} label="Loading alerts" />;
  } else {
    body = (
      <>
        <Card
          title="Rules"
          subtitle="Evaluated every second against a short look-back window. Idle apps never trigger latency or error rules."
        >
          {data.rules.length === 0 ? (
            <EmptyState title="No alert rules yet">
              Add one below, or define them in code with the <code>alerts</code> option.
            </EmptyState>
          ) : (
            <DataTable
              caption="Alert rules"
              columns={columns}
              rows={data.rules}
              rowKey={(r) => r.id}
              defaultSort={{ key: 'state', dir: 'asc' }}
            />
          )}
        </Card>
        <Card title="Add a rule" subtitle="Rules added here last until the app restarts.">
          <div className="chip-row" role="group" aria-label="Presets">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="chip"
                onClick={() => {
                  setMetric(p.metric);
                  setOp(p.op);
                  setThreshold(String(p.threshold));
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="toolbar">
            <select
              className="input"
              aria-label="Metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value as AlertMetric)}
            >
              {metrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Operator"
              value={op}
              onChange={(e) => setOp(e.target.value as '>' | '<')}
            >
              <option value=">">above</option>
              <option value="<">below</option>
            </select>
            <input
              className="input"
              type="number"
              aria-label="Threshold"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              style={{ width: 100 }}
            />
            <span className="muted-text">{unit}</span>
            <label className="check">
              for
              <input
                className="input"
                type="number"
                min={0}
                aria-label="Hold for seconds"
                value={forSeconds}
                onChange={(e) => setForSeconds(e.target.value)}
                style={{ width: 70 }}
              />
              s
            </label>
            <input
              className="input grow"
              type="text"
              placeholder="Name (optional)"
              aria-label="Rule name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || threshold.trim() === ''}
              onClick={() => void add()}
            >
              Add rule
            </button>
          </div>
          {error ? <ErrorState message={error} /> : null}
        </Card>
        <Card title="History" subtitle="Recent fired and resolved alerts, newest first.">
          {data.events.length === 0 ? (
            <p className="muted-text">Nothing has fired yet.</p>
          ) : (
            <ul className="alert-history" aria-label="Alert history">
              {data.events.map((e: AlertEvent, i) => (
                <li
                  key={`${e.atMs}-${e.ruleId}-${i}`}
                  className={e.type === 'fired' ? 'row-failed' : ''}
                >
                  <span className="mono">{formatClock(e.atMs)}</span>{' '}
                  <strong>{e.type === 'fired' ? 'Fired' : 'Resolved'}</strong> {e.name}{' '}
                  <span className="muted-text">
                    (value {e.value}, limit {e.threshold})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>
    );
  }

  return (
    <>
      <ViewHeader
        title="Alerts"
        description="Get told when latency, errors or resources cross a budget while you develop."
      />
      {body}
    </>
  );
}
