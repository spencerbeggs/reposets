---
type: Module
title: workspace
description: The pnpm+Turbo monorepo root — one package, the bundler build, dual registry publishing, and the TypeScript 7 native compiler.
kind: workspace
resource: ../..
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-31T20:39:00Z
tags: [architecture, dx, deps]
integrity:
  generated:
    body: 8f55838ac2e56088
---

# workspace

## Shape

This is a pnpm workspace orchestrated by Turbo with exactly one package,
`reposets`, under `package/` (`pnpm-workspace.yaml:1-2`). It carries two
pnpm `configDependencies` — `@effected/pnpm-plugin-effected` and
`@savvy-web/pnpm-plugin-silk` — loaded before the workspace resolves rather
than as ordinary dependencies. They supply the catalogs the package
resolves through: one `catalog:effected`, from the `0.20.0` effected
plugin, for `effect`, every `@effect/*` package and every `@effected/*`
package, and `catalog:silk` for `ink` and `react`, which the CLI loads only
when a screen or the live view mounts. The effected plugin holds the Effect
family to one minor (`~4.1.1`, not a caret) and derives an override pinning
`effect` and each `@effect/*` satellite to `4.1.1` across the graph, so a
new Effect minor arrives only with a new plugin release.

The root `.pnpmfile.cjs` is a temporary bridge. The build toolchain
(`@savvy-web/*`, `@okfit/*`, `@vitest-agent/*`) still loads published
`@effected/*` packages built on Effect 4.0.x, which import the `Crypto`
module Effect 4.1 removed; its `readPackage` hook moves those packages, and
the tools that load them, onto npm aliases of `effect@4.0.7` the plugin's
override cannot rewrite. It leaves this repository's own package and the
4.1 kit it ships on alone. Delete it once every tool has republished on an
`@effected` release built on Effect 4.1, at which point no lockfile
`packages:` entry names `effect@4.0.7`. `pnpm-workspace.yaml` also pins
`tsdown` and `@tsdown/exe` to `0.23.2`: `tsdown` 0.23.4 narrowed
`rolldown-plugin-dts` to `^0.28.8`, which cannot find TypeScript 7, and the
bundler's `^0.23.2` would otherwise resolve it.

## Vendored reference source

`.repos/config.json` vendors two upstreams as read-only reference source,
each pinned to what the lockfile installs. `.repos/effect` is pinned to
`effect@4.1.1` and is the authority for core APIs, `effect/cli` included.
`.repos/effected` is pinned to the `@effected/pnpm-plugin-effected@0.20.0`
tag, the kit release that pins `@effected/cli` 0.25.0. Both are re-pinned
whenever the lockfile's `effect` or the effected plugin moves.

## Build: `@savvy-web/bundler`

`package/` builds through `@savvy-web/bundler`'s `build()`, invoked from
`package/savvy.build.ts` as `node savvy.build.ts --target dev|prod`. The
config there is otherwise empty except for one narrow TSDoc suppression:
`ae-forgotten-export` for any symbol matching `_base`, which masks the
anonymous heritage types Effect's class factories (`Schema.Class`,
`TaggedClass`, `TaggedError`, `Context.Service`) synthesize into the emitted
`.d.ts` as an un-nameable `declare const X_base`.

## Turbo tasks

The root `turbo.json` defines `build:dev`, `build:prod`, and `types:check`;
`package/turbo.json` extends the root (`"extends": ["//"]`) and adds
`schema:build` and `schema:check`, and layers a dependency onto both build
tasks so a schema is always current before the package that reads it
compiles:

- `build:dev` — `$TURBO_EXTENDS$` plus `schema:build`; outputs `dist/dev/**`.
- `build:prod` — depends on `types:check` and `build:dev`, plus
  `schema:build`; outputs `dist/prod/**`, which is where `dist/prod/npm/pkg`
  and `dist/prod/github/pkg` land for the two publish targets.
- `types:check` — `tsc --noEmit`, cached on every `.ts`/`.mts`/`.cts` file
  under `src`, `lib`, and `__test__`.
- `schema:build` — `schemastore build lib/configs/schemastore.config.ts`,
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
extends `@savvy-web/bundler/tsconfig/ecma.json`. Both set
`"jsx": "react-jsx"` for the one JSX module,
`package/src/cli/views/sync-progress.tsx`. Each `include` set is
resolved against its own `tsconfig.json`'s directory, so the root's
`types:check` checks only the root's own files (`vitest.config.ts`,
`vitest.setup.ts`, `lib/configs/`) and none of `package/`; `package/src`
and `package/__test__` are checked by the package's `types:check`, which
`pnpm run typecheck` runs through Turbo. `effect` resolves to
`4.1.1` (`pnpm-lock.yaml`; the `@effected/pnpm-plugin-effected` catalog
gives it `~4.1.1`), and the root `tsconfig.json`'s `skipLibCheck: true`
exists solely to route around a declaration file in that release that
references a DOM-only type (`Transferable`, in `rpc/RpcClient.d.ts`) a
Node-only `lib` lacks; it is meant to come out once an `effect` release
ships without them, not as a general escape hatch.

## Lint and test

Biome is configured through `@savvy-web/silk/biome`. `pnpm run test` runs
Vitest with coverage always on, and `vitest.setup.ts`'s global setup runs
`turbo run build:dev` before the suite — see
[test-run-rewrites-schemas](../gotchas/test-run-rewrites-schemas.md) for what
that side effect does to the committed `schemas/**/*.json` and why it is not a
regression.
