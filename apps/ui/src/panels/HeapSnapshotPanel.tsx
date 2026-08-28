import { useState } from 'react';
import { issueConfirmation, takeHeapSnapshot } from '../api';
import { formatBytes, formatTime } from '../format';
import type { HeapSnapshotPanelData } from '../types';
import { ConfirmDialog } from '../ConfirmDialog';
import { Panel } from './Panel';

export function HeapSnapshotPanel() {
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
        `Saved ${formatBytes(snapshot.sizeBytes)} snapshot ${snapshot.fileName} at ${formatTime(snapshot.createdAtMs)}`,
      );
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Heap Snapshot">
      <p className="muted">Captures the V8 heap to a .heapsnapshot file on the server.</p>
      {result ? <p className="ok">{result}</p> : null}
      {error ? <p className="panel-error">{error}</p> : null}
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
    </Panel>
  );
}

export function HeapSnapshotList({ data }: { data: HeapSnapshotPanelData | null }) {
  if (!data) return null;
  if (!data.supported) {
    return <p className="muted">Heap snapshots are not supported in this runtime.</p>;
  }
  if (!data.lastSnapshot) {
    return <p className="muted">No snapshots captured yet.</p>;
  }
  return (
    <p className="muted">
      Last: {data.lastSnapshot.fileName} ({formatBytes(data.lastSnapshot.sizeBytes)})
    </p>
  );
}
