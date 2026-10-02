# @singhak/nodeui-core

Framework-neutral engine for the NodeUI developer console: observability
providers, the REST contract, the safety gate, and the static console server.
The Express, Fastify and NestJS adapters build on this package; you normally
consume those instead of using `@singhak/nodeui-core` directly. Use core
directly to integrate a framework without an adapter (Koa, Hono, plain `http`).

## Providers

Each provider exposes one panel through `GET {path}/api/{id}`:

| id              | Panel          | Notes                                                      |
| --------------- | -------------- | ---------------------------------------------------------- |
| `health`        | Health         | Event-loop + memory status, plus your `healthChecks`.      |
| `memory`        | Memory         | Samples process + OS memory on start.                      |
| `cpu`           | CPU            | Process CPU percent from `process.cpuUsage()`.             |
| `event-loop`    | Event-loop lag | Drift vs. a 1ms `setInterval`, last 600 samples.           |
| `heap-snapshot` | Heap snapshot  | Writes `nodeui-heap-<pid>-<ts>.heapsnapshot` (owner-only). |
| `startup`       | Startup        | Timing marks recorded via `server.mark(name)`.             |
| `requests`      | Requests       | Ring buffer of app HTTP requests (default 500).            |
| `metrics`       | Metrics        | Requests/errors per second for the last minute.            |
| `env`           | Environment    | `process.env` + your `config`, masked.                     |
| `routes`        | Routes         | Express router introspection, or `server.setRoutes()`.     |
| `logs`          | Logs           | `console.*` capture plus `server.addLogSource()`.          |
| `outgoing`      | Outgoing HTTP  | `http`/`https`/`fetch` calls made by the app.              |
| _your id_       | _your title_   | Custom panels via the `plugins` option (see below).        |

## API

All endpoints live under `{path}/api` and return
`{ ok: true, data } | { ok: false, error: { code, message } }`:

- `GET /config` — effective configuration, panel list and plugin titles.
- `GET /{panel-id}` — panel data for every id above.
- `GET /live?panels=a,b` — Server-Sent Events stream (capped by `maxSseClients`).
- `POST /confirmations` — issue a single-use nonce.
- `POST /heap-snapshot` — capture a snapshot; must send
  `x-nodeui-confirm: <nonce>` from a fresh confirmation. A missing, expired, or
  replayed nonce returns `409` with error code `confirmation-required`.

`GET /` serves the bundled React console with an SPA fallback to `index.html`.

## Safety

- **Activation:** active when `NODE_ENV` is non-production, or when
  `NODEUI_ENABLED=true` forces it; fail-closed in production (a warning is logged if forced on).
- **Loopback-only:** remote hosts are rejected with `403`. Extra clients can be allow-listed
  (`allowedRemoteAddresses`, exact IPs or IPv4 CIDRs, e.g. the Docker bridge).
- **Host / Origin validation:** blocks DNS-rebinding and cross-site requests. Extra names via
  `allowedHosts` / `allowedOrigins`. `X-Forwarded-*` requests are rejected unless `trustProxy`.
- **Access token (optional):** `authToken` / `NODEUI_TOKEN`; send `Authorization: Bearer <token>`,
  or open `{path}/?token=<token>` once to get an HttpOnly cookie.
- **Secret masking:** values under keys such as `token`, `key`, `secret`, `password`, `auth`,
  `cookie`, `dsn`, `database_url` are replaced with `[REDACTED]`; credentials inside text
  (URLs, bearer tokens, JWTs, `password=...`) are scrubbed too, in REST and SSE. Disable with
  `maskSecrets: false`.
- **Headers:** CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` on every response.
- **Read-only default:** the heap snapshot is the only mutating action and is
  gated behind a fresh nonce.
- **Zero-cost when disabled:** the middleware is a pass-through; no timers or
  hooks are created.

## Configuration

Environment variables are read at `createNodeUI()` time (overridable via the
`options.env` map for tests); each also has a typed option of the same meaning.

| Variable                       | Default             | Description                              |
| ------------------------------ | ------------------- | ---------------------------------------- |
| `NODEUI_ENABLED`               | unset               | Force activation (`true`) / disable.     |
| `NODEUI_HOST`                  | `127.0.0.1`         | Loopback host the console trusts.        |
| `NODEUI_PATH`                  | `/nodeui`           | URL prefix for console + API.            |
| `NODEUI_REQUEST_LOG_SIZE`      | `500`               | Request ring-buffer capacity.            |
| `NODEUI_LOG_SIZE`              | `500`               | Log ring-buffer capacity.                |
| `NODEUI_POLL_INTERVAL_MS`      | `2000`              | Sampling interval.                       |
| `NODEUI_INACTIVITY_TIMEOUT_MS` | `60000`             | Provider idle timeout.                   |
| `NODEUI_CONFIRM_TTL_MS`        | `60000`             | Nonce lifetime.                          |
| `NODEUI_HEAP_SNAPSHOT_DIR`     | `<tmp>/nodeui-heap` | Snapshot output directory.               |
| `NODEUI_TOKEN`                 | unset               | Require an access token.                 |
| `NODEUI_ALLOWED_HOSTS`         | unset               | Comma-separated extra `Host` names.      |
| `NODEUI_ALLOWED_ORIGINS`       | unset               | Comma-separated extra `Origin` values.   |
| `NODEUI_ALLOWED_REMOTE`        | unset               | Comma-separated client IPs / IPv4 CIDRs. |
| `NODEUI_TRUST_PROXY`           | `false`             | Accept `X-Forwarded-*` requests.         |
| `NODEUI_MAX_SSE_CLIENTS`       | `10`                | Concurrent live streams.                 |

## Usage

```ts
import { createNodeUI, type NodeUIServer } from '@singhak/nodeui-core';

const server: NodeUIServer = createNodeUI({
  plugins: [{ id: 'queues', title: 'Queues', get: async () => ({ ok: true, data: await jobs() }) }],
  healthChecks: { db: () => pool.query('select 1') },
});
const middleware = server.middleware();
// middleware is (req, res, next) => void; mount it before your routes.
server.mark('listening');
server.shutdown();
```

Plugin ids are lowercase letters, digits and `-`, and must not collide with a built-in panel.
Without an Express router, feed the routes panel with `server.setRoutes([...])`.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run (unit + e2e)
npm run build       # emit dist/
```
