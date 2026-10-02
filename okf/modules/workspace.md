---
type: Module
title: workspace
description: The pnpm+Turbo monorepo root — one package, the bundler build, dual registry publishing, and the TypeScript 7 native compiler.
kind: workspace
resource: ../..
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-02T15:04:56Z
  body_sha256: 62ea7c329da6d691c1c1009e83bff40afd94fc6b907713fbb703a94e0e48e51d
tags: [architecture, dx, deps]
---

# workspace

## Shape

This is a pnpm workspace orchestrated by Turbo with exactly one package,
`reposets`, under `package/` (`pnpm-workspace.yaml:1-2`). It carries two
pnpm `configDependencies` — `@effected/pnpm-plugin-effect` and
`@savvy-web/pnpm-plugin-silk` — loaded before the workspace resolves rather
than as ordinary dependencies.

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
  `schemas/**`.
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
extends `@savvy-web/bundler/tsconfig/ecma.json`. `effect` resolves to
`4.0.0` (`pnpm-lock.yaml`; the `@effected/pnpm-plugin-effect` catalog
gives it `^4.0.0`), and the root `tsconfig.json`'s `skipLibCheck: true`
exists solely to route around declaration files in that release that
reference DOM-only types (`TextDecoderOptions`, `Transferable`) a
Node-only `lib` lacks; it is meant to come out once an `effect` release
ships without them, not as a general escape hatch.

## Lint and test

Biome is configured through `@savvy-web/silk/biome`. `pnpm run test` runs
Vitest with coverage always on, and `vitest.setup.ts`'s global setup runs
`turbo run build:dev` before the suite — see
[test-run-rewrites-schemas](../gotchas/test-run-rewrites-schemas.md) for what
that side effect does to `package/schemas/*.json` and why it is not a
regression.
