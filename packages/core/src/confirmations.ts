import { randomBytes } from 'node:crypto';
import type { ConfirmIssued } from './types';

/**
 * Single-use, expiring confirmation nonces. Mutating actions (such as heap
 * snapshots) require a nonce issued here, presented via the
 * `x-nodeui-confirm` header, which is consumed exactly once.
 */
export class ConfirmationStore {
  private nonces = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  issue(): ConfirmIssued {
    this.prune();
    const nonce = randomBytes(16).toString('hex');
    const expiresAtMs = Date.now() + this.ttlMs;
    this.nonces.set(nonce, expiresAtMs);
    return { nonce, expiresAtMs, ttlMs: this.ttlMs };
  }

  /** Consumes `nonce` and returns true only if it was valid and unexpired. */
  consume(nonce: string): boolean {
    this.prune();
    const expiresAt = this.nonces.get(nonce);
    if (expiresAt === undefined) return false;
    this.nonces.delete(nonce);
    return Date.now() <= expiresAt;
  }

  /** Number of currently valid nonces (after pruning). */
  size(): number {
    this.prune();
    return this.nonces.size;
  }

  /** Removes expired nonces. */
  prune(): void {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.nonces) {
      if (expiresAt <= now) this.nonces.delete(nonce);
    }
  }
}
