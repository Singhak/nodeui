import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const built = existsSync(join(__dirname, '..', 'dist', 'index.cjs'));
const fixture = join(__dirname, 'fixtures', 'otel-child.cjs');

interface Seen {
  otel?: number;
  nodeui?: number;
}
interface Result {
  one: Required<Seen>;
  two?: Required<Seen>;
  afterStop?: Seen;
  afterOtelDisable?: Seen;
}

// Each scenario runs in its own process, as in a real app: OpenTelemetry hooks `require()`
// and patches `http` globally, so scenarios cannot share a process with each other or the runner.
function run(scenario: string): Result {
  const out = execFileSync(process.execPath, [fixture, scenario], {
    encoding: 'utf8',
    timeout: 30_000,
    cwd: join(__dirname, '..'),
  });
  return JSON.parse(out) as Result;
}

describe.skipIf(!built)('alongside the real @opentelemetry/instrumentation-http', () => {
  it('both record a call when OpenTelemetry is installed first', () => {
    expect(run('otel-first').one).toEqual({ otel: 1, nodeui: 1 });
  });

  it('both record a call when NodeUI is installed first', () => {
    expect(run('nodeui-first').one).toEqual({ otel: 1, nodeui: 1 });
  });

  it('stopping NodeUI leaves OpenTelemetry tracing', () => {
    expect(run('otel-first').afterStop).toEqual({ otel: 1 });
  });

  it('disabling OpenTelemetry leaves NodeUI recording', () => {
    expect(run('nodeui-first').afterOtelDisable).toEqual({ nodeui: 1 });
  });

  it('restarting NodeUI neither double-records nor drops OpenTelemetry', () => {
    const result = run('restart');
    expect(result.one).toEqual({ otel: 1, nodeui: 1 });
    expect(result.two).toEqual({ otel: 1, nodeui: 1 });
  });
});
