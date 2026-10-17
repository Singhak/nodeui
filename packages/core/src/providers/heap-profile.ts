import { Session } from 'node:inspector';
import type {
  AllocNode,
  HeapProfileData,
  HeapProfileResult,
  NodeUIProvider,
  TopAllocator,
} from '../types';
import { MAX_PROFILE_SECONDS, shortUrl } from './cpu-profile';

/** One sample per ~32 KB allocated keeps the overhead low. */
const SAMPLING_INTERVAL_BYTES = 32 * 1024;
const MAX_NODES = 2500;
const MAX_DEPTH = 80;
const MAX_TOP = 40;

/** The slice of a V8 sampling heap profile the summarizer reads. */
export interface RawHeapNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children?: RawHeapNode[];
}

export interface RawHeapProfile {
  head: RawHeapNode;
}

export interface HeapProfilerBackend {
  start(): Promise<void>;
  stop(): Promise<RawHeapProfile>;
}

/** Samples this process's allocations through the inspector protocol. */
export function inspectorHeapBackend(): HeapProfilerBackend {
  let session: Session | null = null;
  const post = <T>(method: string, params?: object): Promise<T> =>
    new Promise((resolve, reject) => {
      (session as Session).post(method, params, (err, result) =>
        err ? reject(err) : resolve(result as T),
      );
    });
  return {
    async start() {
      session = new Session();
      session.connect();
      try {
        await post('HeapProfiler.enable');
        await post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL_BYTES });
      } catch (err) {
        session.disconnect();
        session = null;
        throw err;
      }
    },
    async stop() {
      try {
        const { profile } = await post<{ profile: RawHeapProfile }>('HeapProfiler.stopSampling');
        await post('HeapProfiler.disable').catch(() => undefined);
        return profile;
      } finally {
        session?.disconnect();
        session = null;
      }
    },
  };
}

const labelOf = (n: RawHeapNode): string => n.callFrame.functionName || '(anonymous)';
const lineOf = (n: RawHeapNode): number =>
  n.callFrame.lineNumber >= 0 ? n.callFrame.lineNumber + 1 : 0;

/** Turns a raw sampling profile into a pruned allocation tree plus the top allocating functions. */
export function summarizeHeapProfile(raw: RawHeapProfile, durationMs = 0): HeapProfileResult {
  const totals = new Map<RawHeapNode, number>();
  const totalOf = (node: RawHeapNode, depth: number): number => {
    let t = node.selfSize;
    if (depth < MAX_DEPTH * 4) for (const c of node.children ?? []) t += totalOf(c, depth + 1);
    totals.set(node, t);
    return t;
  };
  const totalBytes = totalOf(raw.head, 0);

  let minShare = 0.003;
  const build = (node: RawHeapNode, depth: number): AllocNode => {
    const children: AllocNode[] = [];
    if (depth < MAX_DEPTH) {
      for (const c of node.children ?? []) {
        if ((totals.get(c) ?? 0) < totalBytes * minShare) continue;
        children.push(build(c, depth + 1));
      }
    }
    children.sort((a, b) => b.totalBytes - a.totalBytes);
    return {
      name: labelOf(node),
      file: shortUrl(node.callFrame.url),
      line: lineOf(node),
      totalBytes: totals.get(node) ?? 0,
      selfBytes: node.selfSize,
      children,
    };
  };
  const count = (n: AllocNode): number => 1 + n.children.reduce((a, c) => a + count(c), 0);
  let tree = build(raw.head, 0);
  while (count(tree) > MAX_NODES && minShare < 0.2) {
    minShare *= 2;
    tree = build(raw.head, 0);
  }

  const groups = new Map<string, TopAllocator>();
  const visit = (node: RawHeapNode, depth: number): void => {
    if (node.selfSize > 0) {
      const name = labelOf(node);
      const file = shortUrl(node.callFrame.url);
      const line = lineOf(node);
      const key = `${name}|${file}|${line}`;
      const g = groups.get(key) ?? { name, file, line, selfBytes: 0, share: 0 };
      g.selfBytes += node.selfSize;
      groups.set(key, g);
    }
    if (depth < MAX_DEPTH * 4) for (const c of node.children ?? []) visit(c, depth + 1);
  };
  visit(raw.head, 0);
  const top = [...groups.values()]
    .map((g) => ({ ...g, share: totalBytes > 0 ? g.selfBytes / totalBytes : 0 }))
    .sort((a, b) => b.selfBytes - a.selfBytes)
    .slice(0, MAX_TOP);

  return { durationMs: Math.round(durationMs), totalBytes, tree, top };
}

export interface HeapProfileOptions {
  backend?: HeapProfilerBackend;
  nowMs?: () => number;
}

/**
 * On-demand sampling heap profiler: shows which functions allocated the memory
 * that is still live when it stops, complementing snapshots (which show what
 * is retained, not who allocated it). Starting is gated by a confirmation
 * nonce; one profile runs at a time, for at most a minute.
 */
export class HeapProfileProvider implements NodeUIProvider<HeapProfileData> {
  readonly id = 'heap-profile' as const;

  private readonly backend: HeapProfilerBackend;
  private readonly now: () => number;
  private state: HeapProfileData = { state: 'idle' };
  private timer: NodeJS.Timeout | null = null;

  constructor(options: HeapProfileOptions = {}) {
    this.backend = options.backend ?? inspectorHeapBackend();
    this.now = options.nowMs ?? Date.now;
  }

  async startProfile(seconds: number): Promise<HeapProfileData> {
    if (this.state.state === 'running') throw new Error('a heap profile is already running');
    const secs = Math.min(MAX_PROFILE_SECONDS, Math.max(1, Math.round(seconds) || 10));
    await this.backend.start();
    this.state = { state: 'running', seconds: secs, startedAtMs: this.now() };
    this.timer = setTimeout(() => void this.finish(), secs * 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    return this.state;
  }

  /** Stops early and keeps what was recorded so far. */
  async stopProfile(): Promise<HeapProfileData> {
    if (this.state.state !== 'running') return this.state;
    await this.finish();
    return this.state;
  }

  private async finish(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const running = this.state;
    if (running.state !== 'running') return;
    try {
      const raw = await this.backend.stop();
      const finishedAtMs = this.now();
      this.state = {
        state: 'done',
        seconds: running.seconds,
        startedAtMs: running.startedAtMs,
        finishedAtMs,
        result: summarizeHeapProfile(raw, finishedAtMs - running.startedAtMs),
      };
    } catch (err) {
      this.state = {
        state: 'error',
        seconds: running.seconds,
        startedAtMs: running.startedAtMs,
        error: err instanceof Error ? err.message : 'heap profiling failed',
      };
    }
  }

  clear(): void {
    if (this.state.state !== 'running') this.state = { state: 'idle' };
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.state.state === 'running') {
      void this.backend.stop().catch(() => undefined);
      this.state = { state: 'idle' };
    }
  }

  get(): { ok: true; data: HeapProfileData } {
    return { ok: true, data: this.state };
  }
}
