import { useEffect, useRef, useState } from 'react';
import { formatClock, formatDuration } from '../format';
import type { LatencyHeatmap } from '../types';

const HEIGHT = 200;

interface Hover {
  col: number;
  row: number;
  x: number;
  y: number;
}

/** Index of the row whose bucket first reaches the value (for the axis labels). */
function rowLabelIndexes(rows: number): number[] {
  if (rows <= 1) return [0];
  const wanted = Math.min(5, rows);
  const out = new Set<number>();
  for (let i = 0; i < wanted; i += 1) out.add(Math.round((i * (rows - 1)) / (wanted - 1)));
  return [...out];
}

/**
 * Time x latency heatmap: each column is a time window, each row a latency band
 * (log scale, fastest at the bottom) and brightness shows how many requests fell
 * in that cell. Reveals bimodal latency and slow outliers that percentiles hide.
 */
export function Heatmap({ heatmap }: { heatmap: LatencyHeatmap }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const cols = heatmap.times.length;
  const rows = heatmap.rowUpperMs.length;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx || cols === 0 || rows === 0) return;
    const width = canvas.clientWidth || 600;
    canvas.width = width;
    canvas.height = HEIGHT;
    ctx.clearRect(0, 0, width, HEIGHT);
    const css = getComputedStyle(canvas);
    const base = css.getPropertyValue('--series-1').trim() || '#4f8cff';
    let max = 1;
    for (const col of heatmap.cells) for (const v of col) if (v > max) max = v;
    const cw = width / cols;
    const rh = HEIGHT / rows;
    ctx.fillStyle = base;
    for (let c = 0; c < cols; c += 1) {
      const col = heatmap.cells[c] as number[];
      for (let r = 0; r < rows; r += 1) {
        const v = col[r] as number;
        if (v <= 0) continue;
        // sqrt keeps sparse slow outliers visible next to a dense fast band
        ctx.globalAlpha = 0.12 + 0.88 * Math.sqrt(v / max);
        ctx.fillRect(Math.floor(c * cw), HEIGHT - (r + 1) * rh, Math.ceil(cw) + 0.5, Math.ceil(rh));
      }
    }
    ctx.globalAlpha = 1;
  }, [heatmap, cols, rows]);

  const onMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || cols === 0) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.min(cols - 1, Math.max(0, Math.floor((x / rect.width) * cols)));
    const row = Math.min(rows - 1, Math.max(0, rows - 1 - Math.floor((y / HEIGHT) * rows)));
    setHover({ col, row, x, y });
  };

  if (cols === 0 || rows === 0) {
    return <p className="chart-empty">No requests in this range.</p>;
  }

  const hoverCount = hover ? ((heatmap.cells[hover.col] as number[])[hover.row] as number) : 0;
  const lower = hover ? (hover.row === 0 ? 0 : (heatmap.rowUpperMs[hover.row - 1] as number)) : 0;
  const upper = hover ? (heatmap.rowUpperMs[hover.row] as number) : 0;

  return (
    <div className="heatmap">
      <div className="heatmap-axis" aria-hidden="true" style={{ height: HEIGHT }}>
        {rowLabelIndexes(rows).map((i) => (
          <span key={i} style={{ bottom: `${((i + 0.5) / rows) * 100}%` }}>
            {formatDuration(heatmap.rowUpperMs[i] as number)}
          </span>
        ))}
      </div>
      <div
        className="heatmap-plot"
        ref={wrapRef}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Latency heatmap: ${cols} time windows, ${rows} latency bands`}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: HEIGHT }} />
        {hover ? (
          <div
            className="heatmap-tip"
            style={{
              left: Math.min(hover.x + 12, (wrapRef.current?.clientWidth ?? 400) - 190),
              top: hover.y + 12,
            }}
          >
            <strong>{formatClock(heatmap.times[hover.col] as number)}</strong>
            <span>
              {formatDuration(lower)} – {formatDuration(upper)}
            </span>
            <span>{hoverCount.toLocaleString()} requests</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
