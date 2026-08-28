# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- License, contributing, security, and code-of-conduct documents.
- npm publishing metadata (`repository`, `homepage`, `bugs`, `keywords`,
  `engines`, `publishConfig`) on `@nodeui/core`, `@nodeui/express`, and
  `@nodeui/nestjs`.
- Dual CommonJS and ESM builds with package `exports` maps.
- `npm run publish` and `npm run release:check` release tooling.
- API GET routes derived from the provider registry (no hand-maintained
  route map).
- Benchmark script (`scripts/bench.mjs`) and README benchmarks section.
- README FAQ/troubleshooting and security & limitations sections.
