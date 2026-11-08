---
title: pnpm exec reposets runs the dev build, not prod
description: "Retired: there is no dev build any more. node_modules/reposets links to package/ and its bin runs current source through tsx, so a source change is visible at once; the one remnant is that a source run reports v0.0.0."
type: Gotcha
status: deprecated
resource: ../../package/src/cli/bin.ts
stale_after: 2027-03-16T00:00:00Z
tags: [dx]
generated:
  by: okfit/claude-code
  at: 2026-11-08T22:42:54Z
sources:
  - id: package-json
    resource: ../../package/package.json
  - id: bin-ts
    resource: ../../package/src/cli/bin.ts
integrity:
  generated:
    body: 6a73bc247ecb7bcb
---

# pnpm exec reposets runs the dev build, not prod

This trap no longer holds, and this concept is kept only so a link to it
does not dangle. Do not act on its title.

**What is true now.** The package builds only its prod targets, through
`effected package build`, and there is no `dist/dev` tree. The root
workspace still declares `"reposets": "workspace:*"`, but
`node_modules/reposets` now links to `package/` itself, whose `bin` is
`./src/cli/bin.ts`.[^package-json] That thin bin registers tsx when it is
running as `.ts` and then imports `./index.js`, so `pnpm exec reposets`
runs the current source with no rebuild.[^bin-ts]

**The one remnant.** A source run reports `v0.0.0` from `--version` and
`doctor`, because `process.env.__PACKAGE_VERSION__` is substituted only by
the build. That is not a stale or broken install. To see the real version,
run the built bin, `package/dist/prod/npm/pkg/bin/reposets.js`, after
`pnpm run build`. See [workspace](../modules/workspace.md#build-effected-package-build).

[^package-json]: `package/package.json`
[^bin-ts]: `package/src/cli/bin.ts`
