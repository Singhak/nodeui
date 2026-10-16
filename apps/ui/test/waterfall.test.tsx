import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { computeBreakdown, Waterfall, type WaterfallItem } from '../src/views/Waterfall';

const START = 1_000_000;

const item = (over: Partial<WaterfallItem>): WaterfallItem => ({
  key: 'k',
  at: START,
  durationMs: 0,
  kind: 'query',
  label: 'select 1',
  detail: 'pg · 5 ms',
  failed: false,
  ...over,
});

afterEach(cleanup);

describe('computeBreakdown', () => {
  it('splits time into db, http and the remainder', () => {
    const b = computeBreakdown(
      [
        item({ key: 'a', at: START + 10, durationMs: 20, kind: 'query' }),
        item({ key: 'b', at: START + 40, durationMs: 30, kind: 'outgoing' }),
      ],
      START,
      100,
    );
    expect(b).toEqual({ totalMs: 100, dbMs: 20, httpMs: 30, appMs: 50 });
  });

  it('counts overlapping calls once so app time never goes negative', () => {
    const b = computeBreakdown(
      [
        item({ key: 'a', at: START, durationMs: 60, kind: 'query' }),
        item({ key: 'b', at: START + 10, durationMs: 60, kind: 'query' }),
        item({ key: 'c', at: START + 50, durationMs: 100, kind: 'outgoing' }),
      ],
      START,
      100,
    );
    expect(b.dbMs).toBe(70);
    expect(b.appMs).toBe(0);
  });

  it('ignores log lines (no duration) and clips to the request', () => {
    const b = computeBreakdown(
      [
        item({ key: 'l', kind: 'log', durationMs: 0 }),
        item({ key: 'q', at: START - 20, durationMs: 40, kind: 'query' }),
      ],
      START,
      100,
    );
    expect(b.dbMs).toBe(20);
    expect(b.appMs).toBe(80);
  });
});

describe('Waterfall', () => {
  it('shows the breakdown, bars for calls and a dot for logs', () => {
    const { container } = render(
      <Waterfall
        startMs={START}
        durationMs={100}
        items={[
          item({ key: 'q', at: START + 5, durationMs: 30, detail: 'pg · 30 ms · N+1' }),
          item({
            key: 'o',
            at: START + 40,
            durationMs: 50,
            kind: 'outgoing',
            label: 'GET http://x',
          }),
          item({ key: 'l', at: START + 95, kind: 'log', label: 'done', detail: 'info' }),
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Time breakdown' })).toHaveTextContent('DB 30.0 ms');
    expect(screen.getByRole('group', { name: 'Time breakdown' })).toHaveTextContent('HTTP 50.0 ms');
    expect(screen.getByText('1 repeated queries (N+1)')).toBeInTheDocument();
    expect(container.querySelectorAll('.wf-bar-query')).toHaveLength(1);
    expect(container.querySelectorAll('.wf-bar-outgoing')).toHaveLength(1);
    expect(container.querySelectorAll('.wf-dot')).toHaveLength(1);
    expect(screen.getByText('+40 ms')).toBeInTheDocument();
  });
});
