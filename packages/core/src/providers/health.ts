import type {
  EventLoopSample,
  HealthData,
  MemoryData,
  NodeUIProvider,
  ProviderContext,
} from '../types';

const LAG_OK_MS = 50;
const LAG_DEGRADED_MS = 200;

type StoredMemory = Partial<MemoryData>;
type StoredEventLoop = Partial<EventLoopSample>;

/** Derives process + event-loop health from the latest sampled values. */
export class HealthProvider implements NodeUIProvider<HealthData> {
  readonly id = 'health' as const;

  get(ctx: ProviderContext): { ok: true; data: HealthData } {
    const loop = ctx.store['event-loop'] as StoredEventLoop | undefined;
    const memory = ctx.store.memory as StoredMemory | undefined;
    const lagMs = typeof loop?.currentMs === 'number' ? loop.currentMs : null;
    const totalMem = typeof memory?.totalMem === 'number' ? memory.totalMem : 0;
    const rss = typeof memory?.rss === 'number' ? memory.rss : 0;
    const memoryUsedPercent = totalMem > 0 ? (rss / totalMem) * 100 : null;

    let status: HealthData['status'];
    let statusReason: string;
    if (lagMs === null) {
      status = 'unknown';
      statusReason = 'no event-loop samples yet (open the Event-loop panel)';
    } else if (lagMs < LAG_OK_MS) {
      status = 'ok';
      statusReason = `event-loop lag ${lagMs.toFixed(1)}ms below ${LAG_OK_MS}ms`;
    } else if (lagMs < LAG_DEGRADED_MS) {
      status = 'degraded';
      statusReason = `event-loop lag ${lagMs.toFixed(1)}ms between ${LAG_OK_MS}ms and ${LAG_DEGRADED_MS}ms`;
    } else {
      status = 'critical';
      statusReason = `event-loop lag ${lagMs.toFixed(1)}ms above ${LAG_DEGRADED_MS}ms`;
    }

    return {
      ok: true,
      data: {
        status,
        statusReason,
        uptimeSeconds: Math.round(process.uptime()),
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        eventLoopLagMs: lagMs,
        memoryUsedPercent,
      },
    };
  }
}
