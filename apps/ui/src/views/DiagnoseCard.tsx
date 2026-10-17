import { getPanel } from '../api';
import { Card } from '../components/common';
import { usePolledPanel } from '../hooks';
import { hrefFor } from '../router';
import type { DiagnoseData, DiagnoseFinding } from '../types';

const ICON = { critical: '✕', warning: '▲', info: 'ℹ' } as const;
const TONE = {
  critical: 'status-critical',
  warning: 'status-degraded',
  info: 'status-ok',
} as const;

function Finding({ f }: { f: DiagnoseFinding }) {
  return (
    <li className="diagnose-row">
      <span className={`status-pill ${TONE[f.severity]}`}>
        <span aria-hidden="true">{ICON[f.severity]}</span> {f.severity}
      </span>
      <div>
        <strong>{f.title}</strong>
        <p className="muted-text">{f.detail}</p>
        <p>
          {f.hint}
          {f.view ? (
            <>
              {' '}
              <a href={hrefFor(f.view)}>Open {f.view}</a>
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}

/** Rule-based read of the last few minutes: names the likely problem class. */
export function DiagnoseCard() {
  const poll = usePolledPanel<DiagnoseData>(
    'diagnose',
    () => getPanel<DiagnoseData>('/diagnose'),
    5000,
  );
  const data = poll.data;
  if (!data) return null;

  let body;
  if (data.status === 'collecting') {
    body = (
      <p className="muted-text">Collecting history. A diagnosis needs about a minute of data.</p>
    );
  } else if (data.findings.length === 0) {
    body = (
      <p>
        <span className="status-pill status-ok">
          <span aria-hidden="true">✓</span> Healthy
        </span>{' '}
        No event-loop stalls, GC pressure, leaks or error spikes in the last{' '}
        {Math.round(data.windowSeconds / 60)} minutes.
      </p>
    );
  } else {
    body = (
      <ul className="diagnose-list">
        {data.findings.map((f) => (
          <Finding key={f.id} f={f} />
        ))}
      </ul>
    );
  }
  return (
    <Card title="Diagnosis" subtitle="what the last few minutes of metrics suggest">
      {body}
    </Card>
  );
}
