---
title: Running the test suite rewrites the published JSON schemas
description: pnpm run test regenerates package/schemas/*.json unformatted, which then fails lint until lint:fix runs.
type: Gotcha
resource: ../../vitest.setup.ts
stale_after: 2027-03-16T00:00:00Z
tags: [testing, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 520ad49e6f4be4e4a8b41d78280a635d105e05206091073fcd4e41e69a3c1ec1
sources:
  - id: vitest-setup
    resource: ../../vitest.setup.ts
  - id: turbo-json
    resource: ../../package/turbo.json
---

# Running the test suite rewrites the published JSON schemas

## What it looks like

`pnpm run test` finishes green, and then `pnpm run lint` immediately after
fails on formatting in `package/schemas/reposets.config.schema.json`,
`package/schemas/reposets.credentials.schema.json` and
`package/schemas/catalog.json` — files nobody touched in the diff being
worked on. It reads like the test run itself broke something, or like a
stray formatter ran against tracked files it should have left alone.

## What is actually true

`vitest.setup.ts` runs `pnpm turbo run build:dev` as a global setup step
before any test executes[^vitest-setup]. `build:dev` depends on
`schema:build`[^turbo-json], which regenerates
`package/schemas/*.json` from the current `ConfigSchema` and
`CredentialsSchema` — so every `pnpm run test` invocation rewrites those
three tracked files as a side effect, not a bug. `schemastore build`
writes them unformatted, and Biome's formatting rules apply to `*.json`,
so the freshly-written files fail `pnpm run lint` until `pnpm run
lint:fix` folds them back into the repository's format.

This is expected, not a regression: the schema files are a build output
that happens to be committed, and the test suite's global setup runs a
full `build:dev` to make sure the package under test is current — it does
not special-case skipping the schema step.

## What to do about it

Run `pnpm run lint:fix` after `pnpm run test` before checking lint status,
or run lint before test in the same session. Do not investigate the
schema generator itself on the strength of a post-test lint failure alone
— confirm the diff is only formatting (`git diff --stat
package/schemas/`) before suspecting a real content change.

[^vitest-setup]: `vitest.setup.ts`
[^turbo-json]: `package/turbo.json`
