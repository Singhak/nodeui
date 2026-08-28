import type { StartupData, StartupMark } from '../types';

/** Records ordered bootstrap timing marks. */
export class StartupTracker {
  private startedAtMs = Date.now();
  private marks: StartupMark[] = [];

  mark(name: string): void {
    const atMs = Date.now();
    this.marks.push({ name, atMs, sinceFirstMs: atMs - this.startedAtMs });
  }

  getData(): StartupData {
    return { startedAtMs: this.startedAtMs, marks: [...this.marks] };
  }

  reset(): void {
    this.startedAtMs = Date.now();
    this.marks = [];
  }
}
