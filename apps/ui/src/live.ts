import { apiBase } from './api';
import type { Envelope, PanelId } from './types';

type Subscriber = (env: Envelope<unknown>) => void;

const MAX_RETRY_MS = 30_000;

/**
 * Shared Server-Sent Events client. One `EventSource` is kept open with the
 * union of all subscribed panel ids; envelopes are dispatched to the
 * matching subscribers. Reconnects with backoff. When `EventSource` is
 * unavailable (jsdom, old browsers) subscriptions simply never connect and
 * callers fall back to REST polling.
 */
class LiveClient {
  private es: EventSource | null = null;
  private readonly subscribers = new Map<PanelId, Set<Subscriber>>();
  private connected = false;
  private retryMs = 1000;
  private failures = 0;
  private reconnectTimer: number | undefined;
  /** Panel ids the open stream was requested with. */
  private requested = new Set<PanelId>();
  private restartTimer: number | undefined;

  subscribe(id: PanelId, cb: Subscriber): () => void {
    const set = this.subscribers.get(id) ?? new Set<Subscriber>();
    set.add(cb);
    this.subscribers.set(id, set);
    this.ensure();
    // A panel mounted after the stream opened (e.g. a plugin panel, which is
    // only known once /config has loaded) is not part of it: reopen once.
    if (this.es && !this.requested.has(id)) this.scheduleRestart();
    return () => {
      const current = this.subscribers.get(id);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) this.subscribers.delete(id);
      if (this.subscribers.size === 0) this.close();
      else this.reconnect();
    };
  }

  isConnected(id: PanelId): boolean {
    return this.connected && this.requested.has(id) && this.subscribers.has(id);
  }

  private ensure(): void {
    if (typeof EventSource === 'undefined') return;
    if (this.es) return;
    this.requested = new Set(this.subscribers.keys());
    const panels = [...this.requested].join(',');
    const es = new EventSource(`${apiBase()}/live?panels=${encodeURIComponent(panels)}`);
    this.es = es;
    es.onopen = () => {
      this.connected = true;
      this.retryMs = 1000;
      this.failures = 0;
    };
    es.onmessage = (ev) => {
      let payload: { panel?: PanelId; envelope?: Envelope<unknown> };
      try {
        payload = JSON.parse(String(ev.data)) as { panel?: PanelId; envelope?: Envelope<unknown> };
      } catch {
        return;
      }
      if (!payload.panel || !payload.envelope) return;
      const set = this.subscribers.get(payload.panel);
      if (!set) return;
      for (const cb of set) cb(payload.envelope);
    };
    es.onerror = () => {
      es.close();
      if (this.es === es) this.es = null;
      this.connected = false;
      // EventSource hides the HTTP status, so a 429 'too-many-streams' looks
      // like any failed connect. Panels keep polling over REST meanwhile; after
      // repeated failures retry at the slowest cadence to stay quiet.
      this.failures += 1;
      if (this.failures >= 3) this.retryMs = MAX_RETRY_MS;
      this.scheduleReconnect();
    };
  }

  /** Batches late subscriptions into a single reconnect. */
  private scheduleRestart(): void {
    if (this.restartTimer !== undefined) return;
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = undefined;
      this.es?.close();
      this.es = null;
      this.connected = false;
      this.ensure();
    }, 50);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensure();
    }, this.retryMs);
    this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
  }

  private close(): void {
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.restartTimer !== undefined) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    this.es?.close();
    this.es = null;
    this.connected = false;
    this.requested = new Set();
    this.retryMs = 1000;
    this.failures = 0;
  }

  private reconnect(): void {
    if (!this.es && this.subscribers.size > 0) this.ensure();
  }
}

export const liveClient = new LiveClient();
