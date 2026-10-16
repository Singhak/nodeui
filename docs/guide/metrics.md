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

| Endpoint                                        | Purpose                                           |
| ----------------------------------------------- | ------------------------------------------------- |
| `GET /api/timeseries?range=<ms>&points=<n>`     | history window ending now, or `from=<ms>&to=<ms>` |
| `GET /api/runs`                                 | saved runs and any active recording               |
| `POST /api/runs/start` `{name}`                 | begin recording                                   |
| `POST /api/runs/stop`                           | stop and save                                     |
| `POST /api/runs/save` `{name, fromMs, toMs}`    | save an already-recorded range                    |
| `POST /api/runs/delete` `{id}`                  | delete a run                                      |
| `GET /api/prometheus`                           | Prometheus text format                            |
| `GET /api/routemetrics`                         | per-route latency, errors and trend               |
| `POST /api/replay`                              | re-send a request to the app (nonce required)     |
| `GET /api/alerts`                               | alert rules, state and history                    |
| `POST /api/alerts/add` / `remove`               | manage alert rules                                |
| `POST /api/annotations/add` / `remove`          | chart markers                                     |
| `GET /api/cpu-profile`                          | CPU profile state and result                      |
| `POST /api/cpu-profile/start` / `stop`          | record a CPU profile (start needs a nonce)        |
| `GET /api/loadtest`                             | built-in load generator status                    |
| `POST /api/loadtest/start` / `stop`             | fire load at the app (start needs a nonce)        |
| `POST /api/runs/baseline` `{id}`                | pin or clear the baseline run                     |
| `GET /api/runs/export`, `POST /api/runs/import` | move runs between machines                        |

## Finding the slow endpoint

The **Endpoints** view (`#/endpoints`) keeps latency percentiles, 5xx rate and a five-minute sparkline for every route, sorted by total time spent, so the route that costs the most is at the top. Routes come from the framework's matched pattern (`/users/:id`); unmatched 404s are grouped as `(unmatched)` and at most 200 routes are tracked. **Reset stats** starts a clean slate before a test.

On Metrics, the **latency heatmap** shows every request by time and latency band (log scale), which reveals slow outliers and bimodal latency that percentiles hide.

## Why was this request slow?

Click a request in **Requests**. The drawer shows a waterfall of its queries, outgoing calls and log lines with a DB / HTTP / app time breakdown, and flags repeated statements (N+1). From there you can:

- **Replay…** edit the method, path, headers or body and re-send it to your app. The target is always the app's own listening address, never user input, and each replay needs a fresh confirmation nonce. Credentials are never stored, so add `Authorization` or `Cookie` yourself. If body capture is on, the new response is diffed against the original.
- **Copy as** curl, fetch or an autocannon command.

Filters (status, method, text, minimum duration) live in the URL, so **Copy link** shares a view; **Save view** keeps named filters in your browser.

## Budgets and alerts

Add rules in the **Alerts** view or in code:

```js
nodeui({
  alerts: [
    { metric: 'p99', threshold: 300 },
    { metric: 'errorRate', threshold: 1 },
  ],
});
```

Metrics: `p50`, `p95`, `p99`, `maxMs`, `errorRate` (%), `rps`, `loopP99`, `cpu` (%), `heapMb`, `rssMb`. A rule watches a 10 second window and fires after the condition has held for `forSeconds` (default 5). Latency and error rules need at least five requests in the window, so an idle app never fires. While a rule fires, a banner shows on every view and the tab title gets a marker.

### In CI

```sh
npx @singhak/nodeui-cli check --run latest --max-p99 300 --max-error-rate 1 --max-regression 10 http://127.0.0.1:3000
```

Exit code 0 means every budget held, 1 means one failed, 2 means there was nothing to check. `--max-regression` compares against the pinned baseline run.

## Baselines and persistence

Pin a run as the **baseline** in Load tests: every other run then shows p99 and throughput deltas, and selecting one run compares it with the baseline. **Export runs** / **Import runs** move runs between machines or branches. Runs survive a restart when `persist` or `runsFile` (`NODEUI_RUNS_FILE`) is set; otherwise they live in memory.

**Generate load** fires requests at a route from a worker thread (up to 100 connections for 60 s) and saves the result as a run. **Re-run** repeats it and opens the comparison. It shares CPU with your app, so use autocannon, k6 or wrk in another process when you need peak throughput.

## Markers

`server.annotate('deployed v2')` (or **Add marker** in Metrics) draws a vertical marker on every chart. Load-test boundaries and alerts add their own.

## Memory and CPU

The **Heap trend** tile looks at the lowest heap points in the window (what survives garbage collection) and warns when that floor keeps rising; it needs at least five minutes of history. It is a heuristic, not proof: confirm with a heap snapshot in Runtime.

The **Profiler** view records a CPU profile for 5 to 60 seconds (each start needs a confirmation nonce) and shows it as a flame graph plus the top functions by self time.

## Scraping with a real Grafana

`GET <path>/api/prometheus` exposes counters, an approximate latency histogram, memory, CPU and event-loop gauges, so you can scrape the console from Prometheus if you want dashboards beyond the built-in ones. Requests must still come from an allowed local address (see [Security](./security.md)).
