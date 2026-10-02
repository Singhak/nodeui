import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getPanel } from './api';
import { useLivePanel, type PollState } from './hooks';
import type {
  CpuData,
  EventLoopData,
  HealthData,
  LogsData,
  MemoryData,
  MetricsBucket,
  MetricsData,
  PanelId,
  RequestsData,
} from './types';

export interface Pt {
  t: number;
  v: number;
}

/** Client-side history window. */
export const HISTORY_MS = 10 * 60 * 1000;

export interface History {
  heap: Pt[];
  rss: Pt[];
  cpu: Pt[];
  loop: Pt[];
  rps: Pt[];
  errs: Pt[];
  errorRate: Pt[];
  p95: Pt[];
}

const EMPTY_HISTORY: History = {
  heap: [],
  rss: [],
  cpu: [],
  loop: [],
  rps: [],
  errs: [],
  errorRate: [],
  p95: [],
};

/** Appends a point to a ring array, dropping points older than the window. */
export function pushPoint(arr: Pt[], p: Pt, windowMs = HISTORY_MS): Pt[] {
  const last = arr[arr.length - 1];
  if (last && last.t === p.t) return arr;
  const next = [...arr, p];
  const cutoff = p.t - windowMs;
  let drop = 0;
  while (drop < next.length - 1 && (next[drop] as Pt).t < cutoff) drop += 1;
  return drop > 0 ? next.slice(drop) : next;
}

/** Merges one-second buckets by timestamp and trims to the history window. */
export function mergeBuckets(
  prev: MetricsBucket[],
  incoming: MetricsBucket[],
  windowMs = HISTORY_MS,
): MetricsBucket[] {
  const byTs = new Map<number, MetricsBucket>();
  for (const b of prev) byTs.set(b.ts, b);
  for (const b of incoming) byTs.set(b.ts, b);
  const all = [...byTs.values()].sort((a, b) => a.ts - b.ts);
  const newest = all.length > 0 ? (all[all.length - 1] as MetricsBucket).ts : 0;
  return all.filter((b) => b.ts >= newest - windowMs);
}

/** Average requests per second over the most recent complete buckets. */
export function currentRate(buckets: MetricsBucket[], window = 10): number | null {
  if (buckets.length === 0) return null;
  // the last bucket is still filling; ignore it when there is something else
  const complete = buckets.length > 1 ? buckets.slice(0, -1) : buckets;
  const recent = complete.slice(-window);
  return recent.reduce((sum, b) => sum + b.requests, 0) / recent.length;
}

export type Connection = 'live' | 'paused' | 'offline';

interface Snapshot {
  health: HealthData | null;
  memory: MemoryData | null;
  cpu: CpuData | null;
  loop: EventLoopData | null;
  requests: RequestsData | null;
  logs: LogsData | null;
  buckets: MetricsBucket[];
  history: History;
  updatedAt: number | null;
}

const EMPTY: Snapshot = {
  health: null,
  memory: null,
  cpu: null,
  loop: null,
  requests: null,
  logs: null,
  buckets: [],
  history: EMPTY_HISTORY,
  updatedAt: null,
};

export interface TelemetryValue extends Snapshot {
  paused: boolean;
  togglePause: () => void;
  intervalMs: number;
  connection: Connection;
  errors: Partial<
    Record<
      'health' | 'memory' | 'cpu' | 'event-loop' | 'metrics' | 'requests' | 'logs',
      string | null
    >
  >;
  /** True until the first health response (or error) arrived. */
  loading: boolean;
  retry: () => void;
}

const TelemetryContext = createContext<TelemetryValue | null>(null);

export function useTelemetry(): TelemetryValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetry must be used inside <TelemetryProvider>');
  return ctx;
}

/** Same as {@link useTelemetry} but tolerant of a missing provider. */
export function usePaused(): boolean {
  return useContext(TelemetryContext)?.paused ?? false;
}

const fetcher =
  <T,>(path: string) =>
  () =>
    getPanel<T>(path);

/**
 * Subscribes to the core telemetry panels regardless of the visible view and
 * accumulates ~10 minutes of history so charts survive navigation. While
 * paused, incoming updates are not applied (the displayed snapshot freezes).
 */
