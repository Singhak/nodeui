import { freemem, totalmem } from 'node:os';
import type { MemoryData, NodeUIProvider, ProviderContext } from '../types';
import { Sampler } from './sampler';

const ZEROED: MemoryData = {
  heapUsed: 0,
  heapTotal: 0,
  rss: 0,
  external: 0,
  totalMem: 0,
  freeMem: 0,
  sampleAtMs: 0,
};

/** Samples `process.memoryUsage()` plus OS totals on the poll interval. */
export class MemoryProvider implements NodeUIProvider<MemoryData> {
  readonly id = 'memory' as const;

  private sampler: Sampler<MemoryData> | null = null;
  private latest: MemoryData = ZEROED;

  private collect(): MemoryData {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
      external: usage.external,
      totalMem: totalmem(),
      freeMem: freemem(),
      sampleAtMs: Date.now(),
    };
  }

  start(ctx: ProviderContext): void {
    if (this.sampler) return;
    this.sampler = new Sampler({
      intervalMs: ctx.config.pollIntervalMs,
      collect: () => this.collect(),
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

  get(): { ok: true; data: MemoryData } {
    return { ok: true, data: this.latest };
  }
}
