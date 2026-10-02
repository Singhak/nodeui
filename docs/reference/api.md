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
