import { Worker } from 'node:worker_threads';
import { normalizeReplayRequest, type ReplayTarget } from '../replay';
import { isLoopbackAddress } from '../safety';
import type { BenchRun, LoadTestConfig, LoadTestStatus, NodeUIProvider } from '../types';

export const MAX_CONNECTIONS = 100;
export const MAX_DURATION_SECONDS = 60;
export const MAX_REQUESTS = 1_000_000;
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Runs in a worker thread, so generating load does not block the app's own
 * event loop (it still shares CPU cores with it).
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const http = require('node:http');
const { host, port, method, path, headers, body, connections, durationMs, maxRequests } = workerData;
const agent = new http.Agent({ keepAlive: true, maxSockets: connections });
let sent = 0, completed = 0, errors = 0, stopping = false;
const status = { s2: 0, s3: 0, s4: 0, s5: 0 };
const deadline = Date.now() + durationMs;
function classify(code) {
  const k = 's' + Math.floor(code / 100);
  if (k in status) status[k] += 1;
}
function one() {
  return new Promise((resolve) => {
    const req = http.request({ host, port, method, path, headers, agent }, (res) => {
      res.on('data', () => {});
      res.on('end', () => { classify(res.statusCode); resolve(); });
      res.on('error', () => { errors += 1; resolve(); });
    });
    req.on('error', () => { errors += 1; resolve(); });
    if (body) req.write(body);
    req.end();
  });
}
async function loop() {
  while (!stopping && Date.now() < deadline && sent < maxRequests) {
    sent += 1;
    await one();
    completed += 1;
  }
}
parentPort.on('message', (m) => { if (m === 'stop') stopping = true; });
const report = (type) => parentPort.postMessage({ type, sent, completed, errors, ...status });
const timer = setInterval(() => report('progress'), 250);
Promise.all(Array.from({ length: connections }, loop)).then(() => {
  clearInterval(timer);
  agent.destroy();
  report('done');
});
`;

export interface LoadGenHooks {
  /** Begin recording a run; returns once recording started. */
  startRun(name: string, config: LoadTestConfig): void;
  /** Stop recording; returns the saved run. */
  stopRun(): BenchRun | null;
}

export function validateLoadTest(input: Partial<LoadTestConfig>): LoadTestConfig {
  const req = normalizeReplayRequest({
    method: input.method,
    path: input.path,
    headers: input.headers,
    body: input.body,
  });
  if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) throw new Error('body is limited to 64 kB');
  const connections = Math.round(Number(input.connections ?? 10));
  const durationSec = Number(input.durationSec ?? 10);
  const maxRequests = Math.round(Number(input.maxRequests ?? MAX_REQUESTS));
  if (!Number.isFinite(connections) || connections < 1 || connections > MAX_CONNECTIONS) {
    throw new Error(`connections must be 1..${MAX_CONNECTIONS}`);
  }
  if (!Number.isFinite(durationSec) || durationSec < 1 || durationSec > MAX_DURATION_SECONDS) {
    throw new Error(`duration must be 1..${MAX_DURATION_SECONDS} seconds`);
  }
  if (!Number.isFinite(maxRequests) || maxRequests < 1 || maxRequests > MAX_REQUESTS) {
    throw new Error(`maxRequests must be 1..${MAX_REQUESTS}`);
  }
  return {
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body,
    connections,
    durationSec,
    maxRequests,
    name: (input.name ?? '').toString().trim().slice(0, 80),
  };
}

/**
 * Fires load at the app itself and records it as a saved run, so a change can
 * be re-tested with one click and compared to the previous run.
 */
export class LoadGenProvider implements NodeUIProvider<LoadTestStatus> {
  readonly id = 'loadtest' as const;

  private status: LoadTestStatus = { state: 'idle', sent: 0, completed: 0, errors: 0 };
  private worker: Worker | null = null;
  private watchdog: NodeJS.Timeout | null = null;

  constructor(
    private readonly hooks: LoadGenHooks,
    private readonly now: () => number = Date.now,
  ) {}

  startTest(target: ReplayTarget | null, input: Partial<LoadTestConfig>): LoadTestStatus {
    if (this.status.state === 'running') throw new Error('a load test is already running');
    if (!target || !isLoopbackAddress(target.host)) {
      throw new Error(
        'No request has reached the app yet, so its address is unknown. Send one first.',
      );
    }
    const config = validateLoadTest(input);
    const name = config.name || `Load ${config.method} ${config.path}`;
    this.hooks.startRun(name, { ...config, name });
    this.status = {
      state: 'running',
      config: { ...config, name },
      startedAtMs: this.now(),
      sent: 0,
      completed: 0,
      errors: 0,
    };
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        host: target.host,
        port: target.port,
        method: config.method,
        path: config.path,
        headers: { ...config.headers, 'x-nodeui-loadtest': '1' },
        body: config.body,
        connections: config.connections,
        durationMs: config.durationSec * 1000,
        maxRequests: config.maxRequests,
      },
    });
    this.worker = worker;
    worker.on('message', (m: { type: string; sent: number; completed: number; errors: number }) => {
      if (this.status.state !== 'running') return;
      this.status = { ...this.status, sent: m.sent, completed: m.completed, errors: m.errors };
      if (m.type === 'done') this.finish(null);
    });
    worker.on('error', (err) => this.finish(err.message));
    worker.on('exit', () => {
      if (this.status.state === 'running') this.finish(null);
    });
    // Safety net: never leave a run recording forever.
    this.watchdog = setTimeout(
      () => {
        worker.postMessage('stop');
        setTimeout(() => void worker.terminate(), 3000).unref();
      },
      (config.durationSec + 15) * 1000,
    );
    this.watchdog.unref();
    return this.status;
  }

  private finish(error: string | null): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    const worker = this.worker;
    this.worker = null;
    if (worker) void worker.terminate();
    if (this.status.state !== 'running') return;
    const run = this.hooks.stopRun();
    this.status = error
      ? { ...this.status, state: 'error', error }
      : { ...this.status, state: 'done', runId: run?.id };
  }

  /** Ends the test early; the run recorded so far is kept. */
  stopTest(): LoadTestStatus {
    if (this.status.state === 'running') this.worker?.postMessage('stop');
    return this.status;
  }

  clear(): void {
    if (this.status.state !== 'running') {
      this.status = { state: 'idle', sent: 0, completed: 0, errors: 0 };
    }
  }

  stop(): void {
    if (this.status.state === 'running') this.finish('stopped');
  }

  get(): { ok: true; data: LoadTestStatus } {
    return { ok: true, data: this.status };
  }
}
