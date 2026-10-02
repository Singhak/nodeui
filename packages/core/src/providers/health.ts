import type {
  EventLoopSample,
  HealthCheckResult,
  HealthData,
  MemoryData,
  NodeUIProvider,
  ProviderContext,
} from '../types';

const LAG_OK_MS = 50;
const LAG_DEGRADED_MS = 200;
const CHECK_TIMEOUT_MS = 3000;
const CHECK_CACHE_MS = 5000;

type StoredMemory = Partial<MemoryData>;
type StoredEventLoop = Partial<EventLoopSample>;

/**
 * A dependency check (database ping, cache ping, ...). Resolve for healthy,
 * reject/throw (or resolve `false`) for unhealthy.
 */
export type HealthCheck = () => unknown | Promise<unknown>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** Derives process + event-loop health, plus optional dependency checks. */
export class HealthProvider implements NodeUIProvider<HealthData> {
  readonly id = 'health' as const;

  private cache: { at: number; results: HealthCheckResult[] } | null = null;

  constructor(private readonly checks: Record<string, HealthCheck> = {}) {}

  private async runChecks(): Promise<HealthCheckResult[]> {
    const names = Object.keys(this.checks);
    if (names.length === 0) return [];
    if (this.cache && Date.now() - this.cache.at < CHECK_CACHE_MS) return this.cache.results;
    const results = await Promise.all(
      names.map(async (name): Promise<HealthCheckResult> => {
        const started = Date.now();
        try {
          const outcome = await withTimeout(
            Promise.resolve().then(() => this.checks[name]!()),
            CHECK_TIMEOUT_MS,
          );
          if (outcome === false) throw new Error('check returned false');
          return { name, status: 'up', durationMs: Date.now() - started };
        } catch (err) {
          return {
            name,
            status: 'down',
            durationMs: Date.now() - started,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    this.cache = { at: Date.now(), results };
    return results;
  }

  async get(ctx: ProviderContext): Promise<{ ok: true; data: HealthData }> {
    const loop = ctx.store['event-loop'] as StoredEventLoop | undefined;
    const memory = ctx.store.memory as StoredMemory | undefined;
    const lagMs = typeof loop?.currentMs === 'number' ? loop.currentMs : null;
    const totalMem = typeof memory?.totalMem === 'number' ? memory.totalMem : 0;
    const rss = typeof memory?.rss === 'number' ? memory.rss : 0;
    const memoryUsedPercent = totalMem > 0 ? (rss / totalMem) * 100 : null;
    const checks = await this.runChecks();

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

    const down = checks.filter((c) => c.status === 'down');
    if (down.length > 0) {
      status = 'critical';
      statusReason = `dependency down: ${down.map((c) => c.name).join(', ')}`;
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
        checks,
      },
    };
  }
}
