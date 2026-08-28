import { mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeHeapSnapshot } from 'node:v8';
import type {
  HeapSnapshotData,
  HeapSnapshotPanelData,
  NodeUIProvider,
  ProviderContext,
  ProviderResult,
} from '../types';

function defaultSnapshotDir(): string {
  return process.env.NODEUI_HEAP_SNAPSHOT_DIR ?? tmpdir();
}

/**
 * Heap snapshots via `v8.writeHeapSnapshot`. The panel is read-only; the
 * actual file write happens only through `takeSnapshot`, which the server
 * gates behind a confirmation nonce.
 */
export class HeapSnapshotProvider implements NodeUIProvider<HeapSnapshotPanelData> {
  readonly id = 'heap-snapshot' as const;

  private lastSnapshot: HeapSnapshotData | null = null;

  get(): { ok: true; data: HeapSnapshotPanelData } {
    return { ok: true, data: { supported: true, lastSnapshot: this.lastSnapshot } };
  }

  async takeSnapshot(ctx: ProviderContext): Promise<ProviderResult<HeapSnapshotData>> {
    const dir = ctx.config.heapSnapshotDir || defaultSnapshotDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `nodeui-heap-${process.pid}-${stamp}.heapsnapshot`;
    const filePath = join(dir, fileName);
    try {
      await mkdir(dir, { recursive: true });
      writeHeapSnapshot(filePath);
      const fileStat = await stat(filePath);
      const data: HeapSnapshotData = {
        fileName,
        filePath,
        sizeBytes: fileStat.size,
        createdAtMs: Date.now(),
      };
      this.lastSnapshot = data;
      return { ok: true, data };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'heap-snapshot-failed',
          message: err instanceof Error ? err.message : 'heap snapshot failed',
        },
      };
    }
  }
}
