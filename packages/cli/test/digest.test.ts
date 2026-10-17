import { describe, expect, it } from 'vitest';
import { buildDigest } from '../src/digest';

const base = {
  service: 'api',
  health: null,
  requests: null,
  errors: null,
  queries: null,
  outgoing: null,
};

describe('buildDigest diagnosis', () => {
  it('lists findings with severity and next step', () => {
    const text = buildDigest({
      ...base,
      diagnose: {
        status: 'critical',
        windowSeconds: 300,
        findings: [
          {
            id: 'event-loop-blocked',
            severity: 'critical',
            title: 'Event loop blocked by CPU-heavy work',
            detail: 'Loop delay p99 exceeded 100 ms.',
            hint: 'Record a CPU profile.',
          },
        ],
      },
    });
    expect(text).toContain('## Performance diagnosis');
    expect(text).toContain('[critical] Event loop blocked by CPU-heavy work');
    expect(text).toContain('Next: Record a CPU profile.');
  });

  it('omits the section when nothing was found', () => {
    const text = buildDigest({
      ...base,
      diagnose: { status: 'ok', windowSeconds: 300, findings: [] },
    });
    expect(text).not.toContain('Performance diagnosis');
  });
});
