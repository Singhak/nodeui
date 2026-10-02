# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
