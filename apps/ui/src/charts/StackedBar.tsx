export interface Segment {
  id: string;
  label: string;
  count: number;
  color: string;
}

/**
 * Single horizontal stacked bar with a 2px surface gap between segments and a
 * labelled legend row with exact counts (identity never rests on colour alone).
 */
export function StackedBar({ segments, title }: { segments: Segment[]; title: string }) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  return (
    <div className="stacked">
      <div className="stacked-bar" role="img" aria-label={`${title}: ${total} total`}>
        {total === 0 ? <div className="stacked-empty" /> : null}
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <div
              key={s.id}
              className="stacked-seg"
              style={{ flexGrow: s.count, background: s.color }}
              title={`${s.label}: ${s.count} (${((s.count / total) * 100).toFixed(1)}%)`}
            />
          ))}
      </div>
      <ul className="stacked-legend">
        {segments.map((s) => (
          <li key={s.id}>
            <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
            <span className="stacked-label">{s.label}</span>
            <strong className="mono">{s.count}</strong>
            <span className="muted-text mono">
              {total > 0 ? `${((s.count / total) * 100).toFixed(0)}%` : '0%'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
