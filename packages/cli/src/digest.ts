import type {
  ErrorsData,
  HealthData,
  OutgoingData,
  QueriesData,
  RequestEntry,
  RequestsData,
} from '@singhak/nodeui-core';

export interface DigestInput {
  service: string;
  health: HealthData | null;
  requests: RequestsData | null;
  errors: ErrorsData | null;
  queries: QueriesData | null;
  outgoing: OutgoingData | null;
}

const ms = (n: number): string => `${n.toFixed(n < 10 ? 1 : 0)} ms`;
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

function routeOf(r: RequestEntry): string {
  return `${r.method} ${r.route ?? r.path}`;
}

/**
 * A compact, prioritised Markdown summary of one service for an AI agent:
 * what is broken first, then what is slow, then context. Everything in it is
 * already masked by the console; this only selects and orders.
 */
export function buildDigest(input: DigestInput): string {
  const out: string[] = [`# ${input.service}`];
  const { health, requests, errors, queries, outgoing } = input;

  if (health) {
    out.push(
      `Health: **${health.status}**${health.statusReason ? ` (${oneLine(health.statusReason)})` : ''}; ` +
        `up ${Math.round(health.uptimeSeconds)}s; event-loop lag ${health.eventLoopLagMs ?? '?'} ms; ` +
        `memory ${health.memoryUsedPercent ?? '?'}%.`,
    );
    const failing = health.checks.filter((c) => c.status === 'down');
    for (const c of failing) out.push(`- dependency check \`${c.name}\` is down`);
  }

  const problems: string[] = [];
  if (errors && errors.groups.length > 0) {
    const groups = [...errors.groups].sort((a, b) => b.lastSeenMs - a.lastSeenMs).slice(0, 5);
    problems.push('## Errors (most recent first)');
    for (const g of groups) {
      problems.push(
        `- **${g.name}: ${clip(oneLine(g.message), 160)}** x${g.count}` +
          `${g.lastRoute ? ` on \`${g.lastRoute}\`` : ''}` +
          `${g.lastRequestId !== undefined ? `, request #${g.lastRequestId}` : ''}` +
          ` [${g.source}]; top frame: \`${clip(oneLine(g.stack.split('\n')[1] ?? ''), 140)}\``,
      );
    }
  }

  if (requests) {
    const s = requests.summary;
    out.push(
      `Traffic: ${s.count} recent requests, ${(s.errorRate * 100).toFixed(1)}% 5xx, ` +
        `p50 ${ms(s.p50Ms)}, p95 ${ms(s.p95Ms)}, p99 ${ms(s.p99Ms)}.`,
    );
    const failed = requests.entries.filter((r) => r.status >= 500).slice(-5);
    if (failed.length > 0) {
      problems.push('## Failing requests');
      for (const r of failed) {
        problems.push(`- #${r.id} ${routeOf(r)} -> ${r.status} in ${ms(r.durationMs)}`);
      }
    }
    const slow = [...s.routes].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 3);
    if (slow.length > 0) {
      problems.push('## Slowest routes (by p95)');
      for (const r of slow) {
        problems.push(
          `- ${r.method} ${r.path}: p95 ${ms(r.p95Ms)}, avg ${ms(r.avgMs)}, ${r.count} calls, ${r.errors} errors`,
        );
      }
    }
  }

  if (queries && (queries.slow > 0 || queries.nPlusOneGroups > 0 || queries.failed > 0)) {
    problems.push(
      `## Database: ${queries.slow} slow (>= ${queries.slowQueryMs} ms), ` +
        `${queries.nPlusOneGroups} N+1 suspects, ${queries.failed} failed`,
    );
    const interesting = queries.entries.filter((q) => q.slow || q.nPlusOne || q.error).slice(-5);
    for (const q of interesting) {
      const flags = [q.slow && 'slow', q.nPlusOne && `N+1 x${q.repeats ?? '?'}`, q.error && 'error']
        .filter(Boolean)
        .join(', ');
      problems.push(
        `- [${flags}] ${ms(q.durationMs)}${q.requestId !== undefined ? `, request #${q.requestId}` : ''}: \`${clip(oneLine(q.sql), 160)}\``,
      );
    }
  }

  if (outgoing && outgoing.failed > 0) {
    problems.push(`## Outgoing calls: ${outgoing.failed} failed`);
    for (const o of outgoing.entries.filter((e) => e.error || (e.status ?? 0) >= 500).slice(-5)) {
      problems.push(
        `- ${o.method} ${o.url} -> ${o.error ?? o.status}${o.requestId !== undefined ? `, request #${o.requestId}` : ''}`,
      );
    }
  }

  out.push(
    problems.length > 0
      ? problems.join('\n')
      : 'No errors, failing requests, slow or N+1 queries, or failing outgoing calls were observed.',
  );
  return out.join('\n\n');
}
