import type { EventLoopSample, NodeUIProvider, ProviderContext } from '../types';
import { Sampler } from './sampler';

export interface EventLoopClock {
  /** Current time in nanoseconds. */
  nowNs: () => bigint;
}

const defaultClock: EventLoopClock = {
  nowNs: () => process.hrtime.bigint(),
};

const MAX_KEPT_SAMPLES = 600;

const ZEROED: EventLoopSample = {
  currentMs: 0,
  maxMs: 0,
  avgMs: 0,
  count: 0,
  sampleAtMs: 0,
};

/**
 * Measures event-loop lag from a background timer: each tick reports how far
 * behind the nominal interval the loop actually was. Keeps a rolling window
 * of samples so the panel can show current/max/average lag.
 */
export class EventLoopLagProvider implements NodeUIProvider<EventLoopSample> {
  readonly id = 'event-loop' as const;

  private sampler: Sampler<EventLoopSample> | null = null;
  private samples: number[] = [];
  private latest: EventLoopSample = ZEROED;
  private lastFireNs: bigint | null = null;

  constructor(private readonly clock: EventLoopClock = defaultClock) {}

  /** Runs one measurement tick; called by the sampler on each interval. */
  collect(intervalMs: number): EventLoopSample {
    const nowNs = this.clock.nowNs();
    let lagMs = 0;
    if (this.lastFireNs !== null) {
      const elapsedMs = Number(nowNs - this.lastFireNs) / 1e6;
      lagMs = Math.max(0, elapsedMs - intervalMs);
    }
    this.lastFireNs = nowNs;

    this.samples.push(lagMs);
    if (this.samples.length > MAX_KEPT_SAMPLES) this.samples.shift();

    const count = this.samples.length;
    const total = this.samples.reduce((acc, v) => acc + v, 0);
    const sample: EventLoopSample = {
      currentMs: lagMs,
      maxMs: Math.max(...this.samples),
      avgMs: count > 0 ? total / count : 0,
      count,
      sampleAtMs: Date.now(),
    };
    this.latest = sample;
    return sample;
  }

  start(ctx: ProviderContext): void {
    if (this.sampler) return;
    this.lastFireNs = this.clock.nowNs();
    this.sampler = new Sampler({
      intervalMs: ctx.config.pollIntervalMs,
      collect: () => this.collect(ctx.config.pollIntervalMs),
      onSample: (sample) => {
        this.latest = sample;
        ctx.store[this.id] = sample;
      },
    });
    this.sampler.start();
  }

  stop(): void {
    this.sampler?.stop();
    this.sampler = null;
  }

  get(): { ok: true; data: EventLoopSample } {
    return { ok: true, data: this.latest };
  }
}
