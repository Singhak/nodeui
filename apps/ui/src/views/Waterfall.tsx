import { formatDuration } from '../format';

export interface WaterfallItem {
  key: string;
  /** Absolute start time (ms epoch). */
  at: number;
  /** 0 for point events such as log lines. */
  durationMs: number;
  kind: 'outgoing' | 'log' | 'query';
  label: string;
  detail: string;
  failed: boolean;
}

export interface Breakdown {
  totalMs: number;
  dbMs: number;
  httpMs: number;
  /** Time not covered by any query or outgoing call (your own code, waiting, I/O). */
  appMs: number;
}

/** Total length of the union of [start, end] intervals (overlaps counted once). */
function unionMs(intervals: Array<[number, number]>): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const [s, e] of sorted) {
    if (s > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

/** Splits the request duration into database, outgoing HTTP and everything else. */
export function computeBreakdown(
  items: readonly WaterfallItem[],
  startMs: number,
  durationMs: number,
): Breakdown {
  const clip = (i: WaterfallItem): [number, number] => [
    Math.max(0, i.at - startMs),
    Math.min(durationMs, i.at - startMs + i.durationMs),
  ];
  const range = (kind: WaterfallItem['kind'] | 'any'): Array<[number, number]> =>
    items
      .filter((i) => i.durationMs > 0 && (kind === 'any' || i.kind === kind))
      .map(clip)
      .filter(([s, e]) => e > s);
  const covered = unionMs(range('any'));
  return {
    totalMs: durationMs,
    dbMs: unionMs(range('query')),
    httpMs: unionMs(range('outgoing')),
    appMs: Math.max(0, durationMs - covered),
  };
}

const KIND_LABEL = { outgoing: 'out', query: 'sql', log: 'log' } as const;

/**
 * Gantt-style view of one request: its queries, outgoing calls and log lines on
 * a shared time axis, so the slow step stands out at a glance.
 */
export function Waterfall({
  items,
  startMs,
  durationMs,
}: {
  items: readonly WaterfallItem[];
  startMs: number;
  durationMs: number;
}) {
  const spanEnd = items.reduce(
    (max, i) => Math.max(max, i.at - startMs + i.durationMs),
    durationMs,
  );
  const total = Math.max(1, spanEnd);
  const pct = (ms: number): number => Math.min(100, Math.max(0, (ms / total) * 100));
  const b = computeBreakdown(items, startMs, durationMs);
  const nPlusOne = items.filter((i) => i.kind === 'query' && i.detail.includes('N+1')).length;

  return (
    <>
      <div className="wf-summary" role="group" aria-label="Time breakdown">
        <span className="wf-chip wf-db">DB {formatDuration(b.dbMs)}</span>
        <span className="wf-chip wf-http">HTTP {formatDuration(b.httpMs)}</span>
        <span className="wf-chip wf-app">App {formatDuration(b.appMs)}</span>
        <span className="muted-text">of {formatDuration(durationMs)}</span>
        {nPlusOne > 0 ? (
          <span className="wf-chip wf-warn">{nPlusOne} repeated queries (N+1)</span>
        ) : null}
      </div>
      <div className="wf-axis" aria-hidden="true">
        <span>0</span>
        <span>{formatDuration(total)}</span>
      </div>
      <ol className="waterfall">
        <li className="wf-row wf-request" aria-label="Request">
          <span className="wf-name">request</span>
          <span className="wf-track">
            <span
              className="wf-bar wf-bar-request"
              style={{ left: 0, width: `${pct(durationMs)}%` }}
            />
          </span>
          <span className="wf-time mono">{formatDuration(durationMs)}</span>
        </li>
        {items.map((i) => {
          const offset = Math.max(0, i.at - startMs);
          return (
            <li key={i.key} className={`wf-row${i.failed ? ' row-failed' : ''}`}>
              <span className="wf-name">
                <strong>{KIND_LABEL[i.kind]}</strong>{' '}
                <span className="mono" title={i.label}>
                  {i.label}
                </span>
              </span>
              <span className="wf-track">
                {i.durationMs > 0 ? (
                  <span
                    className={`wf-bar wf-bar-${i.kind}`}
                    style={{
                      left: `${pct(offset)}%`,
                      width: `${Math.max(0.6, pct(i.durationMs))}%`,
                    }}
                  />
                ) : (
                  <span className="wf-dot" style={{ left: `${pct(offset)}%` }} />
                )}
              </span>
              <span className="wf-time mono">
                +{Math.round(offset)} ms
                <span className="muted-text"> {i.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
