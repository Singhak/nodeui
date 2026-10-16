import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const SAVE_DELAY_MS = 300;

/**
 * Small JSON file for saved load-test runs, so baselines survive a restart.
 * Writes are debounced, atomic (temp file + rename) and private (0600); read or
 * write failures are swallowed because this is a convenience, never a risk to
 * the host app.
 */
export class RunStore {
  private timer: NodeJS.Timeout | null = null;
  private latest: unknown = null;
  private writing = false;

  constructor(readonly file: string) {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch {
      // surfaced as a no-op store
    }
  }

  load(): unknown {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
    } catch {
      return null;
    }
  }

  save(data: unknown): void {
    this.latest = data;
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.writing) {
      this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
      if (typeof this.timer.unref === 'function') this.timer.unref();
      return;
    }
    this.writing = true;
    try {
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.latest), { mode: 0o600 });
      await rename(tmp, this.file);
    } catch {
      // keep running without persistence
    } finally {
      this.writing = false;
    }
  }

  /** Writes the latest state synchronously (shutdown). */
  close(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      try {
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify(this.latest), { mode: 0o600 });
        renameSync(tmp, this.file);
      } catch {
        // ignore
      }
    }
  }
}
