import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { liveClient } from '../src/live';
import { useLivePanel } from '../src/hooks';
import type { Envelope } from '../src/types';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static handler: ((ev: MessageEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close(): void {}
  static emit(payload: unknown): void {
    const ev = { data: JSON.stringify(payload) } as MessageEvent;
    for (const inst of FakeEventSource.instances) inst.onmessage?.(ev);
  }
  static open(): void {
    for (const inst of FakeEventSource.instances) inst.onopen?.();
  }
}

describe('liveClient', () => {
  it('opens one EventSource and dispatches envelopes to subscribers', () => {
    window.history.replaceState({}, '', '/nodeui/');
    const original = globalThis.EventSource;
    (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
    const received: Envelope<unknown>[] = [];
    const unsubscribe = liveClient.subscribe('health', (env) => received.push(env));
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.emit({ panel: 'health', envelope: { ok: true, data: { status: 'ok' } } });
    expect(received).toEqual([{ ok: true, data: { status: 'ok' } }]);
    unsubscribe();
    expect(liveClient.isConnected('health')).toBe(false);
    (globalThis as { EventSource: unknown }).EventSource = original;
  });
});

describe('useLivePanel', () => {
  it('falls back to fetch polling when EventSource is unavailable', async () => {
    (globalThis as { EventSource: unknown }).EventSource = undefined;
    const fetchFn = vi.fn(async () => ({ status: 'ok' }));
    const { result } = renderHook(() => useLivePanel('health', fetchFn, 2000));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(fetchFn).toHaveBeenCalled();
    expect(result.current.data).toEqual({ status: 'ok' });
  });
});

describe('live stream rejection (e.g. 429 too-many-streams)', () => {
  it('stays disconnected and keeps polling over REST', async () => {
    FakeEventSource.instances = [];
    (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
    const fetchFn = vi.fn(async () => ({ status: 'ok' }));
    const { result } = renderHook(() => useLivePanel('cpu', fetchFn, 2000));
    act(() => {
      for (const inst of FakeEventSource.instances) inst.onerror?.();
    });
    expect(liveClient.isConnected('cpu')).toBe(false);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.data).toEqual({ status: 'ok' });
    expect(result.current.error).toBeNull();
    (globalThis as { EventSource: unknown }).EventSource = undefined;
  });
});

describe('late subscribers (plugin panels)', () => {
  it('reopens the stream so a panel mounted after connect is included', async () => {
    FakeEventSource.instances = [];
    (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
    const offHealth = liveClient.subscribe('health', () => undefined);
    FakeEventSource.open();
    expect(liveClient.isConnected('health')).toBe(true);

    const got: Envelope<unknown>[] = [];
    const offJobs = liveClient.subscribe('jobs', (env) => got.push(env));
    // not part of the open stream yet, so callers must keep polling
    expect(liveClient.isConnected('jobs')).toBe(false);

    await new Promise((r) => setTimeout(r, 80));
    const last = FakeEventSource.instances.at(-1);
    expect(decodeURIComponent(last?.url ?? '')).toContain('jobs');
    last?.onopen?.();
    expect(liveClient.isConnected('jobs')).toBe(true);

    offJobs();
    offHealth();
  });
});
