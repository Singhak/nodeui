import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import { parseHash, parseHashQuery } from '../src/router';
import {
  deleteView,
  EMPTY_FILTERS,
  filtersToParams,
  loadViews,
  paramsToFilters,
  saveView,
} from '../src/requestFilters';
import { defaultPayloads, resetEnv, stubApi } from './fixtures';

beforeEach(() => {
  vi.stubGlobal('EventSource', undefined);
  stubApi(defaultPayloads());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('hash query helpers', () => {
  it('ignores the query when reading path segments', () => {
    expect(parseHash('#/requests?status=5xx&min=10')).toEqual(['requests']);
    expect(parseHashQuery('#/requests?status=5xx&min=10').get('min')).toBe('10');
    expect(parseHashQuery('#/requests').toString()).toBe('');
  });
});

describe('filter serialization', () => {
  it('round-trips and omits defaults', () => {
    expect(filtersToParams(EMPTY_FILTERS).toString()).toBe('');
    const f = { classes: new Set(['5xx', '4xx']), method: 'POST', query: 'users', minMs: 100 };
    const qs = filtersToParams(f).toString();
    expect(qs).toBe('status=4xx%2C5xx&method=POST&q=users&min=100');
    const back = paramsToFilters(new URLSearchParams(qs));
    expect([...back.classes].sort()).toEqual(['4xx', '5xx']);
    expect(back).toMatchObject({ method: 'POST', query: 'users', minMs: 100 });
  });

  it('ignores junk in a shared link', () => {
    const f = paramsToFilters(new URLSearchParams('status=9xx,abc&method=<script>&min=-4&q=x'));
    expect(f.classes.size).toBe(0);
    expect(f.method).toBe('all');
    expect(f.minMs).toBe(0);
    expect(f.query).toBe('x');
  });
});

describe('saved views storage', () => {
  it('saves, replaces by name and deletes', () => {
    let views = saveView([], { name: 'errors', params: 'status=5xx' });
    views = saveView(views, { name: 'slow', params: 'min=100' });
    views = saveView(views, { name: 'errors', params: 'status=4xx' });
    expect(views.map((v) => v.name)).toEqual(['errors', 'slow']);
    expect(loadViews()).toEqual(views);
    expect(deleteView(views, 'errors').map((v) => v.name)).toEqual(['slow']);
    expect(loadViews().map((v) => v.name)).toEqual(['slow']);
  });

  it('survives corrupt storage', () => {
    window.localStorage.setItem('nodeui.requestViews', '{oops');
    expect(loadViews()).toEqual([]);
  });
});

describe('Requests filters in the UI', () => {
  it('starts from the link, filters by minimum duration and keeps the URL in sync', async () => {
    resetEnv('#/requests?min=30');
    render(<App />);
    const table = await screen.findByRole('table', { name: 'Incoming requests' });
    await waitFor(() => expect(within(table).queryByText('/hello')).not.toBeInTheDocument());
    expect(within(table).getByText('/boom')).toBeInTheDocument();
    expect(within(table).getByText('/users')).toBeInTheDocument();
    expect((screen.getByLabelText('Minimum duration (ms)') as HTMLInputElement).value).toBe('30');

    fireEvent.click(screen.getByRole('button', { name: '5xx' }));
    await waitFor(() => expect(window.location.hash).toBe('#/requests?status=5xx&min=30'));
    expect(within(table).queryByText('/users')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(window.location.hash).toBe('#/requests'));
    expect(within(table).getByText('/hello')).toBeInTheDocument();
  });

  it('saves a named view and applies it later', async () => {
    resetEnv('#/requests');
    render(<App />);
    await screen.findByRole('table', { name: 'Incoming requests' });
    fireEvent.click(screen.getByRole('button', { name: '5xx' }));
    fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'only 5xx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(loadViews().map((v) => v.name)).toEqual(['only 5xx']);

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(window.location.hash).toBe('#/requests'));
    fireEvent.change(screen.getAllByLabelText('Saved views')[1] as HTMLSelectElement, {
      target: { value: 'only 5xx' },
    });
    await waitFor(() => expect(window.location.hash).toBe('#/requests?status=5xx'));
  });
});
