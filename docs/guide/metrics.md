# Metrics and load tests

NodeUI keeps a bounded **metrics history** so you can see how your app behaves over time, the way you would in Grafana, but with nothing to install.

## What is recorded

One sample per second for the last hour, and one per ten seconds for the last eight hours (a few MB of memory in total):

| Signal         | Detail                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Throughput     | requests/s, 5xx and 4xx counts, error rate                                                                                               |
| Latency        | p50 / p90 / p95 / p99 / max / avg, from a mergeable histogram (about 7% worst-case error), so percentiles stay correct at any zoom level |
| Concurrency    | peak requests in flight                                                                                                                  |
| Network        | bytes in and out per second, headers included                                                                                            |
| Event loop     | delay p50 / p99 / max (`perf_hooks`)                                                                                                     |
| Memory and CPU | heap used and total, RSS, process CPU %                                                                                                  |
| GC             | pause time and count                                                                                                                     |

Event-loop delay is timer based. Windows timers are coarse, so an idle process can read up to about 16 ms there.

## Metrics view

`#/metrics` shows these as linked charts. The crosshair is shared across charts, and you can **drag across any chart to zoom**. Pick a range (5m to 8h), pause to freeze the charts, and use **Save as run** to keep an interval for later comparison.

## Load tests view

`#/runs` records a named run while you fire traffic with autocannon, k6, wrk or anything else:

1. Enter a name and press **Start recording**.
2. Run your load test.
3. Press **Stop and save**.

Each run stores a summary (requests, throughput, latency percentiles, errors, event loop, CPU, memory peaks) and a compact series. Select one run for a report you can copy, or two runs for a side-by-side comparison with better/worse deltas and overlaid p99 and throughput charts. The first selected run is the baseline. Runs are kept in memory (up to 20) and are lost on restart.

Forgot to record? Zoom the Metrics view onto the interval and choose **Save as run**.

## Requests table

The live feed carries the newest 100 requests. Tick **Full buffer** to see everything held in the ring buffer. The buffer keeps the last `requestLogSize` requests (default 500), while the "since start" counter counts every request. For heavy load tests, raise `requestLogSize`.

The API also accepts `GET /api/requests?limit=<n>&offset=<n>` (limit up to 5000; offset skips that many of the newest entries).

## HTTP API

| Endpoint                                     | Purpose                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `GET /api/timeseries?range=<ms>&points=<n>`  | history window ending now, or `from=<ms>&to=<ms>` |
| `GET /api/runs`                              | saved runs and any active recording               |
| `POST /api/runs/start` `{name}`              | begin recording                                   |
| `POST /api/runs/stop`                        | stop and save                                     |
| `POST /api/runs/save` `{name, fromMs, toMs}` | save an already-recorded range                    |
| `POST /api/runs/delete` `{id}`               | delete a run                                      |
| `GET /api/prometheus`                        | Prometheus text format                            |

## Scraping with a real Grafana

`GET <path>/api/prometheus` exposes counters, an approximate latency histogram, memory, CPU and event-loop gauges, so you can scrape the console from Prometheus if you want dashboards beyond the built-in ones. Requests must still come from an allowed local address (see [Security](./security.md)).