export function TelemetryProvider({
  intervalMs,
  children,
}: {
  intervalMs: number;
  children: ReactNode;
}) {
  const [paused, setPaused] = useState(false);
  const [snap, setSnap] = useState<Snapshot>(EMPTY);

  const health = useLivePanel<HealthData>('health', fetcher('/health'), intervalMs);
  const memory = useLivePanel<MemoryData>('memory', fetcher('/memory'), intervalMs);
  const cpu = useLivePanel<CpuData>('cpu', fetcher('/cpu'), intervalMs);
  const loop = useLivePanel<EventLoopData>('event-loop', fetcher('/event-loop'), intervalMs);
  const metrics = useLivePanel<MetricsData>('metrics', fetcher('/metrics'), intervalMs);
  const requests = useLivePanel<RequestsData>('requests', fetcher('/requests'), intervalMs);
  const logs = useLivePanel<LogsData>('logs', fetcher('/logs'), intervalMs);

  useEffect(() => {
    if (paused || !health.data) return;
    const data = health.data;
    setSnap((s) => ({ ...s, health: data, updatedAt: Date.now() }));
  }, [health.data, paused]);

  useEffect(() => {
    if (paused || !memory.data) return;
    const d = memory.data;
    setSnap((s) => {
      if (s.memory && s.memory.sampleAtMs === d.sampleAtMs) return s;
      return {
        ...s,
        memory: d,
        history: {
          ...s.history,
          heap: pushPoint(s.history.heap, { t: d.sampleAtMs, v: d.heapUsed }),
          rss: pushPoint(s.history.rss, { t: d.sampleAtMs, v: d.rss }),
        },
      };
    });
  }, [memory.data, paused]);

  useEffect(() => {
    if (paused || !cpu.data) return;
    const d = cpu.data;
    setSnap((s) => {
      if (s.cpu && s.cpu.sampleAtMs === d.sampleAtMs) return s;
      return {
        ...s,
        cpu: d,
        history: {
          ...s.history,
          cpu: pushPoint(s.history.cpu, { t: d.sampleAtMs, v: d.totalPercent }),
        },
      };
    });
  }, [cpu.data, paused]);

  useEffect(() => {
    if (paused || !loop.data) return;
    const d = loop.data;
    setSnap((s) => {
      if (s.loop && s.loop.sampleAtMs === d.sampleAtMs) return s;
      return {
        ...s,
        loop: d,
        history: {
          ...s.history,
          loop: pushPoint(s.history.loop, { t: d.sampleAtMs, v: d.currentMs }),
        },
      };
    });
  }, [loop.data, paused]);

  useEffect(() => {
    if (paused || !metrics.data) return;
    const incoming = metrics.data.buckets;
    setSnap((s) => {
      const buckets = mergeBuckets(s.buckets, incoming);
      return {
        ...s,
        buckets,
        history: {
          ...s.history,
          rps: buckets.map((b) => ({ t: b.ts, v: b.requests })),
          errs: buckets.map((b) => ({ t: b.ts, v: b.errors })),
        },
      };
    });
  }, [metrics.data, paused]);

  useEffect(() => {
    if (paused || !requests.data) return;
    const d = requests.data;
    setSnap((s) => {
      const now = Date.now();
      const sum = d.summary;
      return {
        ...s,
        requests: d,
        history: sum
          ? {
              ...s.history,
              errorRate: pushPoint(s.history.errorRate, { t: now, v: sum.errorRate * 100 }),
              p95: pushPoint(s.history.p95, { t: now, v: sum.p95Ms }),
            }
          : s.history,
      };
    });
  }, [requests.data, paused]);

  useEffect(() => {
    if (paused || !logs.data) return;
    const d = logs.data;
    setSnap((s) => ({ ...s, logs: d }));
  }, [logs.data, paused]);

  const states: Array<[keyof TelemetryValue['errors'], PollState<unknown>]> = [
    ['health', health],
    ['memory', memory],
    ['cpu', cpu],
    ['event-loop', loop],
    ['metrics', metrics],
    ['requests', requests],
    ['logs', logs],
  ];
  const refetchers = useRef<Array<() => void>>([]);
  refetchers.current = states.map(([, s]) => s.refetch);
  const retry = useCallback(() => {
    for (const r of refetchers.current) r();
  }, []);
  const togglePause = useCallback(() => setPaused((p) => !p), []);

  const errors: TelemetryValue['errors'] = {};
  for (const [key, s] of states) errors[key] = paused ? null : s.error;
  const connection: Connection = paused ? 'paused' : health.error ? 'offline' : 'live';
  const loading = !snap.health && !health.error;

  const value: TelemetryValue = {
    ...snap,
    paused,
    togglePause,
    intervalMs,
    connection,
    errors,
    loading,
    retry,
  };

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

/**
 * Live panel data for a single view: SSE-first with REST fallback, and frozen
 * while the console is paused.
 */
export function usePanel<T>(id: PanelId, path: string, intervalMs: number): PollState<T> {
  const paused = usePaused();
  const state = useLivePanel<T>(id, fetcher<T>(path), intervalMs);
  const [shown, setShown] = useState<{ data: T | null; error: string | null }>({
    data: null,
    error: null,
  });
  useEffect(() => {
    if (paused) return;
    setShown({ data: state.data, error: state.error });
  }, [state.data, state.error, paused]);
  return {
    data: shown.data,
    error: shown.error,
    loading: state.loading && shown.data === null,
    refetch: state.refetch,
  };
}
