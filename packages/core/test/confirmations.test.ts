import { describe, expect, it, vi } from 'vitest';
import { ConfirmationStore } from '../src/confirmations';

describe('ConfirmationStore', () => {
  it('issues a nonce with a TTL and consumes it once', () => {
    const store = new ConfirmationStore(60_000);
    const issued = store.issue();
    expect(issued.nonce).toHaveLength(32);
    expect(issued.ttlMs).toBe(60_000);
    expect(issued.expiresAtMs).toBeGreaterThan(Date.now());
    expect(store.consume(issued.nonce)).toBe(true);
    expect(store.consume(issued.nonce)).toBe(false);
  });

  it('rejects unknown nonces', () => {
    const store = new ConfirmationStore(60_000);
    expect(store.consume('nope')).toBe(false);
  });

  it('rejects expired nonces', () => {
    vi.useFakeTimers();
    try {
      const store = new ConfirmationStore(100);
      const issued = store.issue();
      vi.advanceTimersByTime(101);
      expect(store.consume(issued.nonce)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prunes expired nonces from internal storage', () => {
    vi.useFakeTimers();
    try {
      const store = new ConfirmationStore(100);
      store.issue();
      expect(store.size()).toBe(1);
      vi.advanceTimersByTime(101);
      expect(store.size()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is single-use per nonce', () => {
    const store = new ConfirmationStore(60_000);
    const a = store.issue();
    const b = store.issue();
    expect(store.consume(a.nonce)).toBe(true);
    expect(store.consume(a.nonce)).toBe(false);
    expect(store.consume(b.nonce)).toBe(true);
  });
});
