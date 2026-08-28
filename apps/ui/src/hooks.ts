import { useEffect, useRef, useState } from 'react';
import { liveClient } from './live';
import type { PanelId } from './types';

const MAX_BACKOFF_MS = 30_000;

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

/**
 * Polls a fetch function every `intervalMs`, backing off exponentially on
 * failure (up to 30s). Restarts the loop via `refetch`.
 */
export function usePolledPanel<T>(
  path: string,
  fetchFn: () => Promise<T>,
  intervalMs: number,
): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = intervalMs;

    const tick = async (): Promise<void> => {
      try {
        const result = await fetchRef.current();
        if (cancelled) return;
        delay = intervalMs;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        delay = Math.min(MAX_BACKOFF_MS, Math.max(intervalMs, delay * 2));
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) {
        timer = setTimeout(() => void tick(), delay);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, nonce]);

  const refetch = (): void => setNonce((n) => n + 1);
  return { data, error, loading, refetch };
}

/**
 * Panel data hook with SSE-first delivery and REST polling fallback. When the
 * live connection is up, updates come from the SSE stream; otherwise it polls
 * `fetchFn` on `intervalMs` with exponential backoff.
 */
export function useLivePanel<T>(
  id: PanelId,
  fetchFn: () => Promise<T>,
  intervalMs: number,
): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    return liveClient.subscribe(id, (env) => {
      if (env.ok) {
        setData(env.data as T);
        setError(null);
      } else {
        setError(env.error.message);
      }
    });
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = intervalMs;

    const tick = async (): Promise<void> => {
      if (liveClient.isConnected(id)) {
        if (!cancelled) timer = setTimeout(() => void tick(), intervalMs);
        return;
      }
      try {
        const result = await fetchRef.current();
        if (cancelled) return;
        delay = intervalMs;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        delay = Math.min(MAX_BACKOFF_MS, Math.max(intervalMs, delay * 2));
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) {
        timer = setTimeout(() => void tick(), delay);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, intervalMs, nonce]);

  const refetch = (): void => setNonce((n) => n + 1);
  return { data, error, loading, refetch };
}

/**
 * Accumulates a numeric metric into a bounded series, skipping repeats with
 * the same key (e.g. an unchanged `sampleAtMs`).
 */
export function useMetricSeries<T>(
  data: T | null,
  pick: (d: T) => number | undefined,
  key?: (d: T) => unknown,
  maxPoints = 60,
): number[] {
  const lastKey = useRef<unknown>(undefined);
  const [series, setSeries] = useState<number[]>([]);

  useEffect(() => {
    if (!data) return;
    const k = key ? key(data) : undefined;
    if (k !== undefined && k === lastKey.current) return;
    lastKey.current = k;
    const value = pick(data);
    if (value === undefined) return;
    setSeries((prev) => {
      const next = [...prev, value];
      if (next.length > maxPoints) next.shift();
      return next;
    });
  }, [data, key, maxPoints]);

  return series;
}
