import {
  appendFile,
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';

export type PersistKind = 'request' | 'outgoing' | 'query' | 'error';

export interface PersistedRecord {
  kind: PersistKind;
  data: unknown;
}

export const DEFAULT_PERSIST_MAX_BYTES = 5 * 1024 * 1024;
const FLUSH_DELAY_MS = 250;

/**
 * Append-only NDJSON journal of recent activity so the console survives a
 * restart. Writes are batched and asynchronous (never on the request path),
 * the file is created private (0600) and rotated to `<file>.1` when it grows
 * past `maxBytes`, so disk use stays under roughly twice that. Failures to
 * read or write are swallowed: persistence is a convenience, never a risk to
 * the host app.
 */
export class Persistence {
  private pending: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private writing = false;

  constructor(
    readonly file: string,
    private readonly maxBytes: number = DEFAULT_PERSIST_MAX_BYTES,
  ) {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch {
      // surfaced as a no-op journal
    }
  }

  append(kind: PersistKind, data: unknown): void {
    try {
      this.pending.push(`${JSON.stringify({ kind, data })}\n`);
    } catch {
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
      if (typeof this.timer.unref === 'function') this.timer.unref();
    }
  }

  /** Reads the journal (rotated file first) in chronological order. */
  load(): PersistedRecord[] {
    const out: PersistedRecord[] = [];
    for (const path of [`${this.file}.1`, this.file]) {
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as PersistedRecord;
          if (parsed && typeof parsed.kind === 'string') out.push(parsed);
        } catch {
          // a torn last line after a crash is expected
        }
      }
    }
    return out;
  }

  private rotateIfNeeded(): void {
    try {
      if (existsSync(this.file) && statSync(this.file).size >= this.maxBytes) {
        renameSync(this.file, `${this.file}.1`);
      }
    } catch {
      // keep appending to the current file
    }
  }

  private flush(): void {
    this.timer = null;
    if (this.writing || this.pending.length === 0) {
      if (this.pending.length > 0) this.timer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
      return;
    }
    this.rotateIfNeeded();
    const chunk = this.pending.join('');
    this.pending = [];
    this.writing = true;
    appendFile(this.file, chunk, { mode: 0o600 }, () => {
      this.writing = false;
    });
  }

  /** Writes anything still buffered, synchronously (used on shutdown). */
  close(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.length === 0) return;
    try {
      this.rotateIfNeeded();
      appendFileSync(this.file, this.pending.join(''), { mode: 0o600 });
    } catch {
      // ignore
    }
    this.pending = [];
  }
}
