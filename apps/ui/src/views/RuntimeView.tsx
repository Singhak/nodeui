import { useState } from 'react';
import { issueConfirmation, takeHeapSnapshot } from '../api';
import { LineChart } from '../charts/LineChart';
import { Card, EmptyState, ErrorState, Skeleton, ViewHeader } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { ConfirmDialog } from '../ConfirmDialog';
import { formatBytes, formatClock } from '../format';
import { useTelemetry, usePanel } from '../telemetry';
import type { StartupData, StartupMark } from '../types';

const MB = 1024 * 1024;

function Kv({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function HeapSnapshotCard() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const confirmation = await issueConfirmation();
      const snapshot = await takeHeapSnapshot(confirmation.nonce);
      setResult(
        `Saved ${formatBytes(snapshot.sizeBytes)} snapshot ${snapshot.fileName} at ${formatClock(snapshot.createdAtMs)}`,
      );
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Heap snapshot"
      subtitle="Captures the V8 heap to a .heapsnapshot file on the server."
    >
      {result ? <p className="ok-text">✓ {result}</p> : null}
      {error ? <ErrorState message={error} /> : null}
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Capture heap snapshot
      </button>
      <ConfirmDialog
        open={open}
        title="Capture heap snapshot"
        message="This action writes a heap snapshot file to disk. Continue?"
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() => void handleConfirm()}
      />
    </Card>
  );
}

function StartupCard({ intervalMs }: { intervalMs: number }) {
  const { data, error, refetch } = usePanel<StartupData>('startup', '/startup', intervalMs);
  const max = Math.max(1, ...(data?.marks ?? []).map((m) => m.sinceFirstMs));
  const columns: Column<StartupMark>[] = [
    {
      key: 'name',
      label: 'Mark',
      sortValue: (m) => m.name,
      render: (m) => m.name,
      className: 'nowrap',
    },
    {
      key: 'since',
      label: 'Since start',
      align: 'right',
      sortValue: (m) => m.sinceFirstMs,
      render: (m) => `${m.sinceFirstMs.toFixed(1)} ms`,
      className: 'mono nowrap',
      width: 110,
    },
    {
      key: 'bar',
      label: 'Timeline',
      render: (m) => (
        <span className="timeline" aria-hidden="true">
          <span
            className="timeline-bar"
            style={{ width: `${Math.max(2, (m.sinceFirstMs / max) * 100)}%` }}
          />
        </span>
      ),
      width: 180,
    },
    {
      key: 'time',
      label: 'Time',
      sortValue: (m) => m.atMs,
      render: (m) => formatClock(m.atMs),
      className: 'mono nowrap',
      width: 92,
    },
  ];
  return (
    <Card title="Startup timeline">
      {error && !data ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : !data ? (
        <Skeleton lines={3} />
      ) : data.marks.length === 0 ? (
        <EmptyState title="No startup marks recorded yet">
          Call the nodeui mark API during boot to see where startup time goes.
        </EmptyState>
      ) : (
        <DataTable
          caption="Startup marks"
          columns={columns}
          rows={data.marks}
          rowKey={(m) => m.name}
          defaultSort={{ key: 'since', dir: 'asc' }}
        />
      )}
    </Card>
  );
}

export function RuntimeView({
  intervalMs,
  heapSnapshot,
  startup,
}: {
  intervalMs: number;
  heapSnapshot: boolean;
  startup: boolean;
}) {
  const t = useTelemetry();
  const { memory, cpu, loop, history } = t;
  return (
    <>
      <ViewHeader
        title="Runtime"
        description="Memory, CPU and event-loop behaviour of the Node.js process."
      />
      <div className="runtime-grid">
        <Card title="Memory">
          {t.errors.memory && !memory ? (
            <ErrorState message={t.errors.memory} onRetry={t.retry} />
          ) : (
            <>
              {memory ? (
                <Kv
                  rows={[
                    ['heap used', formatBytes(memory.heapUsed)],
                    ['heap total', formatBytes(memory.heapTotal)],
                    ['rss', formatBytes(memory.rss)],
                    ['external', formatBytes(memory.external)],
                    [
                      'system',
                      `${formatBytes(memory.totalMem - memory.freeMem)} / ${formatBytes(memory.totalMem)}`,
                    ],
                  ]}
                />
              ) : (
                <Skeleton lines={3} />
              )}
              <LineChart
                title="Memory"
                unit="MB"
                height={180}
                format={(v) => `${v.toFixed(1)} MB`}
                tickFormat={(v) => String(Math.round(v * 10) / 10)}
                series={[
                  {
                    id: 'heap',
                    name: 'Heap used',
                    color: 'var(--series-1)',
                    area: true,
                    points: history.heap.map((p) => ({ t: p.t, v: p.v / MB })),
                  },
                  {
                    id: 'rss',
                    name: 'RSS',
                    color: 'var(--series-2)',
                    dash: '5 4',
                    points: history.rss.map((p) => ({ t: p.t, v: p.v / MB })),
                  },
                ]}
              />
            </>
          )}
        </Card>
        <Card title="CPU">
          {t.errors.cpu && !cpu ? (
            <ErrorState message={t.errors.cpu} onRetry={t.retry} />
          ) : (
            <>
              {cpu ? (
                <Kv
                  rows={[
                    ['total', `${cpu.totalPercent.toFixed(1)} %`],
                    ['user', `${cpu.userPercent.toFixed(1)} %`],
                    ['system', `${cpu.systemPercent.toFixed(1)} %`],
                  ]}
                />
              ) : (
                <Skeleton lines={2} />
              )}
              <LineChart
                title="CPU"
                unit="%"
                height={180}
                yMax={10}
                format={(v) => `${v.toFixed(1)} %`}
                series={[
                  {
                    id: 'cpu',
                    name: 'CPU',
                    color: 'var(--series-1)',
                    area: true,
                    points: history.cpu,
                  },
                ]}
              />
            </>
          )}
        </Card>
        <Card title="Event-loop lag">
          {t.errors['event-loop'] && !loop ? (
            <ErrorState message={t.errors['event-loop']} onRetry={t.retry} />
          ) : (
            <>
              {loop ? (
                <Kv
                  rows={[
                    ['current', `${loop.currentMs.toFixed(1)} ms`],
                    ['max', `${loop.maxMs.toFixed(1)} ms`],
                    ['avg', `${loop.avgMs.toFixed(1)} ms`],
                    ['samples', String(loop.count)],
                  ]}
                />
              ) : (
                <Skeleton lines={2} />
              )}
              <LineChart
                title="Event-loop lag"
                unit="ms"
                height={180}
                yMax={5}
                format={(v) => `${v.toFixed(2)} ms`}
                series={[
                  {
                    id: 'loop',
                    name: 'Lag',
                    color: 'var(--series-1)',
                    area: true,
                    points: history.loop,
                  },
                ]}
              />
            </>
          )}
        </Card>
        {heapSnapshot ? <HeapSnapshotCard /> : null}
        {startup ? <StartupCard intervalMs={intervalMs} /> : null}
      </div>
    </>
  );
}
