import type { CpuData, NodeUIProvider, ProviderContext } from '../types';
import { Sampler } from './sampler';

export interface CpuUsageSnapshot {
  user: number;
  system: number;
}

/**
 * Injectable clock so CPU delta math is unit-testable. `nowUs` returns the
 * wall clock in microseconds; `cpuUsage` returns cumulative microseconds of
 * user/system CPU time since process start (like `process.cpuUsage()`).
 */
export interface CpuClock {
  nowUs: () => bigint;
  cpuUsage: () => CpuUsageSnapshot;
  /** Test hook: advance to the next scripted step. */
  tick?: () => void;
}

const defaultClock: CpuClock = {
  nowUs: () => process.hrtime.bigint() / 1000n,
  cpuUsage: () => process.cpuUsage(),
};

const ZEROED: CpuData = { userPercent: 0, systemPercent: 0, totalPercent: 0, sampleAtMs: 0 };

interface CpuPoint {
  cpu: CpuUsageSnapshot;
  atUs: bigint;
}

function clampPercent(v: number): number {
  return Math.min(100, Math.max(0, v));
}

/** Computes CPU usage percent via deltas of `process.cpuUsage()`. */
export class CpuProvider implements NodeUIProvider<CpuData> {
  readonly id = 'cpu' as const;

  private sampler: Sampler<CpuData> | null = null;
  private latest: CpuData = ZEROED;
  private last: CpuPoint | null = null;

  constructor(private readonly clock: CpuClock = defaultClock) {}

  /** Runs one sampling step immediately; called by the sampler on each tick. */
  collect(): CpuData {
    const cpu = this.clock.cpuUsage();
    const atUs = this.clock.nowUs();
    let sample: CpuData = { ...ZEROED, sampleAtMs: Date.now() };
    if (this.last) {
      const userUs = cpu.user - this.last.cpu.user;
      const systemUs = cpu.system - this.last.cpu.system;
      const elapsedUs = Number(atUs - this.last.atUs);
      if (elapsedUs > 0) {
        sample = {
          userPercent: clampPercent((userUs / elapsedUs) * 100),
          systemPercent: clampPercent((systemUs / elapsedUs) * 100),
          totalPercent: clampPercent(((userUs + systemUs) / elapsedUs) * 100),
          sampleAtMs: Date.now(),
        };
      }
    }
    this.last = { cpu, atUs };
    this.latest = sample;
    return sample;
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

  get(): { ok: true; data: CpuData } {
    return { ok: true, data: this.latest };
  }
}
