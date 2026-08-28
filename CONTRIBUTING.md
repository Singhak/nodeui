# Contributing to NodeUI

Thanks for considering a contribution. This project aims to be a small,
well-tested, framework-neutral developer console for Node.js backends. The
guidelines below keep it that way.

## Development setup

```bash
npm install
npm run build
npm run test
```

## What we look for

- **Small, focused PRs.** One logical change per PR keeps review fast.
- **Tests for behavior.** New providers and adapters should ship with unit or
  e2e tests. Run `npm test` before pushing.
- **No new runtime dependencies in `@nodeui/core`.** Core deliberately uses
  only Node's built-in modules. New panels must not require third-party
  runtime packages.
- **Provider contract stability.** The `ProviderResult<T>` /
  `ApiEnvelope<T>` shape is the public contract shared by core, adapters, and
  the UI. Changing it is a breaking change.
- **Docs alongside features.** Public options, new panels, and changed
  endpoints must be reflected in the README.

## Repo layout

```
packages/core      Framework-neutral engine: providers, REST + SSE, safety gate
packages/express   Express middleware adapter
packages/nestjs    NestJS module adapter
apps/ui            React + Vite console (bundled into core's static assets)
apps/demo-express  Demo app for manual verification
apps/demo-nestjs   Demo app for manual verification
docs/superpowers   Design specs and implementation plans
```

## Adding a panel (the standard path)

1. Add a provider in `packages/core/src/providers/` implementing
   `NodeUIProvider<T>` (lazy `start`/`stop` for background samplers).
2. Add its id to `PanelId` in `packages/core/src/types.ts`.
3. Register it in `createNodeUI` (`packages/core/src/server.ts`). Its GET
   route is derived from the registry automatically.
4. Add a panel component in `apps/ui/src/panels/` and wire it into the
   `PANELS` map in `apps/ui/src/App.tsx`.
5. Update the README panels table and add a test.

## Quality gates (must pass locally)

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

CI runs exactly these on every push and pull request.

## Commit style

Follow the existing history: conventional commits
(`feat(scope): ...`, `fix(core): ...`, `docs: ...`). Keep the subject under
72 characters.

## Releasing

Maintainers only. Run `npm run release:check` to validate version alignment
across workspaces, then `npm run publish` to build and publish
`@nodeui/core`, `@nodeui/express`, and `@nodeui/nestjs` in dependency order.
See `scripts/publish.mjs` for the exact steps.
