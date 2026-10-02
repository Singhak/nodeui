#!/usr/bin/env node
/**
 * Middleware overhead benchmark.
 *
 * Scenarios run in alternating rounds (A B C D A B C D ...) so machine drift
 * hits every scenario equally. Each scenario is reported as the median across
 * rounds of its per-round statistics, with the round-to-round spread, so
 * differences smaller than the spread should be read as noise.
 *
 * Env: BENCH_ROUNDS (default 7), BENCH_REQUESTS per round (default 3000),
 * BENCH_CONCURRENCY (default 8), BENCH_WARMUP (default 500).
 */
import http from 'node:http';
import express from 'express';
import { nodeui } from '@singhak/nodeui-express';

const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 7);
const REQUESTS = Number(process.env.BENCH_REQUESTS ?? 3000);
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 8);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 500);

function startApp(middleware) {
  const app = express();
  if (middleware) app.use(middleware);
  app.get('/hello', (_req, res) => res.json({ ok: true }));
  return new Promise((resolvePromise) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolvePromise({ server, port: server.address().port });
    });
  });
}

function run(port, total, concurrency) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  const durations = [];
  let started = 0;
  let finished = 0;
  const t0 = process.hrtime.bigint();

  return new Promise((resolvePromise) => {
    const launch = () => {
      if (started >= total) return;
      started += 1;
      const t = process.hrtime.bigint();
      const settle = () => {
        durations.push(Number(process.hrtime.bigint() - t) / 1e6);
        finished += 1;
        if (finished >= total) {
          agent.destroy();
          resolvePromise({
            durations,
            wallMs: Number(process.hrtime.bigint() - t0) / 1e6,
          });
        } else {
          launch();
        }
      };
      const req = http.get({ host: '127.0.0.1', port, path: '/hello', agent }, (res) => {
        res.resume();
        res.on('end', settle);
      });
      req.on('error', settle);
    };
    for (let i = 0; i < concurrency; i += 1) launch();
  });
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

async function main() {
  const baseline = await startApp(null);
  const bodies = nodeui({ enabled: true, captureRequestDetail: { bodies: true } });
  const apps = [
    { label: 'baseline (no nodeui)', app: baseline, rounds: [] },
    {
      label: 'nodeui enabled (defaults)',
      app: await startApp(nodeui({ enabled: true }).middleware),
      rounds: [],
    },
    {
      label: 'nodeui enabled + bodies',
      app: await startApp(bodies.middleware),
      rounds: [],
    },
    {
      label: 'nodeui disabled',
      app: await startApp(nodeui({ enabled: false }).middleware),
      rounds: [],
    },
  ];

  for (const s of apps) await run(s.app.port, WARMUP, CONCURRENCY);

  for (let round = 0; round < ROUNDS; round += 1) {
    for (const s of apps) {
      const { durations, wallMs } = await run(s.app.port, REQUESTS, CONCURRENCY);
      const sorted = [...durations].sort((a, b) => a - b);
      s.rounds.push({
        mean: durations.reduce((a, b) => a + b, 0) / durations.length,
        p50: pct(sorted, 50),
        p95: pct(sorted, 95),
        p99: pct(sorted, 99),
        rps: (durations.length / wallMs) * 1000,
      });
    }
  }

  const base = median(apps[0].rounds.map((r) => r.p50));
  console.log(
    `${ROUNDS} alternating rounds x ${REQUESTS} requests, concurrency ${CONCURRENCY}, ` +
      `node ${process.version}\n`,
  );
  console.log(
    'Scenario                       p50 ms (min-max)      p95    p99    rps    p50 vs base',
  );
  console.log('-'.repeat(86));
  for (const s of apps) {
    const p50s = s.rounds.map((r) => r.p50);
    const p50 = median(p50s);
    const delta = p50 - base;
    console.log(
      `${s.label.padEnd(30)} ${p50.toFixed(2).padStart(5)} (${Math.min(...p50s).toFixed(2)}-` +
        `${Math.max(...p50s).toFixed(2)})`.padEnd(14) +
        `${median(s.rounds.map((r) => r.p95))
          .toFixed(2)
          .padStart(7)} ${median(s.rounds.map((r) => r.p99))
          .toFixed(2)
          .padStart(6)} ${Math.round(median(s.rounds.map((r) => r.rps)))
          .toString()
          .padStart(6)}   ${(delta >= 0 ? '+' : '') + delta.toFixed(3)} ms`,
    );
  }
  console.log(
    '\nSingle machine, single process, loopback: treat deltas inside the min-max spread as noise.',
  );

  bodies.server.shutdown();
  for (const s of apps) s.app.server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
