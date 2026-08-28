export interface SamplerOptions<T> {
  intervalMs: number;
  collect: () => T;
  onSample: (sample: T) => void;
}

/**
 * Wraps a tracked `setInterval`. Idempotent `start`, guaranteed `stop`,
 * and a `collect` that never throws into the event loop. All timers are
 * cleared on `stop` — no leaks on hot reload.
 */
export class Sampler<T> {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: SamplerOptions<T>) {}

  start(): void {
    if (this.timer) return;
    const run = (): void => {
      try {
        this.opts.onSample(this.opts.collect());
      } catch {
        // sampling must never throw into the event loop
      }
    };
    this.timer = setInterval(run, this.opts.intervalMs);
    run();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }
}
