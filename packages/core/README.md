# @nodeui/core

Framework-neutral engine for the NodeUI developer console: observability
providers, the REST contract, the safety gate, and the static console server.
The Express and NestJS adapters build on this package; you normally consume
those instead of using `@nodeui/core` directly.

## Providers

Each provider exposes one panel through `GET {path}/api/{id}`:

| id              | Panel          | Notes                                            |
| --------------- | -------------- | ------------------------------------------------ |
| `health`        | Health         | Derives status from event-loop + memory samples. |
| `memory`        | Memory         | Samples process + OS memory on start.            |
| `cpu`           | CPU            | Process CPU percent from `/proc`-style clocks.   |
| `event-loop`    | Event-loop lag | Drift vs. a 1ms `setInterval`, last 600 samples. |
| `heap-snapshot` | Heap snapshot  | Writes `nodeui-heap-<pid>-<ts>.heapsnapshot`.    |
| `startup`       | Startup        | Timing marks recorded via `server.mark(name)`.   |
| `requests`      | Requests       | Ring buffer of app HTTP requests (default 500).  |

## API

All endpoints live under `{path}/api` and return
`{ ok: true, data } | { ok: false, error: { code, message } }`:

- `GET /config` — effective configuration.
- `GET /{provider-id}` — panel data for the seven ids above.
- `POST /confirmations` — issue a single-use nonce.
- `POST /heap-snapshot` — capture a snapshot; must send
  `x-nodeui-confirm: <nonce>` from a fresh confirmation. A missing, expired, or
  replayed nonce returns `409` with error code `confirmation-required`.

`GET /` serves the bundled React console with an SPA fallback to `index.html`.

## Safety

- **Activation:** active when `NODE_ENV` is non-production, or when
  `NODEUI_ENABLED=true` forces it; fail-closed in production.
- **Loopback-only:** remote hosts are rejected with `403`.
- **Secret masking:** keys matching `TOKEN|KEY|SECRET|PASSWORD` have their
  values replaced with `[REDACTED]` in every API payload.
- **Read-only default:** the heap snapshot is the only mutating action and is
  gated behind a fresh nonce.
- **Zero-cost when disabled:** the middleware is a pass-through; no timers or
  hooks are created.

## Configuration

Environment variables are read at `createNodeUI()` time (overridable via the
`options.env` map for tests):

| Variable                       | Default     | Description                       |
| ------------------------------ | ----------- | --------------------------------- |
| `NODEUI_ENABLED`               | unset       | Force activation (`true`).        |
| `NODEUI_HOST`                  | `127.0.0.1` | Loopback host the console trusts. |
| `NODEUI_PATH`                  | `/nodeui`   | URL prefix for console + API.     |
| `NODEUI_REQUEST_LOG_SIZE`      | `500`       | Request ring-buffer capacity.     |
| `NODEUI_POLL_INTERVAL_MS`      | `2000`      | Sampling interval.                |
| `NODEUI_INACTIVITY_TIMEOUT_MS` | `60000`     | Provider idle timeout.            |
| `NODEUI_CONFIRM_TTL_MS`        | `60000`     | Nonce lifetime.                   |
| `NODEUI_HEAP_SNAPSHOT_DIR`     | OS tmpdir   | Snapshot output directory.        |

## Usage

```ts
import { createNodeUI, type NodeUIServer } from '@nodeui/core';

const server: NodeUIServer = createNodeUI();
const middleware = server.middleware();
// middleware is (req, res, next) => void; mount it before your routes.
server.mark('listening');
server.shutdown();
```

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run (unit + e2e)
npm run build       # emit dist/
```
