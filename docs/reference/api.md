# REST and SSE API

All JSON endpoints return an envelope format:

```json
{
  "ok": true,
  "data": { ... }
}
```

| Method | Endpoint             | Description                                                       |
| :----- | :------------------- | :---------------------------------------------------------------- |
| `GET`  | `/api/health`        | Overall health state, PID, uptime, Node version, and current lag. |
| `GET`  | `/api/memory`        | Process memory stats (RSS, heapUsed, heapTotal, external).        |
| `GET`  | `/api/cpu`           | Process CPU percentages (total, user, system).                    |
| `GET`  | `/api/event-loop`    | Current, maximum, and average event-loop lag times.               |
| `GET`  | `/api/requests`      | Recent HTTP traffic buffer and aggregate metrics.                 |
| `GET`  | `/api/outgoing`      | Recent outgoing HTTP calls with status and duration.              |
| `GET`  | `/api/queries`       | Recent database queries with slow and N+1 flags.                  |
| `GET`  | `/api/errors`        | Grouped errors with counts, stacks and last request.              |
| `GET`  | `/api/routes`        | Declared routes (Express, Fastify, NestJS, Hapi, Hono).           |
| `GET`  | `/api/logs`          | Captured console logs buffer with timestamp and level.            |
| `GET`  | `/api/env`           | Masked environment variables and app configurations.              |
| `GET`  | `/api/startup`       | Startup timeline marks registered via `server.mark()`.            |
| `GET`  | `/api/metrics`       | Per-second request and error buckets for the last minute.         |
| `GET`  | `/api/config`        | Effective (non-secret) configuration, panel list and plugin meta. |
| `GET`  | `/api/<plugin-id>`   | Output of each registered custom panel (`plugins` option).        |
| `GET`  | `/api/live`          | **Server-Sent Events (SSE)** real-time metric stream.             |
| `POST` | `/api/confirmations` | Issues a single-use cryptographic token for mutating actions.     |
| `POST` | `/api/heap-snapshot` | Takes a V8 heap snapshot (requires `x-nodeui-confirm` header).    |

## Metrics, runs and tools

| Method | Endpoint                                                                                | Description                                                                                    |
| :----- | :-------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `GET`  | `/api/timeseries`                                                                       | Metrics history (`range`, `from`/`to`, `points`, `heatmap=1`) with annotations and heap trend. |
| `GET`  | `/api/routemetrics`                                                                     | Per-route latency percentiles, errors and trend.                                               |
| `GET`  | `/api/runs`                                                                             | Saved load-test runs, the active recording and the baseline id.                                |
| `POST` | `/api/runs/start`, `/stop`, `/save`, `/delete`, `/baseline`, `/import`, `/reset-routes` | Manage runs.                                                                                   |
| `GET`  | `/api/runs/export`                                                                      | All saved runs as a JSON download.                                                             |
| `GET`  | `/api/prometheus`                                                                       | Prometheus text exposition for a local Grafana.                                                |
| `GET`  | `/api/alerts`                                                                           | Alert rules, state and fired/resolved history.                                                 |
| `POST` | `/api/alerts/add`, `/remove`                                                            | Manage alert rules.                                                                            |
| `POST` | `/api/annotations/add`, `/remove`                                                       | Chart markers.                                                                                 |
| `GET`  | `/api/cpu-profile`                                                                      | CPU profile state and result.                                                                  |
| `POST` | `/api/cpu-profile/start`, `/stop`                                                       | Record a CPU profile (start needs `x-nodeui-confirm`).                                         |
| `GET`  | `/api/heap-profile`                                                                     | Sampling heap profile state and result (live allocations by function).                         |
| `POST` | `/api/heap-profile/start`, `/stop`                                                      | Record a heap allocation profile (start needs `x-nodeui-confirm`).                             |
| `GET`  | `/api/diagnose`                                                                         | Rule-based findings over the last 5 minutes, each with evidence and a next step.               |
| `GET`  | `/api/loadtest`                                                                         | Built-in load generator status.                                                                |
| `POST` | `/api/loadtest/start`, `/stop`                                                          | Fire load at the app (start needs `x-nodeui-confirm`).                                         |
| `POST` | `/api/replay`                                                                           | Re-send a captured request to the app (needs `x-nodeui-confirm`).                              |

Actions marked as needing `x-nodeui-confirm` take a fresh single-use nonce from `POST /api/confirmations`.
