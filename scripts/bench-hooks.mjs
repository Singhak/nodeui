#!/usr/bin/env node
/**
 * Cost of the always-on capture hooks (`capture: 'always'`): per-call time of an
 * outgoing http request, a console.log and a pg-style query wrapper, with the
 * hooks off and on. Run in alternating rounds; reports medians.
 *
 * Env: BENCH_ROUNDS (default 9), BENCH_CALLS (default 2000).
 */
import http from 'node:http';
import { createNodeUI } from '@singhak/nodeui-core';

const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 9);
const CALLS = Number(process.env.BENCH_CALLS ?? 2000);

const upstream = http.createServer((_req, res) => res.end('ok'));
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const port = upstream.address().port;
const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });

const once = () =>
  new Promise((resolve, reject) => {
    http
      .request({ host: '127.0.0.1', port, path: '/', agent }, (res) => {
        res.resume();
        res.on('end', resolve);
      })
      .on('error', reject)
      .end();
  });

async function httpUsPerCall() {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < CALLS; i += 1) await once();
  return Number(process.hrtime.bigint() - t0) / 1e3 / CALLS;
}

function logUsPerCall() {
  const n = CALLS * 10;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i += 1) console.log('GET /users/42 200', i);
  return Number(process.hrtime.bigint() - t0) / 1e3 / n;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = { off: { http: [], log: [] }, on: { http: [], log: [] } };

await httpUsPerCall();
for (let round = 0; round < ROUNDS; round += 1) {
  for (const mode of ['off', 'on']) {
    // Silence console.log with a no-op that NodeUI then wraps, so only the hook is timed.
    const realLog = console.log;
    console.log = () => undefined;
    const server = mode === 'on' ? createNodeUI({ enabled: true, capture: 'always' }) : null;
    results[mode].http.push(await httpUsPerCall());
    results[mode].log.push(logUsPerCall());
    server?.shutdown();
    console.log = realLog;
  }
}

const row = (name, key) => {
  const off = median(results.off[key]);
  const on = median(results.on[key]);
  console.log(
    `${name.padEnd(22)} off ${off.toFixed(2)} µs   on ${on.toFixed(2)} µs   +${(on - off).toFixed(2)} µs`,
  );
};
row('outgoing http.request', 'http');
row('console.log', 'log');
agent.destroy();
upstream.close();
