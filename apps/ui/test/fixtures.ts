import { vi } from 'vitest';
import { resetUnauthorized } from '../src/api';

export const config = {
  enabled: true,
  activationReason: 'dev',
  path: '/nodeui',
  host: '127.0.0.1',
  port: 3000,
  requestLogSize: 500,
  logSize: 500,
  pollIntervalMs: 40,
  panels: [
    'health',
    'memory',
    'cpu',
    'event-loop',
    'startup',
    'requests',
    'heap-snapshot',
    'env',
    'routes',
    'logs',
    'metrics',
    'outgoing',
    'errors',
    'queue',
  ],
  masking: { enabled: true, pattern: 'TOKEN|KEY|SECRET|PASSWORD' },
  locked: false,
  plugins: [{ id: 'queue', title: 'Job Queue' }],
};

export const health = {
  status: 'degraded',
  statusReason: 'db down',
  uptimeSeconds: 3725,
  pid: 1234,
  nodeVersion: 'v22.0.0',
  platform: 'linux',
  eventLoopLagMs: 1.2,
  memoryUsedPercent: 30.5,
  checks: [
    { name: 'db', status: 'down', durationMs: 30, error: 'timed out' },
    { name: 'cache', status: 'up', durationMs: 2 },
  ],
};

export const memory = {
  heapUsed: 52_428_800,
  heapTotal: 104_857_600,
  rss: 150_994_944,
  external: 1024,
  totalMem: 17_179_869_184,
  freeMem: 8_589_934_592,
  sampleAtMs: 1000,
};
export const cpu = { userPercent: 10, systemPercent: 5, totalPercent: 15, sampleAtMs: 1000 };
export const eventLoop = { currentMs: 0.5, maxMs: 3.2, avgMs: 0.4, count: 10, sampleAtMs: 1000 };
export const startup = {
  startedAtMs: 1000,
  marks: [{ name: 'listening', atMs: 1100, sinceFirstMs: 100 }],
};

const at = (h: number, m: number, s: number): number => new Date(2026, 0, 5, h, m, s).getTime();
export const T_FIRST = at(10, 0, 1);

export const requests = {
  total: 4,
  entries: [
    {
      id: 1,
      method: 'GET',
      path: '/hello',
      status: 200,
      durationMs: 1.5,
      timestampMs: T_FIRST,
      ip: '127.0.0.1',
    },
    {
      id: 2,
      method: 'POST',
      path: '/users',
      status: 201,
      durationMs: 40,
      timestampMs: at(10, 0, 2),
      ip: '10.0.0.2',
    },
    {
      id: 3,
      method: 'GET',
      path: '/missing',
      status: 404,
      durationMs: 3,
      timestampMs: at(10, 0, 3),
      ip: '127.0.0.1',
    },
    {
      id: 4,
      method: 'GET',
      path: '/boom',
      status: 500,
      durationMs: 250,
      timestampMs: at(10, 0, 4),
      ip: '127.0.0.1',
    },
  ],
  summary: {
    count: 4,
    errors: 1,
    errorRate: 0.25,
    avgMs: 73.6,
    p50Ms: 21.5,
    p95Ms: 250,
    p99Ms: 250,
    byStatus: { '2xx': 2, '3xx': 0, '4xx': 1, '5xx': 1 },
    routes: [
      { method: 'GET', path: '/boom', count: 1, avgMs: 250, p95Ms: 250, errors: 1 },
      { method: 'POST', path: '/users', count: 1, avgMs: 40, p95Ms: 40, errors: 0 },
    ],
  },
};

export const metrics = {
  buckets: Array.from({ length: 60 }, (_, i) => ({
    ts: 1_000_000 + i * 1000,
    requests: 2,
    errors: i % 10 === 0 ? 1 : 0,
  })),
};

export const env = {
  environment: [
    { key: 'NODE_ENV', value: 'development' },
    { key: 'TOKEN', value: '[REDACTED]' },
  ],
  config: [{ key: 'app', value: 'demo' }],
};

export const routes = {
  routes: [
    { method: 'GET', path: '/hello', handler: 'helloHandler' },
    { method: 'POST', path: '/users', handler: 'createUser' },
  ],
};

export const logs = {
  entries: [
    { level: 'info', message: 'started', timestamp: at(10, 0, 0) },
    { level: 'error', message: 'kaboom happened', timestamp: at(10, 0, 5) },
  ],
};

export const outgoing = {
  total: 3,
  failed: 2,
  entries: [
    {
      id: 1,
      method: 'GET',
      url: 'https://api.test/ok',
      status: 200,
      durationMs: 12,
      timestampMs: at(10, 0, 1),
    },
    {
      id: 2,
      method: 'POST',
      url: 'https://api.test/boom',
      status: 503,
      durationMs: 900,
      timestampMs: at(10, 0, 2),
    },
    {
      id: 3,
      method: 'GET',
      url: 'https://down.test/x',
      status: null,
      durationMs: 5,
      timestampMs: at(10, 0, 3),
      error: 'ECONNREFUSED',
    },
  ],
};

export const errors = {
  total: 3,
  groups: [
    {
      id: 'a1b2c3d4e5f6',
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'id')",
      stack: 'TypeError: boom\n    at lookup (/app/users.ts:10:5)',
      source: 'request',
      count: 2,
      firstSeenMs: at(10, 0, 1),
      lastSeenMs: at(10, 0, 5),
      lastRoute: '/users/:id',
      lastRequestId: 4,
    },
    {
      id: 'f6e5d4c3b2a1',
      name: 'Error',
      message: 'db down',
      stack: '',
      source: 'rejection',
      count: 1,
      firstSeenMs: at(10, 0, 2),
      lastSeenMs: at(10, 0, 2),
    },
  ],
};

export function defaultPayloads(): Record<string, unknown> {
  return structuredClone({
    '/config': config,
    '/health': health,
    '/memory': memory,
    '/cpu': cpu,
    '/event-loop': eventLoop,
    '/startup': startup,
    '/requests': requests,
    '/metrics': metrics,
    '/env': env,
    '/routes': routes,
    '/logs': logs,
    '/outgoing': outgoing,
    '/errors': errors,
    '/queue': { depth: 7 },
  });
}

export function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

/** Stubs fetch with a mutable payload table keyed by API path. */
export function stubApi(payloads: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/confirmations')) {
      return json({ ok: true, data: { nonce: 'a'.repeat(32), expiresAtMs: 99999, ttlMs: 60000 } });
    }
    if (url.endsWith('/heap-snapshot') && init?.method === 'POST') {
      return json({
        ok: true,
        data: { fileName: 'x.heapsnapshot', filePath: '/tmp/x', sizeBytes: 10, createdAtMs: 3000 },
      });
    }
    const key = Object.keys(payloads).find((p) => url.endsWith(`/api${p}`));
    if (key) return json({ ok: true, data: payloads[key] });
    return json({ ok: false, error: { code: 'not-found', message: 'not found' } }, 404);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function resetEnv(hash = ''): void {
  window.history.replaceState({}, '', `/nodeui/${hash}`);
  window.location.hash = hash;
  resetUnauthorized();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  document.documentElement.removeAttribute('data-theme');
}
