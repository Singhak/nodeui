/**
 * Fixed-size ring buffer. When full, pushing drops the oldest item.
 * Used for the HTTP request log to keep memory bounded.
 */
export class RingBuffer<T> {
  private buffer: Array<T | undefined>;
  private head = 0;
  private count = 0;
  readonly capacity: number;

  constructor(size: number) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error('RingBuffer size must be a positive integer');
    }
    this.capacity = size;
    this.buffer = new Array<T | undefined>(size);
  }

  push(item: T): void {
    this.buffer[(this.head + this.count) % this.capacity] = item;
    if (this.count < this.capacity) {
      this.count += 1;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  get length(): number {
    return this.count;
  }

  toArray(): T[] {
    return this.slice(0, this.count);
  }

  /**
   * Returns up to `limit` items starting at `offset`, oldest first.
   */
  slice(offset = 0, limit?: number): T[] {
    const capped = limit === undefined ? this.count : Math.max(0, limit);
    const out: T[] = [];
    for (let i = 0; i < this.count && out.length < capped; i += 1) {
      if (i >= offset) out.push(this.buffer[(this.head + i) % this.capacity] as T);
    }
    return out;
  }
}
