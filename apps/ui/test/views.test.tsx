import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import { GenericData } from '../src/views/GenericView';
import { defaultPayloads, resetEnv, stubApi } from './fixtures';

let payloads: Record<string, unknown>;

beforeEach(() => {
  vi.stubGlobal('EventSource', undefined);
  payloads = defaultPayloads();
  stubApi(payloads);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Errors view', () => {
  beforeEach(() => resetEnv('#/errors'));

  it('lists grouped errors, filters and opens the stack in a drawer', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('Error: db down')).toBeInTheDocument());
    expect(screen.getByText('3 total · 2 distinct')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Filter by type/), { target: { value: 'users' } });
    expect(screen.queryByText('Error: db down')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Cannot read properties/));
    const dialog = await screen.findByRole('dialog', { name: 'Error details' });
    expect(within(dialog).getByText(/at lookup/)).toBeInTheDocument();
    expect(within(dialog).getByText('/users/:id')).toBeInTheDocument();
  });

  it('shows an empty state when nothing was recorded', async () => {
    payloads['/errors'] = { total: 0, groups: [] };
    render(<App />);
    await waitFor(() => expect(screen.getByText('No errors recorded')).toBeInTheDocument());
  });
});

describe('Outgoing view', () => {
  beforeEach(() => resetEnv('#/outgoing'));

  it('renders summary, failed rows, slowest highlight and filters', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('https://api.test/ok')).toBeInTheDocument());
    expect(screen.getByText(/3 total · 2 failed · slowest 900 ms/)).toBeInTheDocument();
    expect(screen.getByText('ECONNREFUSED')).toBeInTheDocument();
    expect(screen.getByText('slowest')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    // newest first: down.test (failed), boom (failed + slowest), ok
    expect(rows[0]).toHaveClass('row-failed');
    expect(rows[1]).toHaveClass('row-failed');
    expect(rows[1]).toHaveClass('row-slowest');
    expect(rows[2]).not.toHaveClass('row-failed');

    fireEvent.click(screen.getByRole('button', { name: /failed only/ }));
    expect(screen.queryByText('https://api.test/ok')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Filter/), { target: { value: 'down.test' } });
    expect(screen.queryByText('https://api.test/boom')).not.toBeInTheDocument();
    expect(screen.getByText('https://down.test/x')).toBeInTheDocument();
  });

  it('keeps long urls complete: title attribute and a scroll wrapper', async () => {
    const long = 'https://very.long.example/' + 'segment/'.repeat(30);
    (payloads['/outgoing'] as { entries: Array<{ url: string }> }).entries[0]!.url = long;
    render(<App />);
    const cell = await screen.findByTitle(long);
    expect(cell).toHaveClass('truncate');
    expect(cell.closest('.table-wrap')).not.toBeNull();
  });

  it('sorts and offers exports', async () => {
    render(<App />);
    await screen.findByText('https://api.test/ok');
    fireEvent.click(within(screen.getByRole('columnheader', { name: /URL/ })).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: /URL/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument();
  });

  it('shows an error state with Retry and recovers', async () => {
    delete payloads['/outgoing'];
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument());
    payloads['/outgoing'] = defaultPayloads()['/outgoing'];
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('https://api.test/ok')).toBeInTheDocument());
  });
});

describe('Environment view', () => {
  it('renders values, masks secrets and filters keys', async () => {
    resetEnv('#/env');
    render(<App />);
    await waitFor(() => expect(screen.getByText('NODE_ENV')).toBeInTheDocument());
    expect(screen.getByText('development')).toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument();
    expect(screen.getByText('demo')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter keys'), { target: { value: 'node' } });
    expect(screen.queryByText('TOKEN')).not.toBeInTheDocument();
    expect(screen.getByText('NODE_ENV')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter keys'), { target: { value: 'zzz' } });
    expect(screen.getByText('No variables match')).toBeInTheDocument();
  });
});

describe('Logs view', () => {
  it('filters by level and search', async () => {
    resetEnv('#/logs');
    render(<App />);
    await waitFor(() => expect(screen.getByText('started')).toBeInTheDocument());
    const levels = within(screen.getByRole('group', { name: 'Log level' }));
    fireEvent.click(levels.getByRole('button', { name: /error/ }));
    expect(screen.queryByText('started')).not.toBeInTheDocument();
    expect(screen.getByText('kaboom happened')).toBeInTheDocument();
    fireEvent.click(levels.getByRole('button', { name: /all/ }));
    fireEvent.change(screen.getByLabelText('Search log messages'), { target: { value: 'start' } });
    expect(screen.queryByText('kaboom happened')).not.toBeInTheDocument();
    expect(screen.getByText('started')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search log messages'), {
      target: { value: 'nothing' },
    });
    expect(screen.getByText('No log entries')).toBeInTheDocument();
  });
});

describe('Routes view', () => {
  it('lists routes and filters', async () => {
    resetEnv('#/routes');
    render(<App />);
    await waitFor(() => expect(screen.getByText('/hello')).toBeInTheDocument());
    expect(screen.getByText('POST')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter routes'), { target: { value: 'users' } });
    expect(screen.queryByText('/hello')).not.toBeInTheDocument();
    expect(screen.getByText('createUser')).toBeInTheDocument();
  });
});

describe('GenericData', () => {
  it('renders an array of flat objects as a sortable table', () => {
    render(
      <GenericData
        data={[
          { a: 1, b: 'x' },
          { a: 2, b: 'y' },
        ]}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /a/ })).toBeInTheDocument();
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
