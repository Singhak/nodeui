# Benchmarks

`npm run bench` (`scripts/bench.mjs`) runs scenarios in **alternating rounds** so machine drift hits each one equally, and reports the median across rounds plus the min–max spread. Sample run: Node 24, Express 5, 7 rounds × 3,000 requests, concurrency 8, trivial JSON handler, loopback.

| Scenario                        |     p50 (min–max)     |    p95    |    p99    | Throughput  |  p50 vs baseline   |
| :------------------------------ | :-------------------: | :-------: | :-------: | :---------: | :----------------: |
| **Baseline** _(no NodeUI)_      | `1.57 ms` (1.33–2.03) | `2.04 ms` | `2.75 ms` | `4,864 rps` |         —          |
| **Enabled** _(default capture)_ | `1.74 ms` (1.55–2.11) | `2.32 ms` | `3.30 ms` | `4,459 rps` |     `+0.18 ms`     |
| **Enabled + body capture**      | `1.80 ms` (1.62–4.89) | `2.39 ms` | `4.13 ms` | `4,280 rps` |     `+0.24 ms`     |
| **Disabled** _(fail-closed)_    | `1.54 ms` (1.34–1.98) | `1.89 ms` | `2.79 ms` | `5,081 rps` | `−0.03 ms` (noise) |

> [!NOTE]
> These scenarios run with `capture: 'lazy'` because the load generator shares the process; the always-on hook cost is measured by `npm run bench:hooks`. On a handler that does no work, enabling NodeUI costs roughly 0.2 ms per request (about 10% here); the absolute cost is what matters and it is fixed, not proportional, so it shrinks relative to real handlers. Differences inside the min–max spread are noise. NodeUI is meant for local development and staging, not as a production APM; re-run `npm run bench` on your hardware.
