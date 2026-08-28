export function Sparkline({
  values,
  width = 140,
  height = 36,
  stroke = '#5eead4',
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (values.length === 0) {
    return (
      <svg width={width} height={height} className="sparkline" aria-hidden="true">
        <line x1="0" y1={height - 2} x2={width} y2={height - 2} className="sparkline-baseline" />
      </svg>
    );
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const step = width / (values.length - 1 || 1);
  const points = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 6)).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg width={width} height={height} className="sparkline" aria-hidden="true">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}
