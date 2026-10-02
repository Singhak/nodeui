import type { ReactNode } from 'react';
import { Sparkline } from '../Sparkline';

export type Tone = 'neutral' | 'good' | 'warn' | 'crit';

const TONE_ICON: Record<Tone, string> = { neutral: '', good: '✓', warn: '▲', crit: '✕' };

/** Headline tile: label, big value + unit, optional sparkline and caption. */
export function Kpi({
  label,
  value,
  unit,
  caption,
  spark,
  tone = 'neutral',
  toneLabel,
  testId,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  caption?: ReactNode;
  spark?: number[];
  tone?: Tone;
  /** Text paired with the tone icon (never colour alone). */
  toneLabel?: string;
  testId?: string;
}) {
  return (
    <div className={`kpi kpi-${tone}`} role="group" aria-label={label} data-testid={testId}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        <span className="kpi-num">{value}</span>
        {unit ? <span className="kpi-unit">{unit}</span> : null}
      </div>
      <div className="kpi-caption">
        {tone !== 'neutral' ? (
          <span className={`kpi-tone kpi-tone-${tone}`}>
            <span aria-hidden="true">{TONE_ICON[tone]}</span> {toneLabel}
          </span>
        ) : null}
        {caption}
      </div>
      {spark ? <Sparkline values={spark} /> : null}
    </div>
  );
}
