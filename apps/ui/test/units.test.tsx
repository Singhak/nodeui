import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { currentRate, mergeBuckets, pushPoint } from '../src/telemetry';
import { LineChart, nearestIndex, niceTicks } from '../src/charts/LineChart';
import { hrefFor, parseHash } from '../src/router';
import { formatSeconds } from '../src/format';
import { sortRows, type Column } from '../src/components/DataTable';

describe('telemetry rings', () => {
  it('pushPoint keeps a bounded window and ignores repeated timestamps', () => {
    let pts = pushPoint([], { t: 0, v: 1 }, 1000);
    pts = pushPoint(pts, { t: 500, v: 2 }, 1000);
    pts = pushPoint(pts, { t: 500, v: 3 }, 1000);
    expect(pts).toHaveLength(2);
    pts = pushPoint(pts, { t: 2000, v: 4 }, 1000);
    expect(pts.map((p) => p.t)).toEqual([2000]);
  });

  it('mergeBuckets dedupes by timestamp and trims old buckets', () => {
    const a = [
      { ts: 1000, requests: 1, errors: 0 },
      { ts: 2000, requests: 1, errors: 0 },
    ];
    const b = [
      { ts: 2000, requests: 5, errors: 1 },
      { ts: 5000, requests: 2, errors: 0 },
    ];
    const merged = mergeBuckets(a, b, 3500);
    expect(merged.map((x) => x.ts)).toEqual([2000, 5000]);
    expect(merged[0]?.requests).toBe(5);
  });

  it('currentRate ignores the still-filling last bucket', () => {
    const buckets = [
      { ts: 1, requests: 4, errors: 0 },
      { ts: 2, requests: 2, errors: 0 },
      { ts: 3, requests: 100, errors: 0 },
    ];
    expect(currentRate(buckets)).toBe(3);
    expect(currentRate([])).toBeNull();
  });
});

describe('chart helpers', () => {
  it('niceTicks starts at 0 and covers the max', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    const t = niceTicks(87);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(87);
  });

  it('nearestIndex finds the closest point', () => {
    const pts = [
      { t: 0, v: 0 },
      { t: 10, v: 0 },
      { t: 20, v: 0 },
    ];
    expect(nearestIndex(pts, 4)).toBe(0);
    expect(nearestIndex(pts, 16)).toBe(2);
    expect(nearestIndex([], 1)).toBe(-1);
  });

  it('LineChart shows an empty message without data', () => {
    const { getByText } = render(
      <LineChart
        title="x"
        unit="u"
        series={[{ id: 'a', name: 'A', color: 'red', points: [] }]}
        format={String}
      />,
    );
    expect(getByText('Waiting for data…')).toBeInTheDocument();
  });
});

describe('router, format and sorting', () => {
  it('parses and builds hashes', () => {
    expect(parseHash('#/custom/my%20panel')).toEqual(['custom', 'my panel']);
    expect(parseHash('')).toEqual([]);
    expect(hrefFor('custom', 'a b')).toBe('#/custom/a%20b');
  });

  it('formats uptime', () => {
    expect(formatSeconds(42)).toBe('42s');
    expect(formatSeconds(3725)).toBe('1h 2m');
  });

  it('sortRows is stable and respects direction', () => {
    const cols: Column<{ n: number }>[] = [
      { key: 'n', label: 'n', render: (r) => r.n, sortValue: (r) => r.n },
    ];
    const rows = [{ n: 2 }, { n: 1 }, { n: 3 }];
    expect(sortRows(rows, cols, { key: 'n', dir: 'asc' }).map((r) => r.n)).toEqual([1, 2, 3]);
    expect(sortRows(rows, cols, { key: 'n', dir: 'desc' }).map((r) => r.n)).toEqual([3, 2, 1]);
  });
});
