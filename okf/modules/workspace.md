---
type: Module
title: workspace
description: The pnpm+Turbo monorepo root — one package, the effected package build, the source-run bin, dual registry publishing, and the TypeScript 7 native compiler.
kind: workspace
resource: ../..
status: draft
generated:
  by: okfit/claude-code
  at: 2026-11-12T02:40:05Z
tags: [architecture, dx, deps]
integrity:
  generated:
    body: f1b86e2f87d8dfc9
---

# workspace

## Shape

This is a pnpm workspace orchestrated by Turbo with exactly one package,
`reposets`, under `package/` (`pnpm-workspace.yaml:1-2`). It carries two
pnpm `configDependencies` — `@effected/pnpm-plugin-effected` and
`@savvy-web/pnpm-plugin-silk` — loaded before the workspace resolves rather
than as ordinary dependencies. They supply the catalogs the package
resolves through: the effected plugin's catalogs for `effect`, every
`@effect/*` package and every `@effected/*` package, and its
`catalog:effected:build` for `ink` and `react`, which the CLI loads only
when a screen or the live view mounts. Because `reposets` is a published
CLI, it owns its kit closure: every Effect-family entry in `package/`'s
`dependencies` is written `catalog:effected:exact`, which packs as a plain
version, so a kit patch reaches an installed `reposets` only through a
`reposets` release. `package/__test__/manifest.test.ts` fails on any
Effect-family dependency spelled otherwise. Dev-only dependencies stay on
`catalog:effected`, since they never ship. The effected plugin holds the Effect
family to one exact version (`4.1.4`; its peers catalog gives `~4.1.0`) and
derives an override pinning `effect` and each `@effect/*` satellite to
`4.1.4` across the graph, so a
new Effect minor arrives only with a new plugin release. The whole graph,
build toolchain included, resolves exactly one `effect`.

## Vendored reference source

`.repos/config.json` vendors two upstreams as read-only reference source,
each pinned to what the lockfile installs. `.repos/effect` is pinned to
`effect@4.1.4` and is the authority for core APIs, `effect/cli` included.
`.repos/effected` is pinned to the `@effected/pnpm-plugin-effected@0.26.2`
tag. Both are re-pinned whenever the lockfile's `effect` or the effected
plugin moves.

## Build: `effected package build`

`package/`'s one build script is `effected package build`, from
`@effected/plugin`. There is no build config file: the `ae-forgotten-export`
suppression for `_base` symbols, which masks the anonymous heritage types
Effect's class factories (`Schema.Class`, `TaggedClass`, `TaggedError`,
`Context.Service`) synthesize into the emitted `.d.ts`, is the bundler's
default. It builds only prod targets: `dist/prod/npm/pkg`,
`dist/prod/github/pkg`, `dist/prod/targets.json` and
`dist/prod/issues.json`. There is no dev build and no `dist/dev` tree.

## The source-run bin

The root's `"reposets": "workspace:*"` devDependency links
`node_modules/reposets` to `package/` itself, and the package's `bin` is
`./src/cli/bin.ts`. That file is a thin launcher: when it is running as
`.ts` it registers tsx (a root devDependency, `catalog:build`) and then
dynamically imports `./index.js`; a built `.js` bin skips the branch.
`package/src/cli/index.ts` stays the program and the only file that reads
`process`. So `pnpm exec reposets` runs the current source with no rebuild,
and it reports `v0.0.0`, because `process.env.__PACKAGE_VERSION__` is
substituted only by the build. The built bin,
`package/dist/prod/npm/pkg/bin/reposets.js`, reports the real version.
`package/src/cli/views/sync-progress.tsx` opens with
`/** @jsxRuntime automatic */` because tsx may otherwise compile its JSX
with the classic runtime on a source run.

## Turbo tasks

The root `turbo.json` defines `build` and `types:check`, and the root
`build` and `ci:build` scripts run `turbo run build`. `package/turbo.json`
extends the root (`"extends": ["//"]`), adds `schema:build` and
`schema:check`, and layers `schema:build` onto `build` so a schema is
always current before the package that reads it compiles:

- `build` — depends on `types:check`, plus `schema:build` in the package;
  outputs `dist/prod/**`, which is where `dist/prod/npm/pkg` and
  `dist/prod/github/pkg` land for the two publish targets.
- `types:check` — `tsc --noEmit`, depending on `^types:check`, cached on
  every `.ts`/`.mts`/`.cts` file under `src`, `lib`, and `__test__`.
- `schema:build` — `effected schema build lib/configs/schemastore.config.ts`,
  cached on `src/schemas/**` and the config file itself, outputting
  `$TURBO_ROOT$/schemas/**` — the repository root's `schemas/`, outside the
  package, which turbo stores and restores on a cache hit like any
  package-local output.
- `schema:check` — the same command's `check` mode, deliberately uncached:
  it is the CI gate for schema drift, and caching a gate risks it reporting a
  stale pass.

## Dual registry

`package/package.json`'s `publishConfig.targets` names both `npm: true` and
`github: "@spencerbeggs/reposets"`, so one build produces artifacts for the
`reposets` package on the npm registry and `@spencerbeggs/reposets` on
GitHub Packages, landing in `dist/prod/npm/pkg` and `dist/prod/github/pkg`
respectively.

## TypeScript

TypeScript 7's native compiler, invoked as plain `tsc` (`types:check`'s
script). There are no project references: the root `tsconfig.json` extends
`@savvy-web/silk/tsconfig/node/root.json`, and `package/tsconfig.json`
extends `@effected/plugin/tsconfig/ecma.json`. Both set
`"jsx": "react-jsx"` for the one JSX module,
`package/src/cli/views/sync-progress.tsx`. Each `include` set is
resolved against its own `tsconfig.json`'s directory, so the root's
`types:check` checks only the root's own files (`vitest.config.ts`,
`vitest.setup.ts`, `lib/configs/`) and none of `package/`; `package/src`
and `package/__test__` are checked by the package's `types:check`, which
`pnpm run typecheck` runs through Turbo. `effect` resolves to
`4.1.4` (`pnpm-lock.yaml`; the `@effected/pnpm-plugin-effected` catalog
pins it exactly), and the root `tsconfig.json`'s `skipLibCheck: true`
exists solely to route around a declaration file in that release that
references a DOM-only type (`Transferable`, in `rpc/RpcClient.d.ts`) a
Node-only `lib` lacks; it is meant to come out once an `effect` release
ships without them, not as a general escape hatch.

## Lint and test

Biome is configured through `@savvy-web/silk/biome`. `pnpm run test` runs
Vitest with coverage always on, and `vitest.setup.ts`'s global setup runs
`pnpm turbo run build` before the suite — see
[test-run-rewrites-schemas](../gotchas/test-run-rewrites-schemas.md) for what
that side effect does to the committed `schemas/**/*.json` and why it is not a
regression. The e2e suite, `package/__test__/cli/bin.e2e.test.ts`, spawns the
built `dist/prod/npm/pkg/bin/reposets.js`, so it tests the bin that ships.
