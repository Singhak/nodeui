# NodeUI Phase 1 — Observability Expansion

Date: 2026-08-20
Status: Approved
Branch: `260818-feat-nodeui-console`

## Goal

Extend the existing NodeUI console (BootUI-inspired, local-only developer console for Express/NestJS) with six observability features delivered as one coherent release:

1. Server-Sent Events (SSE) live push
2. Environment/config viewer panel
3. Route listing panel
4. RPS + error-rate chart
5. Log viewer panel (console interception + logger adapter)
6. Per-panel JSON/CSV export

## Non-Goals (deferred)

- Database query logging (Prisma/TypeORM/Sequelize) — Phase 2
- Outgoing HTTP/DNS instrumentation — Phase 2
- Custom user panels (plugin API) — Phase 2
- Alerting, load simulation, multi-instance view — Phase 3

## Architecture Overview

All changes live inside the existing monorepo (`packages/core`, `packages/express`, `packages/nestjs`, `apps/ui`, demo apps). The provider contract `{ ok: true, data } | { ok: false, error: { code, message } }` is unchanged. SSE reuses the same envelope serialization as REST so UI types work for both transports. Provider laziness and inactivity timeout are preserved.

## Feature 1 — SSE Live Push

**Endpoint**: `GET {path}/api/live?panels=health,memory,cpu,event-loop,startup,requests,env,routes,logs,metrics`

- Server pushes a `message` event containing the serialized panel envelope every poll interval (2s default) for each subscribed panel.
- Heartbeat comment (`:ping`) every 15s keeps the connection alive.
- No new dependencies — native Node http streaming is used.
- Client subscribes on mount; falls back to existing REST polling when SSE disconnects or errors.
- Subscribing via SSE activates the provider (lazy lifecycle unchanged); inactivity timeout still applies.
- On client disconnect, subscriptions are cleaned up.
- On provider error, the error envelope is pushed (UI renders the inline panel error).

**UI**: a `useSSE(panels)` hook in `apps/ui/src/hooks.ts` manages the `EventSource`, dispatches envelopes to per-panel state, and handles reconnect with backoff.

## Feature 2 — Environment/Config Viewer

**Provider id**: `env`

- Reads `process.env` at view time, masked via the existing `maskSecrets` (`token|key|secret|password|credential` pattern → `[REDACTED]`).
- App config: `createNodeUI({ config })` accepts a static object or a getter function (getter re-evaluated per fetch). Also masked.
- Payload: `{ environment: { key, value }[], config: { key, value }[] | null }` — arrays so the UI can sort/search.

**Panel**: searchable table (key/value), masked values styled as `[REDACTED]`, copy-value button.

## Feature 3 — Route Listing

**Provider id**: `routes`

- Walks the mounted Express router stack recursively: for each `layer.route`, extract method(s) + path + handler name; recurse into nested `layer.handle.stack` routers.
- Works for plain Express and NestJS (NestJS shares the underlying Express `_router`).
- Skips middleware-only layers and 405/OPTIONS-only layers.
- Payload: `{ routes: { method, path, handler }[] }`, deduped, sorted by path.

**Panel**: table of method badge + path + handler, with a filter box.

## Feature 4 — RPS + Error-Rate Chart

**Provider id**: `metrics`

- Server keeps 60 one-second buckets `{ ts, requests, errors }`.
- The existing request recorder ticks the current bucket on each recorded request.
- Empty seconds are included (zero-filled) so the chart is contiguous.
- Payload: `{ buckets: { ts, requests, errors }[] }` (last 60s).

**Panel**: the Requests panel gains a chart above the existing table rendering 60 bars for RPS and error rate.

## Feature 5 — Log Viewer

**Provider id**: `logs`

- Log ring buffer, default size 500, configurable via env `NODEUI_LOG_SIZE`.
- Entries: `{ level: 'debug'|'info'|'warn'|'error', message: string, timestamp: number }`.
- Two ingestion paths:
  - **Console interception**: when NodeUI is active, wrap `console.debug/info/log/warn/error` to tee entries into the buffer. Wrapping occurs on mount, restored on unmount. The wrapper must never throw — on any error it delegates to the original method. Interception only runs while the logs provider is active (lazy).
  - **Logger adapter**: `createNodeUI` gains `addLogSource(source: { level, message, timestamp })` — callers push pino/winston/custom entries. The adapter is independent of console interception; both paths feed the same ring buffer.
- Server-side filtering via query params: `?level=` (single level) and `?query=` (substring match on message, case-insensitive).
- Payload: `{ entries: { level, message, timestamp }[] }`.

**Panel**: level-colored list, level filter chips, search box, pause-on-scroll.

## Feature 6 — Per-Panel Export

- Client-side only. Each panel header gains JSON + CSV buttons.
- JSON: `JSON.stringify` of the current envelope data.
- CSV: flattened table where data is tabular (requests, logs, routes, env).
- Download via Blob + anchor click, filename `nodeui-<panel>-<timestamp>.json` / `.csv`.

## New Providers Summary

Existing 7 providers (health, memory, cpu, event-loop, startup, requests, heap-snapshot) unchanged. New: `env`, `routes`, `logs`, `metrics` → 11 total.

## Data Flow

- REST and SSE both serialize via the existing envelope serializer in `packages/core/src/server.ts`.
- App config captured at mount; if a getter is provided, re-evaluated per fetch.
- No exceptions leak to the UI — all new providers return error envelopes.

## Error Handling

- Providers return `{ok:false, error:{code,message}}` on failure (env inaccessible, router not introspectable, buffer read race).
- SSE: error envelopes pushed; client disconnect cleanup; reconnect with backoff.
- Console wrapper never throws.

## Testing

- **Vitest units**: metrics bucketing (clock-controlled), route walker (nested routers, middleware-only, 405-only), env masking, log ring buffer + console interception restore, SSE endpoint (readable-stream assertion), export helpers.
- **UI tests**: smoke tests for new panels, export filename/content assertions.
- Existing 89-test suite must stay green.
- **Verification**: typecheck / lint / format / test / build all clean; both demo apps extended to exercise new features; preview URL verified with SSE stream visible.

## Configuration

| Env                                  | Default | Purpose                  |
| ------------------------------------ | ------- | ------------------------ |
| `NODEUI_LOG_SIZE`                    | 500     | Log ring buffer capacity |
| (existing) `NODEUI_POLL_INTERVAL_MS` | 2000    | SSE/REST poll interval   |
