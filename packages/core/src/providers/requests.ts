import type { NodeUIProvider, RequestEntry, RequestsData } from '../types';
import { RingBuffer } from '../ring-buffer';

const RESPONSE_PAGE_SIZE = 100;

/** Fixed-size ring buffer of recent HTTP requests, recorded via middleware hook. */
export class RequestsProvider implements NodeUIProvider<RequestsData> {
  readonly id = 'requests' as const;

  private buffer: RingBuffer<RequestEntry>;
  private nextId = 1;

  constructor(size: number) {
    this.buffer = new RingBuffer<RequestEntry>(size);
  }

  record(entry: Omit<RequestEntry, 'id'>): void {
    this.buffer.push({ id: this.nextId, ...entry });
    this.nextId += 1;
  }

  get length(): number {
    return this.buffer.length;
  }

  get(): { ok: true; data: RequestsData } {
    const entries = this.buffer.slice(Math.max(0, this.buffer.length - RESPONSE_PAGE_SIZE));
    return { ok: true, data: { total: this.buffer.length, entries } };
  }
}
