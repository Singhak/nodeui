#!/usr/bin/env node
import http from 'node:http';
import express from 'express';
import { nodeui } from '@singhak/nodeui-express';

const REQUESTS = 5000;
const WARMUP = 500;
const CONCURRENCY = 8;

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

function bench(port, requests, concurrency) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  const durations = [];
  let inflight = 0;
  let done = 0;

  return new Promise((resolvePromise) => {
    const tick = () => {
      while (inflight < concurrency) {
        inflight += 1;
        const started = process.hrtime.bigint();
        const req = http.get({ host: '127.0.0.1', port, path: '/hello', agent }, (res) => {
          res.resume();
          res.on('end', () => {
            inflight -= 1;
            durations.push(Number(process.hrtime.bigint() - started) / 1e6);
            done += 1;
            if (done >= requests) {
              agent.destroy();
              resolvePromise(durations);
            } else {
              tick();
            }
          });
        });
        req.on('error', () => {
          inflight -= 1;
          done += 1;
          if (done >= requests) resolvePromise(durations);
          else tick();
        });
      }
    };
    tick();
  });
}

function percentiles(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const baseline = await startApp(null);
  const enabled = await startApp(nodeui({ enabled: true, port: baseline.port }).middleware);
  const disabled = await startApp(nodeui({ enabled: false, port: baseline.port }).middleware);

  const scenarios = [
    ['baseline (no nodeui)', baseline.port],
    ['nodeui enabled', enabled.port],
    ['nodeui disabled (fail-closed)', disabled.port],
  ];

  const rows = [];
  for (const [label, port] of scenarios) {
    const durations = await bench(port, WARMUP + REQUESTS, CONCURRENCY);
    const samples = durations.slice(WARMUP);
    const sorted = [...samples].sort((a, b) => a - b);
    const totalMs = samples.reduce((a, b) => a + b, 0);
    const mean = totalMs / samples.length;
    rows.push({
      label,
      meanMs: mean.toFixed(2),
      p50Ms: percentiles(sorted, 50).toFixed(2),
      p95Ms: percentiles(sorted, 95).toFixed(2),
      p99Ms: percentiles(sorted, 99).toFixed(2),
      rps: Math.round(1000 / mean),
    });
  }

  console.log(`Requests: ${REQUESTS} per scenario, concurrency ${CONCURRENCY}\n`);
  console.log('Scenario                          mean    p50    p95    p99    rps');
  console.log('--------------------------------------------------------------------');
  for (const row of rows) {
    console.log(
      `${row.label.padEnd(32)} ${String(row.meanMs).padStart(5)} ${String(row.p50Ms).padStart(5)} ` +
        `${String(row.p95Ms).padStart(5)} ${String(row.p99Ms).padStart(5)} ${String(row.rps).padStart(6)}`,
    );
  }
  console.log('\nAll numbers in milliseconds per request.');

  for (const { server } of [baseline, enabled, disabled]) server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
