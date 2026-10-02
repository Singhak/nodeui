import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import { getConfig } from '../src/api';
import { config, defaultPayloads, health, json, resetEnv, stubApi } from './fixtures';

let payloads: Record<string, unknown>;
let fetchMock: ReturnType<typeof stubApi>;

beforeEach(() => {
  vi.stubGlobal('EventSource', undefined);
  resetEnv();
  payloads = defaultPayloads();
  fetchMock = stubApi(payloads);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ready(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole('navigation', { name: 'Views' })).toBeInTheDocument(),
  );
}

describe('shell and routing', () => {
  it('renders the sidebar with views and a Custom group for plugins', async () => {
    render(<App />);
    await ready();
    const nav = screen.getByRole('navigation', { name: 'Views' });
    for (const name of [
      'Overview',
      'Requests',
      'Outgoing',
      'Logs',
      'Environment',
      'Routes',
      'Runtime',
    ]) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(within(nav).getByText('Custom')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Job Queue/ })).toHaveAttribute(
      'href',
      '#/custom/queue',
    );
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('navigates by hash and reacts to hashchange', async () => {
    render(<App />);
    await ready();
    act(() => {
      window.location.hash = '#/routes';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Routes' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Routes' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(screen.getByText('createUser')).toBeInTheDocument());

    act(() => {
      window.location.hash = '#/logs';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Logs' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('kaboom happened')).toBeInTheDocument());
  });

  it('opens directly on a hash route and renders plugin panels', async () => {
    resetEnv('#/custom/queue');
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Job Queue' })).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument();
  });

  it('shows a not-found state for an unknown view', async () => {
    resetEnv('#/nope');
    render(<App />);
    await waitFor(() => expect(screen.getByText('View not found')).toBeInTheDocument());
  });

  it('uses relative api urls under the mount path', async () => {
    window.history.replaceState({}, '', '/mount/nodeui/');
    render(<App />);
    await ready();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/mount/nodeui/api/config');
  });

  it('hides views for disabled panels', async () => {
    payloads['/config'] = { ...config, panels: ['health', 'logs'], plugins: [] };
    render(<App />);
    await ready();
    expect(screen.queryByRole('link', { name: 'Requests' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Runtime' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Logs' })).toBeInTheDocument();
  });
});

describe('header', () => {
  it('shows status, Live indicator and the lock badge', async () => {
    payloads['/config'] = { ...config, locked: true };
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/Degraded/, { selector: '.status-pill' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText(/token protected/)).toBeInTheDocument();
  });

  it('shows a disabled pill when the console is disabled', async () => {
    payloads['/config'] = { ...config, enabled: false };
    render(<App />);
    await waitFor(() => expect(screen.getByText('console disabled')).toBeInTheDocument());
  });

  it('shows Offline when health fails', async () => {
    render(<App />);
    await ready();
    await waitFor(() => expect(screen.getByText('Live')).toBeInTheDocument());
    delete payloads['/health'];
    await waitFor(() => expect(screen.getByText('Offline')).toBeInTheDocument());
  });

  it('pause freezes the displayed data and resume catches up', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('kpi-uptime')).toHaveTextContent('1h 2m'));

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toHaveAttribute('aria-pressed', 'true');

    payloads['/health'] = { ...health, status: 'ok', statusReason: 'healthy', uptimeSeconds: 7300 };
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(screen.getByTestId('kpi-uptime')).toHaveTextContent('1h 2m');

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.getByTestId('kpi-uptime')).toHaveTextContent('2h 1m'));
    expect(screen.getByText('Live')).toBeInTheDocument();
  });
});

describe('theme', () => {
  it('toggles, sets data-theme on <html> and persists in localStorage', async () => {
    window.localStorage.setItem('nodeui-theme', 'dark');
    render(<App />);
    await ready();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    fireEvent.click(screen.getByRole('button', { name: /Switch to light theme/ }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('nodeui-theme')).toBe('light');
    cleanup();

    render(<App />);
    await ready();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(screen.getByRole('button', { name: /Switch to dark theme/ })).toBeInTheDocument();
  });

  it('survives unavailable localStorage', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<App />);
    await ready();
    const before = document.documentElement.getAttribute('data-theme');
    fireEvent.click(screen.getByRole('button', { name: /Switch to/ }));
    expect(document.documentElement.getAttribute('data-theme')).not.toBe(before);
    spy.mockRestore();
  });
});

describe('auth and errors', () => {
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

  it('shows a config error with Retry', async () => {
    delete payloads['/config'];
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument());
    payloads['/config'] = config;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
  });
});

describe('runtime view', () => {
  it('opens the confirmation dialog, closes on Esc and completes a heap snapshot', async () => {
    resetEnv('#/runtime');
    render(<App />);
    const trigger = await screen.findByRole('button', { name: 'Capture heap snapshot' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/writes a heap snapshot file to disk/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Capture heap snapshot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText(/Saved 10\.0 B snapshot/)).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('listening')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Startup timeline' })).toBeInTheDocument();
  });
});
