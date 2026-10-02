# Configuration

## Programmatic Options

Passed to `nodeui(options)` or `NodeUIModule.register(options)`:

| Option                   | Type                                                       | Default                                                             | Description                                                                                                    |
| :----------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------- |
| `path`                   | `string`                                                   | `'/nodeui'`                                                         | Base route prefix where console UI and API are mounted.                                                        |
| `host`                   | `string`                                                   | `'127.0.0.1'`                                                       | Allowed host interface for incoming requests.                                                                  |
| `enabled`                | `boolean`                                                  | `env-based`                                                         | Explicitly enable (`true`) or disable (`false`) console.                                                       |
| `maskSecrets`            | `boolean`                                                  | `true`                                                              | Automatically redact sensitive environment and config values.                                                  |
| `requestLogSize`         | `number`                                                   | `500`                                                               | In-memory capacity for HTTP request logs.                                                                      |
| `captureRequestDetail`   | `boolean \| { query, headers, bodies, maxBodyBytes }`      | `{ query: true, headers: true, bodies: false, maxBodyBytes: 4096 }` | What extra detail is recorded per request. `false` records none. Textual bodies only, masked and size-capped.  |
| `queryLogSize`           | `number`                                                   | `200`                                                               | In-memory capacity for recorded database queries.                                                              |
| `slowQueryMs`            | `number`                                                   | `100`                                                               | Queries at or above this duration are flagged slow.                                                            |
| `capture`                | `'always' \| 'lazy'`                                       | `'always'`                                                          | Run outgoing / query / log capture from startup, or only while a panel is open. See [Capture](/guide/capture). |
| `persist`                | `string \| { file, maxBytes }`                             | `off`                                                               | Journal recent activity to an NDJSON file and restore it on restart. See [Persistence](/guide/persistence).    |
| `otlp`                   | `string \| { endpoint, serviceName, headers, intervalMs }` | `off`                                                               | Export spans to an OTLP/HTTP collector. See [OpenTelemetry export](/guide/opentelemetry).                      |
| `logSize`                | `number`                                                   | `500`                                                               | In-memory capacity for captured console messages.                                                              |
| `pollIntervalMs`         | `number`                                                   | `2000`                                                              | Sampler collection interval for CPU and event-loop lag.                                                        |
| `inactivityTimeoutMs`    | `number`                                                   | `60000`                                                             | Idling timeout before background samplers pause.                                                               |
| `confirmTtlMs`           | `number`                                                   | `60000`                                                             | Expiration window for mutation confirmation nonces.                                                            |
| `heapSnapshotDir`        | `string`                                                   | `<tmp>/nodeui-heap`                                                 | Destination directory where `.heapsnapshot` files are written.                                                 |
| `allowedHosts`           | `string[]`                                                 | `[]`                                                                | Extra `Host` header names accepted besides loopback names.                                                     |
| `allowedOrigins`         | `string[]`                                                 | `[]`                                                                | Extra `Origin` values accepted for cross-origin calls.                                                         |
| `allowedRemoteAddresses` | `string[]`                                                 | `[]`                                                                | Extra client IPs / IPv4 and IPv6 CIDRs accepted (e.g. Docker bridge).                                          |
| `trustProxy`             | `boolean`                                                  | `false`                                                             | Accept requests carrying `X-Forwarded-*` headers.                                                              |
| `authToken`              | `string`                                                   | `undefined`                                                         | Require this token (`Authorization: Bearer`, cookie or `?token=`).                                             |
| `maxSseClients`          | `number`                                                   | `10`                                                                | Concurrent live-stream connections allowed.                                                                    |
| `plugins`                | `NodeUIProvider[]`                                         | `[]`                                                                | Custom panels.                                                                                                 |
| `healthChecks`           | `Record<string, () => unknown>`                            | `{}`                                                                | Dependency checks shown in the Health panel.                                                                   |
| `outgoingLogSize`        | `number`                                                   | `200`                                                               | Capacity of the outgoing HTTP call buffer.                                                                     |
| `config`                 | `object \| fn`                                             | `undefined`                                                         | Custom metadata object or getter to display in the Environment panel.                                          |

## Environment Variables

| Variable                       | Default             | Purpose                                                      |
| :----------------------------- | :------------------ | :----------------------------------------------------------- |
| `NODEUI_ENABLED`               | `unset`             | Set to `true` to force-enable (or `false` to force-disable). |
| `NODEUI_PATH`                  | `/nodeui`           | Prefix for web UI and API.                                   |
| `NODEUI_HOST`                  | `127.0.0.1`         | Loopback address validation target.                          |
| `NODEUI_POLL_INTERVAL_MS`      | `2000`              | Polling sampling rate in milliseconds.                       |
| `NODEUI_INACTIVITY_TIMEOUT_MS` | `60000`             | Inactivity timer before providers stop background polling.   |
| `NODEUI_REQUEST_LOG_SIZE`      | `500`               | Capacity of the request circular buffer.                     |
| `NODEUI_LOG_SIZE`              | `500`               | Capacity of the console log circular buffer.                 |
| `NODEUI_OTLP_ENDPOINT`         | `unset`             | OTLP/HTTP collector base URL (e.g. `http://localhost:4318`). |
| `NODEUI_CAPTURE`               | `always`            | `lazy` installs capture hooks only while a panel is open.    |
| `NODEUI_PERSIST_FILE`          | `unset`             | Journal file for persistence across restarts.                |
| `NODEUI_CAPTURE_BODIES`        | `false`             | `true` records masked request/response bodies.               |
| `NODEUI_CONFIRM_TTL_MS`        | `60000`             | Nonce validity duration.                                     |
| `NODEUI_HEAP_SNAPSHOT_DIR`     | `<tmp>/nodeui-heap` | Snapshot output directory.                                   |
| `NODEUI_TOKEN`                 | `unset`             | Require this access token.                                   |
| `NODEUI_ALLOWED_HOSTS`         | `unset`             | Comma-separated extra `Host` names.                          |
| `NODEUI_ALLOWED_ORIGINS`       | `unset`             | Comma-separated extra `Origin` values.                       |
| `NODEUI_ALLOWED_REMOTE`        | `unset`             | Comma-separated client IPs / IPv4 and IPv6 CIDRs.            |
| `NODEUI_TRUST_PROXY`           | `false`             | `true` accepts `X-Forwarded-*` requests.                     |
| `NODEUI_MAX_SSE_CLIENTS`       | `10`                | Concurrent live streams.                                     |
