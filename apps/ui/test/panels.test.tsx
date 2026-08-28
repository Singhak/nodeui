import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { EnvPanel } from '../src/panels/EnvPanel';
import { RoutesPanel } from '../src/panels/RoutesPanel';
import { LogsPanel } from '../src/panels/LogsPanel';
import { RequestsPanel } from '../src/panels/RequestsPanel';

const env = {
  environment: [
    { key: 'NODE_ENV', value: 'development' },
    { key: 'TOKEN', value: '[REDACTED]' },
  ],
  config: [{ key: 'app', value: 'demo' }],
};

const routes = {
  routes: [
    { method: 'GET', path: '/hello', handler: 'helloHandler' },
    { method: 'POST', path: '/users', handler: 'createUser' },
  ],
};

const logs = {
  entries: [
    { level: 'info', message: 'started', timestamp: 1 },
    { level: 'error', message: 'boom', timestamp: 2 },
  ],
};

const metrics = {
  buckets: Array.from({ length: 60 }, (_, i) => ({ ts: i * 1000, requests: 2, errors: 1 })),
};

const requests = { total: 0, entries: [] };

const payloads: Record<string, unknown> = {
  '/env': env,
  '/routes': routes,
  '/logs': logs,
  '/metrics': metrics,
  '/requests': requests,
};

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = Object.keys(payloads).find((p) => url.includes(p));
      if (match) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: payloads[match] }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: false, error: { code: 'not-found', message: 'nf' } }),
      } as unknown as Response;
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

describe('EnvPanel', () => {
  it('renders environment and config values', async () => {
    render(<EnvPanel intervalMs={2000} />);
    await waitFor(() => {
      expect(screen.getByText('NODE_ENV')).toBeInTheDocument();
    });
    expect(screen.getByText('development')).toBeInTheDocument();
    expect(screen.getByText('[REDACTED]')).toBeInTheDocument();
    expect(screen.getByText('demo')).toBeInTheDocument();
  });
});

describe('RoutesPanel', () => {
  it('renders routes with method and path', async () => {
    render(<RoutesPanel intervalMs={2000} />);
    await waitFor(() => {
      expect(screen.getByText('/hello')).toBeInTheDocument();
    });
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('createUser')).toBeInTheDocument();
  });
});

describe('LogsPanel', () => {
  it('renders log entries with levels', async () => {
    render(<LogsPanel intervalMs={2000} />);
    await waitFor(() => {
      expect(screen.getByText('started')).toBeInTheDocument();
    });
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});

describe('RequestsPanel', () => {
  it('renders the metrics chart and the request table', async () => {
    render(<RequestsPanel intervalMs={2000} />);
    await waitFor(() => {
      expect(screen.getByText(/rps/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('No requests observed yet.')).toBeInTheDocument();
    });
  });
});
