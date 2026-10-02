# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - unreleased

### Added

- `@singhak/nodeui-cli`: `nodeui attach -- <command>` runs any Node app with the console attached via a preload (no code changes), and `nodeui dashboard name=url …` shows several consoles on one loopback page with a proxy to each.
- `nodeui mcp <url>…`: a read-only MCP (stdio) server with an overview digest and tools for errors, requests (joined with their queries, outgoing calls and logs), queries, outgoing calls, logs and routes, so AI agents can read a running app.
- `uiAssetsDir()` exported from core: the directory of the bundled console, for serving it from your own host or gateway.

## [0.4.0] - 2026-10-02

### Added

- New adapters: `@singhak/nodeui-koa` (Koa 2/3), `@singhak/nodeui-hapi` (Hapi 21), `@singhak/nodeui-hono` (Hono on `@hono/node-server`) and `@singhak/nodeui-http` (plain `node:http`, Next.js custom servers, Restify). NestJS now has a tested Fastify-platform path and an error interceptor.
- Requests are grouped by matched route pattern (`/users/:id`) on Express, Fastify and Nest.
- Outgoing calls and log lines carry the originating `requestId` (AsyncLocalStorage); the Requests drawer shows a per-request timeline.
- `captureRequestDetail` option (and `NODEUI_CAPTURE_BODIES`): query and headers by default, opt-in size-capped textual bodies, credentials always redacted; Copy as curl replays them.
- OTLP export (`otlp` option / `NODEUI_OTLP_ENDPOINT`): requests, outgoing calls and queries as OTLP/HTTP JSON spans, linked into one trace per request, with no OpenTelemetry SDK. Off by default; the exporter's own calls are not captured.
- Optional persistence (`persist` option / `NODEUI_PERSIST_FILE`): requests, outgoing calls, queries and errors are journaled to a private NDJSON file (masked, batched async writes, rotated at 5 MiB) and restored on startup. Off by default.
- Queries panel: SQL statements from `pg` and `mysql2` (auto-detected in the app's dependencies, captured while the panel is open), Prisma via `server.trackPrisma(client)` and any ORM via `server.recordQuery()`. Flags slow queries (`slowQueryMs`, default 100 ms) and N+1 suspects (same statement 5+ times in one request); parameter values are never recorded. Queries appear in the request timeline.
- Errors panel: failures grouped by fingerprint (type, message shape, top frames) with counts, stack and linked request. Fed by Express `errorHandler`, a Fastify `onError` hook, a Nest interceptor, `server.recordError()` and `uncaughtExceptionMonitor` (Node's crash behaviour is untouched). Client errors (4xx) are ignored.
- Tests that the built ESM and CJS bundles serve the console.

### Changed

- Demos (Express, NestJS) now exercise errors, queries with an N+1 and a slow statement, failing outgoing calls, request bodies and persistence. `NodeUIService` (Nest) gained `recordQuery` and `recordError`.
- `npm run bench` now alternates scenarios over several rounds and reports medians with spread; README numbers and overhead wording updated.
- Text masking keeps quotes around redacted values so masked JSON-like text stays well-formed.
- Root `package.json` is marked `private`.

## [0.3.1] - 2026-10-02

### Added

- Redesigned console: sidebar navigation, health-first Overview with KPI tiles and charts
  (axes, units, hover values), light/dark themes, pause/resume, sortable and filterable
  Requests/Outgoing tables with a detail drawer (Copy as curl), accessible keyboard navigation.
- `/api/requests` now includes a `summary` (p50/p95/p99, error rate, status buckets, per-route stats).

### Fixed

- `/config` reported its lock state under a key that the masker redacted, so the UI always showed
  the lock badge; the field is now `locked`.
- Plugin panels mounted after the live stream opened never received data.
- Demos use a curated environment, health checks, a plugin panel and optional generated traffic
  (`DEMO_TRAFFIC=1`).

## [0.3.0]

### Security

- `maskSecrets: false` is now honoured (it was previously ignored), and masking also
  applies to the live SSE stream, which previously sent raw values.
- Secret masking now covers `auth`, `cookie`, `dsn`, `session`, `private`, `signature`,
  `database_url` and connection-string keys, and scrubs credentials embedded in text
  (`postgres://user:pass@host`, bearer tokens, JWTs, `password=...`), including log lines.
- Host-header validation (DNS-rebinding defence) and Origin validation for every console
  request; forwarded (`X-Forwarded-*`) requests are rejected unless `trustProxy` is set.
- Optional shared access token (`authToken` / `NODEUI_TOKEN`) with an HttpOnly cookie login.
- Security headers (CSP, nosniff, frame deny, no-referrer) on all console responses.
- Live streams are capped (`maxSseClients`), outstanding confirmation nonces are capped,
  heap snapshots are written owner-only into a private directory.
- Warnings when the console is active with `NODE_ENV=production`, on a non-loopback host
  without a token, or with masking disabled.

### Added

- Outgoing HTTP panel: records `http`/`https` (axios, got, node-fetch, ...) and global `fetch` calls.
- Plugin API: `plugins: [provider]` registers custom panels rendered generically by the UI.
- Dependency health checks: `healthChecks: { db: () => ping() }` shown in the health panel.
- Docker / remote access support: `allowedHosts`, `allowedOrigins`, `allowedRemoteAddresses`
  (exact IPs or IPv4 CIDRs).
- `@singhak/nodeui-fastify` adapter (Fastify 4 and 5).
- `server.setRoutes()` for frameworks without an Express-style router.

### Fixed

- A throwing or rejecting provider no longer causes unhandled rejections in the live stream;
  it becomes a `provider-failed` envelope.
- Package versions aligned across all packages; stale `@nodeui/*` references and the
  placeholder security/conduct e-mail addresses removed.

### Added

- License, contributing, security, and code-of-conduct documents.
- npm publishing metadata (`repository`, `homepage`, `bugs`, `keywords`,
  `engines`, `publishConfig`) on `@singhak/nodeui-core`, `-express`, and
  `-nestjs`.
- Dual CommonJS and ESM builds with package `exports` maps.
- `npm run publish` and `npm run release:check` release tooling.
- API GET routes derived from the provider registry (no hand-maintained
  route map).
- Benchmark script (`scripts/bench.mjs`) and README benchmarks section.
- README FAQ/troubleshooting and security & limitations sections.
