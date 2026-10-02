import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import { toCurl } from '../src/views/RequestsView';
import { formatClock, formatDuration } from '../src/format';
import { T_FIRST, defaultPayloads, resetEnv, stubApi } from './fixtures';

beforeEach(() => {
  vi.stubGlobal('EventSource', undefined);
  resetEnv('#/requests');
  stubApi(defaultPayloads());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function bodyRows(): HTMLElement[] {
  return screen.getAllByRole('row').slice(1);
}

async function loaded(): Promise<void> {
  await waitFor(() => expect(screen.getByText('/hello')).toBeInTheDocument());
}

describe('Requests view', () => {
  it('shows summary tiles, formatted time and consistent durations', async () => {
    render(<App />);
    await loaded();
    expect(
      within(screen.getByRole('group', { name: 'p95' })).getByText('250 ms'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'p50' })).getByText('21.5 ms'),
    ).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
    expect(screen.getByText(formatClock(T_FIRST))).toHaveClass('nowrap');
    expect(formatClock(T_FIRST)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatDuration(1.5)).toBe('1.5 ms');
    expect(formatDuration(1500)).toBe('1.50 s');
  });

  it('sorts by column with aria-sort and toggles direction', async () => {
    render(<App />);
    await loaded();
    const timeHeader = screen.getByRole('columnheader', { name: /Time/ });
    expect(timeHeader).toHaveAttribute('aria-sort', 'descending');
    expect(within(bodyRows()[0] as HTMLElement).getByText('/boom')).toBeInTheDocument();

    const durBtn = (): HTMLElement =>
      within(screen.getByRole('columnheader', { name: /Duration/ })).getByRole('button');
    fireEvent.click(durBtn());
    expect(screen.getByRole('columnheader', { name: /Duration/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(timeHeader).toHaveAttribute('aria-sort', 'none');
    expect(within(bodyRows()[0] as HTMLElement).getByText('/boom')).toBeInTheDocument();

    fireEvent.click(durBtn());
    expect(screen.getByRole('columnheader', { name: /Duration/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(within(bodyRows()[0] as HTMLElement).getByText('/hello')).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('columnheader', { name: /Path/ })).getByRole('button'));
    expect(within(bodyRows()[0] as HTMLElement).getByText('/boom')).toBeInTheDocument();
  });

  it('filters by status chip, method and search', async () => {
    render(<App />);
    await loaded();
    expect(bodyRows()).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: /5xx/ }));
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByRole('button', { name: /5xx/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /4xx/ }));
    expect(bodyRows()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /5xx/ }));
    fireEvent.click(screen.getByRole('button', { name: /4xx/ }));
    expect(bodyRows()).toHaveLength(4);

    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'POST' } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('/users')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'all' } });

    fireEvent.change(screen.getByLabelText('Search requests'), { target: { value: 'miss' } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('/missing')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search requests'), { target: { value: 'zzz' } });
    expect(screen.getByText('No requests match the filters')).toBeInTheDocument();
  });

  it('opens a detail drawer, copies curl, closes on Esc and returns focus', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App />);
    await loaded();
    const row = screen.getByText('/users').closest('tr') as HTMLElement;
    row.focus();
    fireEvent.click(row);
    const dialog = screen.getByRole('dialog', { name: 'Request details' });
    expect(within(dialog).getByText('/users')).toBeInTheDocument();
    expect(within(dialog).getByText(/201/)).toBeInTheDocument();
    expect(within(dialog).getByText('10.0.0.2')).toBeInTheDocument();
    expect(within(dialog).getByText('40.0 ms')).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy as curl' }));
    await waitFor(() => expect(within(dialog).getByText(/Copied/)).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(`curl -X POST '${window.location.origin}/users'`);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(row);
  });

  it('opens the drawer from the keyboard (Enter)', async () => {
    render(<App />);
    await loaded();
    const row = screen.getByText('/boom').closest('tr') as HTMLElement;
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Request details' })).toBeInTheDocument();
  });

  it('toCurl escapes single quotes', () => {
    expect(toCurl({ method: 'GET', path: "/a'b" }, 'http://x')).toBe(
      `curl -X GET 'http://x/a'\\''b'`,
    );
  });

  it('shows an empty state with help text', async () => {
    const payloads = defaultPayloads();
    payloads['/requests'] = { ...(payloads['/requests'] as object), entries: [], total: 0 };
    stubApi(payloads);
    render(<App />);
    await waitFor(() => expect(screen.getByText('No requests observed yet')).toBeInTheDocument());
  });
});

describe('toCurl with request detail', () => {
  it('replays query, headers and body, skipping redacted credentials', () => {
    const curl = toCurl(
      {
        method: 'POST',
        path: '/u',
        query: { page: '2' },
        headers: { 'content-type': 'application/json', authorization: '[REDACTED]', host: 'x' },
        requestBody: '{"a":"it\'s"}',
      },
      'http://x',
    );
    expect(curl).toContain("'http://x/u?page=2'");
    expect(curl).toContain("-H 'content-type: application/json'");
    expect(curl).not.toContain('authorization');
    expect(curl).not.toContain('host:');
    expect(curl).toContain(`--data-raw '{"a":"it'\\''s"}'`);
  });
});
