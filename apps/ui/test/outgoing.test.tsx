import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OutgoingPanel } from '../src/panels/OutgoingPanel';
import { GenericPanel, GenericData } from '../src/panels/GenericPanel';
import { HealthPanel } from '../src/panels/HealthPanel';
import App from '../src/App';
import { getConfig, resetUnauthorized } from '../src/api';

const outgoing = {
  total: 3,
  failed: 2,
  entries: [
    {
      id: 1,
      method: 'GET',
      url: 'https://api.test/ok',
      status: 200,
      durationMs: 12,
      timestampMs: 1,
    },
    {
      id: 2,
      method: 'POST',
      url: 'https://api.test/boom',
      status: 503,
      durationMs: 900,
      timestampMs: 2,
    },
    {
      id: 3,
      method: 'GET',
      url: 'https://down.test/x',
      status: null,
      durationMs: 5,
      timestampMs: 3,
      error: 'ECONNREFUSED',
    },
  ],
};

const health = {
  status: 'degraded',
  statusReason: 'db down',
  uptimeSeconds: 10,
  pid: 1,
  nodeVersion: 'v22',
  platform: 'linux',
  eventLoopLagMs: 1,
  memoryUsedPercent: 10,
  checks: [
    { name: 'db', status: 'down', durationMs: 30, error: 'timed out' },
    { name: 'cache', status: 'up', durationMs: 2 },
  ],
};

let payloads: Record<string, unknown> = {};
let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/mount/nodeui/');
  resetUnauthorized();
  payloads = { '/outgoing': outgoing, '/health': health };
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(payloads).find((p) => url.endsWith(`/api${p}`));
    if (key) return json({ ok: true, data: payloads[key] });
    return json({ ok: false, error: { code: 'not-found', message: 'nf' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OutgoingPanel', () => {
  it('renders summary, failed rows, slowest highlight and filters', async () => {
    render(<OutgoingPanel intervalMs={2000} />);
    await waitFor(() => expect(screen.getByText('https://api.test/ok')).toBeInTheDocument());
    expect(screen.getByText(/3 total · 2 failed · slowest 900\.0ms/)).toBeInTheDocument();
    expect(screen.getByText('ECONNREFUSED')).toBeInTheDocument();
    expect(screen.getByText('slowest')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows[1]).not.toHaveClass('row-failed');
    expect(rows[2]).toHaveClass('row-failed');
    expect(rows[3]).toHaveClass('row-failed');

    fireEvent.click(screen.getByText('failed only'));
    expect(screen.queryByText('https://api.test/ok')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Filter/), { target: { value: 'down.test' } });
    expect(screen.queryByText('https://api.test/boom')).not.toBeInTheDocument();
    expect(screen.getByText('https://down.test/x')).toBeInTheDocument();
  });

  it('uses same-origin credentials and the mount path', async () => {
    render(<OutgoingPanel intervalMs={2000} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/mount/nodeui/api/outgoing');
    expect(init.credentials).toBe('same-origin');
  });
});

describe('HealthPanel checks', () => {
  it('shows dependency checks', async () => {
    render(<HealthPanel intervalMs={2000} />);
    await waitFor(() => expect(screen.getByText('Dependency checks')).toBeInTheDocument());
    expect(screen.getByText('timed out')).toBeInTheDocument();
    expect(screen.getByText('cache')).toBeInTheDocument();
  });

  it('omits the section when there are no checks', async () => {
    payloads['/health'] = { ...health, checks: [] };
    render(<HealthPanel intervalMs={2000} />);
    await waitFor(() => expect(screen.getByText('db down')).toBeInTheDocument());
    expect(screen.queryByText('Dependency checks')).not.toBeInTheDocument();
  });
});

describe('GenericData', () => {
  it('renders an array of flat objects as a table', () => {
    render(
      <GenericData
        data={[
          { a: 1, b: 'x' },
          { a: 2, b: 'y' },
        ]}
      />,
    );
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('y')).toBeInTheDocument();
  });

  it('renders objects as key/values with nested JSON in pre', () => {
    const { container } = render(<GenericData data={{ name: 'svc', nested: { k: [1, 2] } }} />);
    expect(screen.getByText('svc')).toBeInTheDocument();
    expect(container.querySelector('pre')?.textContent).toContain('"k"');
  });

  it('renders scalars as text', () => {
    render(<GenericData data={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});

describe('GenericPanel', () => {
  it('fetches /api/<id> and renders data', async () => {
    payloads['/queue'] = { depth: 7 };
    render(<GenericPanel id="queue" title="Queue" intervalMs={2000} />);
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());
    expect(screen.getByText('Queue')).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
    expect(screen.queryByText('CSV')).not.toBeInTheDocument();
  });
});

describe('App', () => {
  const config = {
    enabled: true,
    activationReason: 'x',
    path: '/mount/nodeui',
    host: '127.0.0.1',
    port: 1,
    requestLogSize: 1,
    logSize: 1,
    pollIntervalMs: 2000,
    panels: ['outgoing', 'queue'],
    masking: { enabled: true, pattern: '' },
    locked: true,
    plugins: [{ id: 'queue', title: 'Job Queue' }],
  };

  it('shows lock badge and plugin panels', async () => {
    payloads['/config'] = config;
    payloads['/queue'] = { depth: 7 };
    render(<App />);
    await waitFor(() => expect(screen.getByText(/token$/)).toBeInTheDocument());
    expect(screen.getAllByText('Job Queue').length).toBeGreaterThan(0);
  });

  it('shows the auth message on 401 unauthorized', async () => {
    fetchMock.mockImplementation(async () =>
      json(
        { ok: false, error: { code: 'unauthorized', message: 'a valid nodeui token is required' } },
        401,
      ),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/NODEUI_TOKEN/)).toBeInTheDocument();
  });

  it('getConfig rejects with code unauthorized', async () => {
    fetchMock.mockImplementation(async () =>
      json({ ok: false, error: { code: 'unauthorized', message: 'nope' } }, 401),
    );
    await expect(getConfig()).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
