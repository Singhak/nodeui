import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { formatClock, formatSpan } from '../format';
import type { Pt } from '../telemetry';

export interface ChartSeries {
  id: string;
  name: string;
  /** CSS colour, normally a `var(--series-N)` token. */
  color: string;
  /** Dash pattern: a second encoding besides colour. */
  dash?: string;
  area?: boolean;
  points: Pt[];
}

/** 0-based "nice" tick values covering `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(10)));
  return ticks;
}

/** Index of the point whose `t` is closest to `t` (points sorted by t). */
export function nearestIndex(points: Pt[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((points[mid] as Pt).t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs((points[lo - 1] as Pt).t - t) <= Math.abs((points[lo] as Pt).t - t)) {
    return lo - 1;
  }
  return lo;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = (): void => {
      const w = node.clientWidth;
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const M = { l: 54, r: 14, t: 20, b: 24 };

/**
 * Hand-rolled SVG line/area chart: recessive gridlines, labelled axes, unit
 * label, legend (>=2 series), pointer + keyboard crosshair with tooltip, and a
 * data-table alternative.
 */
export function LineChart({
  series,
  title,
  unit,
  format,
  tickFormat,
  height = 200,
  yMax,
  emptyText = 'Waiting for data…',
}: {
  series: ChartSeries[];
  title: string;
  /** Unit label drawn above the y axis (e.g. `req/s`, `MB`, `%`). */
  unit: string;
  /** Exact value formatting for tooltip/legend. */
  format: (v: number) => string;
  /** Compact formatting for axis ticks; defaults to `format`. */
  tickFormat?: (v: number) => string;
  height?: number;
  /** Lower bound for the y domain maximum (so tiny values do not fill the plot). */
  yMax?: number;
  emptyText?: string;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [idx, setIdx] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const uid = useId();

  const primary = useMemo(() => series.find((s) => s.points.length > 0)?.points ?? [], [series]);
  const hasData = primary.length > 0;

  const dom = useMemo(() => {
    let t0 = Infinity;
    let t1 = -Infinity;
    let max = 0;
    for (const s of series) {
      for (const p of s.points) {
        if (p.t < t0) t0 = p.t;
        if (p.t > t1) t1 = p.t;
        if (p.v > max) max = p.v;
      }
    }
    if (!Number.isFinite(t0)) return { t0: 0, t1: 1, ticks: [0, 1] };
    if (t1 === t0) t1 = t0 + 1000;
    return { t0, t1, ticks: niceTicks(Math.max(max, yMax ?? 0)) };
  }, [series, yMax]);

  const plotW = Math.max(50, width - M.l - M.r);
  const plotH = height - M.t - M.b;
  const top = dom.ticks[dom.ticks.length - 1] as number;
  const x = (t: number): number => M.l + ((t - dom.t0) / (dom.t1 - dom.t0)) * plotW;
  const y = (v: number): number => M.t + plotH - (v / (top || 1)) * plotH;
  const tf = tickFormat ?? format;

  const xTicks = useMemo(() => {
    const n = Math.max(2, Math.min(5, Math.floor(plotW / 110)));
    return Array.from({ length: n }, (_, i) => dom.t0 + ((dom.t1 - dom.t0) * i) / (n - 1));
  }, [dom, plotW]);

  const paths = series.map((s) => {
    const pts = s.points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
    const line = pts.length ? `M${pts.join('L')}` : '';
    const first = s.points[0];
    const last = s.points[s.points.length - 1];
    const area =
      s.area && first && last
        ? `${line}L${x(last.t).toFixed(1)},${y(0).toFixed(1)}L${x(first.t).toFixed(1)},${y(0).toFixed(1)}Z`
        : '';
    return { line, area };
  });

  const safeIdx = idx !== null && idx < primary.length ? idx : null;
  const hoverT = safeIdx !== null ? (primary[safeIdx] as Pt).t : null;
  const hoverRows =
    hoverT === null
      ? []
      : series
          .map((s) => {
            const i = nearestIndex(s.points, hoverT);
            return i >= 0 ? { s, p: s.points[i] as Pt } : null;
          })
          .filter((r): r is { s: ChartSeries; p: Pt } => r !== null);

  const onMove = (e: PointerEvent<SVGRectElement>): void => {
    if (!hasData) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / (box.width || 1)) * plotW;
    const t = dom.t0 + (px / plotW) * (dom.t1 - dom.t0);
    setIdx(nearestIndex(primary, t));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!hasData) return;
    const last = primary.length - 1;
    if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, (i ?? last + 1) - 1));
    else if (e.key === 'ArrowRight') setIdx((i) => Math.min(last, (i ?? -1) + 1));
    else if (e.key === 'Home') setIdx(0);
    else if (e.key === 'End') setIdx(last);
    else if (e.key === 'Escape') setIdx(null);
    else return;
    e.preventDefault();
  };

  const range = hasData
    ? `${formatClock(dom.t0)} – ${formatClock(dom.t1)} · ${formatSpan(dom.t1 - dom.t0)}`
    : '';
  const tipLeft = hoverT !== null ? x(hoverT) : 0;
  const flip = tipLeft > width * 0.6;

  return (
    <figure className="chart" aria-label={title}>
      {series.length > 1 || range ? (
        <div className="chart-meta">
          {series.length > 1 ? (
            <ul className="legend">
              {series.map((s) => {
                const last = s.points[s.points.length - 1];
                return (
                  <li key={s.id}>
                    <svg width="22" height="10" aria-hidden="true">
                      <line
                        x1="1"
                        y1="5"
                        x2="21"
                        y2="5"
                        stroke={s.color}
                        strokeWidth="2.5"
                        strokeDasharray={s.dash}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span>{s.name}</span>
                    {last ? <span className="legend-val">{format(last.v)}</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <span />
          )}
          <span className="chart-range">{range}</span>
        </div>
      ) : null}
      <div
        className="chart-body"
        ref={wrapRef}
        tabIndex={0}
        role="group"
        aria-label={`${title}. Use left and right arrow keys to inspect values.`}
        onKeyDown={onKey}
        onBlur={() => setIdx(null)}
      >
        <svg width={width} height={height} role="img" aria-label={`${title} line chart`}>
          <text x="0" y="10" className="axis-unit">
            {unit}
          </text>
          {dom.ticks.map((tk) => (
            <g key={tk}>
              <line
                x1={M.l}
                x2={M.l + plotW}
                y1={y(tk)}
                y2={y(tk)}
                className={tk === 0 ? 'axis-line' : 'grid-line'}
              />
              <text x={M.l - 8} y={y(tk) + 4} textAnchor="end" className="axis-text">
                {tf(tk)}
              </text>
            </g>
          ))}
          {hasData
            ? xTicks.map((t, i) => (
                <text
                  key={i}
                  x={x(t)}
                  y={height - 6}
                  textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                  className="axis-text"
                >
                  {formatClock(t)}
                </text>
              ))
            : null}
          {series.map((s, i) => (
            <g key={s.id}>
              {s.area && paths[i]?.area ? (
                <>
                  <defs>
                    <linearGradient id={`${uid}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={s.color} stopOpacity="0.28" />
                      <stop offset="1" stopColor={s.color} stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  <path d={paths[i]?.area} fill={`url(#${uid}-${s.id})`} stroke="none" />
                </>
              ) : null}
              <path
                d={paths[i]?.line}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dash}
              />
            </g>
          ))}
          {hoverT !== null ? (
            <g pointerEvents="none">
              <line x1={x(hoverT)} x2={x(hoverT)} y1={M.t} y2={M.t + plotH} className="crosshair" />
              {hoverRows.map(({ s, p }) => (
                <circle
                  key={s.id}
                  cx={x(p.t)}
                  cy={y(p.v)}
                  r="4.5"
                  fill={s.color}
                  className="hover-dot"
                />
              ))}
            </g>
          ) : null}
          {hasData ? (
            <rect
              x={M.l}
              y={M.t}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setIdx(null)}
            />
          ) : null}
        </svg>
        {!hasData ? <div className="chart-empty">{emptyText}</div> : null}
        {hoverT !== null && hoverRows.length > 0 ? (
          <div
            className="tooltip"
            role="status"
            style={{
              left: flip ? undefined : tipLeft + 12,
              right: flip ? width - tipLeft + 12 : undefined,
              top: M.t,
            }}
          >
            <div className="tooltip-time">{formatClock(hoverT)}</div>
            {hoverRows.map(({ s, p }) => (
              <div key={s.id} className="tooltip-row">
                <svg width="14" height="8" aria-hidden="true">
                  <line
                    x1="1"
                    y1="4"
                    x2="13"
                    y2="4"
                    stroke={s.color}
                    strokeWidth="2.5"
                    strokeDasharray={s.dash}
                    strokeLinecap="round"
                  />
                </svg>
                <span>{s.name}</span>
                <strong>{format(p.v)}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <details className="chart-data" onToggle={(e) => setShowTable(e.currentTarget.open)}>
        <summary>Data table</summary>
        {showTable ? (
          <div className="table-wrap" style={{ maxHeight: 200 }}>
            <table className="table">
              <caption className="sr-only">{title} values</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  {series.map((s) => (
                    <th key={s.id} scope="col" className="num">
                      {s.name} ({unit})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {primary
                  .slice(-15)
                  .reverse()
                  .map((p) => (
                    <tr key={p.t}>
                      <td className="mono nowrap">{formatClock(p.t)}</td>
                      {series.map((s) => {
                        const i = nearestIndex(s.points, p.t);
                        return (
                          <td key={s.id} className="num mono">
                            {i >= 0 ? format((s.points[i] as Pt).v) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </details>
    </figure>
  );
}
