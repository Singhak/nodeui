import type { HealthStatus } from '../types';

export const STATUS_ICON: Record<HealthStatus, string> = {
  ok: '✓',
  degraded: '▲',
  critical: '✕',
  unknown: '?',
};

export const STATUS_LABEL: Record<HealthStatus, string> = {
  ok: 'Healthy',
  degraded: 'Degraded',
  critical: 'Critical',
  unknown: 'Unknown',
};

/** Status pill: colour + icon + text, never colour alone. */
export function StatusPill({ status, label }: { status: HealthStatus; label?: string }) {
  return (
    <span className={`status-pill status-${status}`}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span> {label ?? STATUS_LABEL[status]}
    </span>
  );
}

const CLASS_ICON: Record<number, string> = { 2: '✓', 3: '→', 4: '!', 5: '✕' };

export function StatusCode({ status }: { status: number | null }) {
  if (status === null) return <span className="status-code status-code-0">—</span>;
  const cls = Math.floor(status / 100);
  return (
    <span className={`status-code status-code-${cls}`}>
      <span aria-hidden="true">{CLASS_ICON[cls] ?? '·'}</span> {status}
    </span>
  );
}

export function MethodBadge({ method }: { method: string }) {
  return <span className={`method-badge method-${method.toLowerCase()}`}>{method}</span>;
}
