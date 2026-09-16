---
title: pnpm exec reposets runs the dev build, not prod
description: node_modules/reposets links to the dev build, so a source change is invisible until build:dev reruns.
type: Gotcha
resource: ../../package/package.json
stale_after: 2027-03-16T00:00:00Z
tags: [dx]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: b4cfbb87b878ba0836f35528d8f8dbc6850b3fdb571118788b7eee7e2e7e368a
sources:
  - id: package-json
    resource: ../../package/package.json
---

# pnpm exec reposets runs the dev build, not prod

## What it looks like

A source fix lands in `package/src/`, `pnpm exec reposets <command>` is
run to confirm it, and the old behavior reproduces exactly as before.
Building `dist/prod` and re-testing produces the same result. It reads as
"the fix did not work" — the change is on disk, the command still
misbehaves.

## What is actually true

The root workspace declares `"reposets": "workspace:*"` as a
devDependency[^package-json], and pnpm's workspace linking makes
`node_modules/reposets` a symlink to `package/dist/dev/pkg` — the output
of `build:dev`, not a live view of `package/src/`. `pnpm exec reposets`
resolves through that symlink, so it runs whatever was in `dist/dev/pkg`
the last time `build:dev` ran, regardless of what the source now says.
Rebuilding `dist/prod` does not touch `dist/dev/pkg` at all — `build:prod`
is a separate Turbo task with its own output directory — so testing
against a prod rebuild after a dev-build fix genuinely re-runs the old
code twice.

## What to do about it

Rebuild the dev target before testing a source change through the CLI:
`pnpm --filter reposets build:dev`, then `pnpm exec reposets <command>`.

Verify the rebuild actually landed by content, not by modification time —
a `dist` directory whose mtime is older than the source it was built from
can still be current, because a later lint-fix pass touches source files
after the build already ran. Grep the built chunk under `dist/dev/pkg`
for the symbol or string the fix introduced, and grep a second,
known-present symbol as a control — a match on the control with no match
on the fix means the build is stale; no match on either means the wrong
file was grepped.

[^package-json]: `package/package.json`
