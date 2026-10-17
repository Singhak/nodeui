import { Session } from 'node:inspector';
import type {
  CpuProfileData,
  CpuProfileResult,
  FlameNode,
  NodeUIProvider,
  TopFunction,
} from '../types';

export const MAX_PROFILE_SECONDS = 60;
const SAMPLING_INTERVAL_US = 1000;
const MAX_NODES = 2500;
const MAX_DEPTH = 80;
const MAX_TOP = 40;

/** The slice of a V8 CPU profile the summarizer reads. */
export interface RawCpuProfile {
  nodes: Array<{
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
    children?: number[];
  }>;
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

export interface ProfilerBackend {
  start(): Promise<void>;
  stop(): Promise<RawCpuProfile>;
}

/** Profiles this process through the inspector protocol (no `--inspect` flag needed). */
export function inspectorBackend(): ProfilerBackend {
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
        await post('Profiler.enable');
        await post('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL_US });
        await post('Profiler.start');
      } catch (err) {
        session.disconnect();
        session = null;
        throw err;
      }
    },
    async stop() {
      try {
        const { profile } = await post<{ profile: RawCpuProfile }>('Profiler.stop');
        await post('Profiler.disable').catch(() => undefined);
        return profile;
      } finally {
        session?.disconnect();
        session = null;
      }
    },
  };
}

function labelOf(frame: RawCpuProfile['nodes'][number]['callFrame']): string {
  return frame.functionName || '(anonymous)';
}

export function shortUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('node:')) return url;
  const clean = url.replace(/^file:\/\/\/?/, '');
  const i = clean.lastIndexOf('node_modules/');
  if (i >= 0) return clean.slice(i);
  const parts = clean.split(/[\\/]/);
  return parts.slice(-2).join('/');
}

/** Turns a raw V8 profile into a pruned call tree plus the heaviest functions by self time. */
export function summarizeProfile(raw: RawCpuProfile): CpuProfileResult {
  const byId = new Map(raw.nodes.map((n) => [n.id, n]));
  const self = new Map<number, number>();
  const samples = raw.samples ?? [];
  const deltas = raw.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i += 1) {
    const id = samples[i] as number;
    self.set(id, (self.get(id) ?? 0) + (deltas[i] ?? SAMPLING_INTERVAL_US));
  }

  const totals = new Map<number, number>();
  const rootId = raw.nodes[0]?.id;
  const totalOf = (id: number, depth: number): number => {
    const node = byId.get(id);
    if (!node) return 0;
    let t = self.get(id) ?? 0;
    if (depth < MAX_DEPTH * 4) for (const c of node.children ?? []) t += totalOf(c, depth + 1);
    totals.set(id, t);
    return t;
  };
  const totalUs = rootId === undefined ? 0 : totalOf(rootId, 0);

  let minShare = 0.003;
  const build = (id: number, depth: number, min: number): FlameNode | null => {
    const node = byId.get(id);
    if (!node) return null;
    const total = totals.get(id) ?? 0;
    const children: FlameNode[] = [];
    if (depth < MAX_DEPTH) {
      for (const c of node.children ?? []) {
        if ((totals.get(c) ?? 0) < totalUs * min) continue;
        const child = build(c, depth + 1, min);
        if (child) children.push(child);
      }
    }
    children.sort((a, b) => b.totalMs - a.totalMs);
    const selfUs = self.get(id) ?? 0;
    return {
      name: labelOf(node.callFrame),
      file: shortUrl(node.callFrame.url),
      line: node.callFrame.lineNumber >= 0 ? node.callFrame.lineNumber + 1 : 0,
      totalMs: total / 1000,
      selfMs: selfUs / 1000,
      children,
    };
  };

  const count = (n: FlameNode): number => 1 + n.children.reduce((a, c) => a + count(c), 0);
  let tree = rootId === undefined ? null : build(rootId, 0, minShare);
  while (tree && count(tree) > MAX_NODES && minShare < 0.2) {
    minShare *= 2;
    tree = build(rootId as number, 0, minShare);
  }

  const groups = new Map<string, TopFunction>();
  for (const node of raw.nodes) {
    const selfUs = self.get(node.id) ?? 0;
    if (selfUs === 0) continue;
    const name = labelOf(node.callFrame);
    const file = shortUrl(node.callFrame.url);
    const line = node.callFrame.lineNumber >= 0 ? node.callFrame.lineNumber + 1 : 0;
    const key = `${name}|${file}|${line}`;
    const g = groups.get(key) ?? { name, file, line, selfMs: 0, share: 0 };
    g.selfMs += selfUs / 1000;
    groups.set(key, g);
  }
  const idleUs = [...byId.values()]
    .filter((n) => n.callFrame.functionName === '(idle)')
    .reduce((a, n) => a + (self.get(n.id) ?? 0), 0);
  const top = [...groups.values()]
    .map((g) => ({
      ...g,
      selfMs: round(g.selfMs),
      share: totalUs > 0 ? (g.selfMs * 1000) / totalUs : 0,
    }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, MAX_TOP);

  return {
    durationMs: round((raw.endTime - raw.startTime) / 1000),
    totalMs: round(totalUs / 1000),
    idleMs: round(idleUs / 1000),
    sampleCount: samples.length,
    tree: tree ?? { name: '(empty)', file: '', line: 0, totalMs: 0, selfMs: 0, children: [] },
    top,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CpuProfileOptions {
  backend?: ProfilerBackend;
  nowMs?: () => number;
}

/**
 * On-demand CPU profiler. Starting one is a mutating action (the server gates
 * it behind a confirmation nonce); the result is a call tree you can view as a
 * flame graph. Only one profile runs at a time, for at most a minute.
 */
export class CpuProfileProvider implements NodeUIProvider<CpuProfileData> {
  readonly id = 'cpu-profile' as const;

  private readonly backend: ProfilerBackend;
  private readonly now: () => number;
  private state: CpuProfileData = { state: 'idle' };
  private timer: NodeJS.Timeout | null = null;

  constructor(options: CpuProfileOptions = {}) {
    this.backend = options.backend ?? inspectorBackend();
    this.now = options.nowMs ?? Date.now;
  }

  async startProfile(seconds: number): Promise<CpuProfileData> {
    if (this.state.state === 'running') throw new Error('a profile is already running');
    const secs = Math.min(MAX_PROFILE_SECONDS, Math.max(1, Math.round(seconds) || 10));
    await this.backend.start();
    this.state = { state: 'running', seconds: secs, startedAtMs: this.now() };
    this.timer = setTimeout(() => void this.finish(), secs * 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    return this.state;
  }

  /** Stops early and keeps what was recorded so far. */
  async stopProfile(): Promise<CpuProfileData> {
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
      this.state = {
        state: 'done',
        seconds: running.seconds,
        startedAtMs: running.startedAtMs,
        finishedAtMs: this.now(),
        result: summarizeProfile(raw),
      };
    } catch (err) {
      this.state = {
        state: 'error',
        seconds: running.seconds,
        startedAtMs: running.startedAtMs,
        error: err instanceof Error ? err.message : 'profiling failed',
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

  get(): { ok: true; data: CpuProfileData } {
    return { ok: true, data: this.state };
  }
}
