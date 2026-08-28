import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../src/App';

const config = {
  enabled: true,
  activationReason: 'dev',
  path: '/nodeui',
  host: '127.0.0.1',
  port: 3000,
  requestLogSize: 500,
  logSize: 500,
  pollIntervalMs: 2000,
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
  ],
  masking: { enabled: true, pattern: 'TOKEN|KEY|SECRET|PASSWORD' },
};

const health = {
  status: 'ok',
  statusReason: 'healthy',
  uptimeSeconds: 42,
  pid: 1234,
  nodeVersion: 'v22.0.0',
  platform: 'linux',
  eventLoopLagMs: 1.2,
  memoryUsedPercent: 30.5,
};

const memory = {
  heapUsed: 1_048_576,
  heapTotal: 4_194_304,
  rss: 8_388_608,
  external: 1024,
  totalMem: 17_179_869_184,
  freeMem: 8_589_934_592,
  sampleAtMs: 1,
};

const cpu = { userPercent: 10, systemPercent: 5, totalPercent: 15, sampleAtMs: 1 };
const eventLoop = { currentMs: 0.5, maxMs: 3.2, avgMs: 0.4, count: 10, sampleAtMs: 1 };
const startup = {
  startedAtMs: 1000,
  marks: [{ name: 'listening', atMs: 1100, sinceFirstMs: 100 }],
};
const requests = {
  total: 1,
  entries: [
    {
      id: 1,
      method: 'GET',
      path: '/hello',
      status: 200,
      durationMs: 1.5,
      timestampMs: 2000,
      ip: '127.0.0.1',
    },
  ],
};

const env = {
  environment: [
    { key: 'NODE_ENV', value: 'development' },
    { key: 'PORT', value: '3000' },
  ],
  config: [{ key: 'app', value: 'demo' }],
};

const routes = {
  routes: [{ method: 'GET', path: '/hello', handler: 'helloHandler' }],
};

const logs = {
  entries: [{ level: 'info', message: 'listening on 127.0.0.1:3000', timestamp: 1000 }],
};

const metrics = {
  buckets: Array.from({ length: 60 }, (_, i) => ({
    ts: i * 1000,
    requests: i === 59 ? 3 : 0,
    errors: 0,
  })),
};

const payloads: Record<string, unknown> = {
  '/config': config,
  '/health': health,
  '/memory': memory,
  '/cpu': cpu,
  '/event-loop': eventLoop,
  '/startup': startup,
  '/requests': requests,
  '/env': env,
  '/routes': routes,
  '/logs': logs,
  '/metrics': metrics,
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(configOverride?: Partial<typeof config>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/confirmations')) {
        return jsonResponse({
          ok: true,
          data: { nonce: 'a'.repeat(32), expiresAtMs: 999999, ttlMs: 60000 },
        });
      }
      if (url.includes('/heap-snapshot')) {
        return jsonResponse({
          ok: true,
          data: {
            fileName: 'nodeui-heap.heapsnapshot',
            filePath: '/tmp/x.heapsnapshot',
            sizeBytes: 10,
            createdAtMs: 3000,
          },
        });
      }
      if (url.endsWith('/config')) {
        return jsonResponse({ ok: true, data: { ...config, ...configOverride } });
      }
      const match = Object.keys(payloads).find((p) => url.endsWith(p));
      if (match) return jsonResponse({ ok: true, data: payloads[match] });
      return jsonResponse({ ok: false, error: { code: 'not-found', message: 'not found' } });
    }),
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/nodeui/');
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the nodeui title and every panel heading', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'nodeui' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Health' })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Memory' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CPU' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Event Loop Lag' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Startup Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requests' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Heap Snapshot' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Environment' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Routes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Logs' })).toBeInTheDocument();
  });

  it('opens the confirmation dialog from the heap snapshot button and completes the capture', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Capture heap snapshot' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Capture heap snapshot' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/This action writes a heap snapshot file to disk/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(screen.getByText(/Saved 10\.0 B snapshot/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a disabled state when the console is disabled', async () => {
    stubFetch({ enabled: false, activationReason: 'disabled by config' });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('console disabled')).toBeInTheDocument();
    });
  });
});
