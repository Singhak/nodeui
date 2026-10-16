import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import { layoutFlame } from '../src/charts/FlameGraph';
import type { CpuProfileData, FlameNode } from '../src/types';
import { defaultPayloads, json, resetEnv, stubApi } from './fixtures';

const node = (
  name: string,
  totalMs: number,
  selfMs: number,
  children: FlameNode[] = [],
  file = '',
): FlameNode => ({ name, file, line: 1, totalMs, selfMs, children });

const tree = node('(root)', 100, 0, [
  node(
    'handler',
    70,
    0,
    [node('hashPassword', 50, 50), node('queryDb', 20, 20)],
    'routes/users.js',
  ),
  node('(idle)', 30, 30),
]);

const done: CpuProfileData = {
  state: 'done',
  seconds: 10,
  startedAtMs: 1_700_000_000_000,
  finishedAtMs: 1_700_000_010_000,
  result: {
    durationMs: 10_000,
    totalMs: 100,
    idleMs: 30,
    sampleCount: 5000,
    tree,
    top: [
      { name: 'hashPassword', file: 'bcrypt/index.js', line: 20, selfMs: 50, share: 0.5 },
      { name: '(idle)', file: '', line: 0, selfMs: 30, share: 0.3 },
      { name: 'queryDb', file: 'src/db.js', line: 3, selfMs: 20, share: 0.2 },
    ],
  },
};

let profile: CpuProfileData;

function stub(): ReturnType<typeof vi.fn> {
  const payloads = defaultPayloads();
  (payloads['/config'] as { panels: string[] }).panels.push('cpu-profile');
  const base = stubApi(payloads);
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/cpu-profile')) return json({ ok: true, data: profile });
    if (url.endsWith('/cpu-profile/start')) {
      return json({ ok: true, data: { state: 'running', seconds: 20, startedAtMs: Date.now() } });
    }
    if (url.endsWith('/cpu-profile/stop')) return json({ ok: true, data: done });
    return base(input, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.stubGlobal('EventSource', undefined);
  resetEnv('#/profiler');
  profile = { state: 'idle' };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('layoutFlame', () => {
  it('sizes frames by total time and stacks children under their parent', () => {
    const cells = layoutFlame(tree);
    const byName = Object.fromEntries(cells.map((c) => [c.node.name, c]));
    expect(byName['(root)']).toMatchObject({ depth: 0, x0: 0, x1: 1 });
    expect(byName.handler).toMatchObject({ depth: 1, x0: 0, x1: 0.7 });
    expect(byName['(idle)']).toMatchObject({ depth: 1, x0: 0.7, x1: 1 });
    expect(byName.hashPassword).toMatchObject({ depth: 2, x0: 0, x1: 0.5 });
    expect(byName.queryDb).toMatchObject({ depth: 2, x0: 0.5, x1: 0.7 });
  });

  it('drops frames too thin to see', () => {
    const t = node('(root)', 1000, 0, [node('big', 999, 999), node('thin', 1, 1)]);
    expect(layoutFlame(t).map((c) => c.node.name)).toEqual(['(root)', 'big']);
  });
});

describe('Profiler view', () => {
  it('starts a profile with a confirmation nonce and the chosen duration', async () => {
    const fn = stub();
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Profile duration'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /Start profiling/ }));
    await waitFor(() => {
      const call = fn.mock.calls.find((c) => String(c[0]).endsWith('/cpu-profile/start'));
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ seconds: 20 });
      expect((call?.[1] as RequestInit).headers).toMatchObject({
        'x-nodeui-confirm': 'a'.repeat(32),
      });
    });
  });

  it('shows the countdown and a stop button while recording', async () => {
    profile = { state: 'running', seconds: 30, startedAtMs: Date.now() - 5000 };
    const fn = stub();
    render(<App />);
    expect(await screen.findByText(/Profiling/)).toBeInTheDocument();
    expect(screen.getByText(/s left/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Stop now/ }));
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]).endsWith('/cpu-profile/stop'))).toBe(true),
    );
  });

  it('renders KPIs, the flame graph and the hottest functions', async () => {
    profile = done;
    stub();
    render(<App />);
    expect(await screen.findByRole('img', { name: /Flame graph, 5 frames/ })).toBeInTheDocument();
    expect(screen.getByText('Busy').closest('[role="group"]')).toHaveTextContent('70%');
    const table = screen.getByRole('table', { name: 'Top functions by self time' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('hashPassword');
    expect(rows[0]).toHaveTextContent('50.0%');
    expect(screen.getByRole('button', { name: /handler/ })).toBeInTheDocument();
  });

  it('zooms into a frame and back out', async () => {
    profile = done;
    stub();
    render(<App />);
    await screen.findByRole('img', { name: /Flame graph/ });
    fireEvent.click(screen.getByRole('button', { name: /handler/ }));
    expect(await screen.findByText(/Zoomed into handler/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    await waitFor(() => expect(screen.queryByText(/Zoomed into/)).not.toBeInTheDocument());
  });

  it('shows the error when profiling failed', async () => {
    profile = { state: 'error', seconds: 10, startedAtMs: 1, error: 'inspector busy' };
    stub();
    render(<App />);
    expect(await screen.findByText(/inspector busy/)).toBeInTheDocument();
  });
});
