# Screenshots

The Express demo (`apps/demo-express`) running with generated traffic. The **Overview** answers "is the app healthy right now?" with KPI tiles (status, uptime, req/s, error rate, p95, heap, CPU, event-loop lag), live charts with hover values, status-code breakdown, slowest routes, dependency checks and recent errors.

![NodeUI Overview (dark)](../screenshots/overview-dark.png)

Light theme (follows your OS setting, with a toggle in the header):

![NodeUI Overview (light)](../screenshots/overview-light.png)

**Requests** view: p50/p95/p99, error rate, status/method filters, search, sortable columns filters kept in the URL and a detail drawer with the matched route, headers, captured body, _Copy as curl_ and _Replay_ (credentials and secret-looking body fields show as `[REDACTED]`).

![NodeUI Requests](../screenshots/requests.png)

**Errors** view: failures grouped by type, message shape and origin, with counts, the stack and the linked request.

![NodeUI Errors](../screenshots/errors.png)

**Queries** view: SQL statements with duration and rows, flagging slow statements and N+1 suspects (the same statement repeated within one request). **By statement** groups executions by normalized statement with calls, share of total time and p95.

![NodeUI Queries](../screenshots/queries.png)

**Metrics** view: one hour of history at 1 s and eight hours at 10 s, with a range picker, drag-to-zoom, a shared crosshair, a heap-trend tile and markers (the triangles) for load-test runs, alerts and your own `server.annotate()` calls.

![NodeUI Metrics](../screenshots/metrics.png)

The **latency heatmap** shows every request by time and latency band; here `/slow` is the thin bright band near 200 ms that percentiles alone would hide.

![NodeUI Latency heatmap](../screenshots/heatmap.png)

**Endpoints** view: p50/p95/p99, 5xx rate, a throughput trend and the share of total time per route, so the costliest endpoint is on top.

![NodeUI Endpoints](../screenshots/endpoints.png)

The **request drawer** now has Copy as curl/fetch/autocannon, **Replay…**, and a waterfall of the queries, outgoing calls and logs behind the request.

![NodeUI Request waterfall](../screenshots/request-waterfall.png)

**Load tests** view: generate load or record autocannon/k6/wrk, pin a baseline, and compare runs with better/worse deltas and overlaid charts.

![NodeUI Load test comparison](../screenshots/load-tests.png)

**Profiler** view: a CPU profile recorded under load, as a flame graph with a top-functions table.

![NodeUI Profiler](../screenshots/profiler.png)

**Alerts** view: threshold rules, live state and fired/resolved history. A banner shows on every view while a rule fires.

![NodeUI Alerts](../screenshots/alerts.png)

Notice that secrets are masked everywhere: `DATABASE_URL`, `JWT_SECRET` and `STRIPE_API_KEY` show as `[REDACTED]`, and the log line `token=abc123` is scrubbed to `token=[REDACTED]`. Use the sidebar to switch between Overview, Metrics, Load tests, Profiler, Alerts, Endpoints, Requests, Outgoing, Queries, Errors, Logs, Environment, Routes, Runtime and your own plugin panels; the Pause button freezes the display so you can read it.
