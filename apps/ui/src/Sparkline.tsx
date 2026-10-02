/** Compact trend line that scales to its container; decorative (the tile carries the value). */
export function Sparkline({
  values,
  height = 30,
  color = 'var(--series-1)',
}: {
  values: number[];
  height?: number;
  color?: string;
}) {
  const W = 100;
  if (values.length < 2) {
    return (
      <svg
        className="sparkline"
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        height={height}
        aria-hidden="true"
      >
        <line
          x1="0"
          x2={W}
          y1={height - 2}
          y2={height - 2}
          className="sparkline-baseline"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  const max = Math.max(...values, 1e-9);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = W / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 3 - ((v - min) / range) * (height - 6)]);
  const line = pts.map(([px, py]) => `${(px as number).toFixed(2)},${(py as number).toFixed(2)}`);
  const area = `M${line.join('L')}L${W},${height}L0,${height}Z`;
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      height={height}
      aria-hidden="true"
    >
      <path d={area} fill={color} opacity="0.14" />
      <polyline
        points={line.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
