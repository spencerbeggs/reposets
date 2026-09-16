---
type: Invariant
title: Phase order is pinned
description: PHASE_NAMES is the order phases run in, and selection preserves that order regardless of flag order.
resource: ../../package/src/sync/phase.ts
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 539a8bc5fa64cffbc25d0c4da4f3a8427fe7aa79232b0c2db89e6ace783914db
tags: [architecture]
---

# Phase order is pinned

## Property

Phases run in exactly this order, always: settings, security,
code-scanning, environments, secrets, variables, rulesets, cleanup
(`PHASE_NAMES`, `package/src/sync/phase.ts:81-90`). Environments run before
the secrets and variables scoped to them, so an environment-scoped secret is
never written against an environment that does not exist yet. Cleanup runs
last, because every other phase's writes are what define "declared" for that
run — sweeping before them would delete a resource the same run was about to
create.

`--only` and `--skip` select a *subset* of `PHASE_NAMES`, never a
*reordering* of it: `selectPhases` (`package/src/sync/phase.ts:149-157`)
filters the phase array and returns it in the array's own order, so
`--only rulesets,settings` runs settings before rulesets exactly as an
unfiltered run would, regardless of the order the two names were typed on
the command line.

## Mechanism

`PHASE_NAMES` is declared as a single `as const` tuple
(`package/src/sync/phase.ts:81-90`), and `allPhases`
(`package/src/sync/phases/index.ts`) builds the real phase array by listing
each phase module in that same order — the array literal itself is the
enforcement, since nothing computes an order at runtime to get wrong.
`selectPhases`'s implementation is `phases.filter(...)`
(`package/src/sync/phase.ts:152-157`), which by definition cannot change the
relative order of the elements it keeps.

`package/__test__/cli/commands.test.ts:114-129` pins the *selection*
mechanism directly: it builds a fake phase list from `PHASE_NAMES` and
asserts that naming one phase in `only` returns exactly that phase
(`selectPhases(fake, { only: valid(["settings"]) })`), and that an `only`
set which matched no valid name — the shape produced when every requested
name is a typo — degrades to running the full, ordered list rather than an
empty one. That second assertion is the reason `reposets sync` refuses an
unrecognized `--only`/`--skip` name before it ever reaches `selectPhases`
(`package/src/cli/commands/sync.ts:167-175`): the mechanism this test pins
reads "no valid names" as "no filter," so the refusal has to happen upstream
of it.

## What a refactor would have to break

Reordering `PHASE_NAMES` itself, or building `allPhases` in a different
order than the tuple declares, would change the order silently — nothing
type-checks the array literal against the tuple's sequence. Replacing
`selectPhases`'s `.filter` with anything that reconstructs the array (a
`Set` round-trip, a sort by name) would risk losing the ordering guarantee
even while keeping the same elements. Either change would surface first as
an environment-scoped secret failing because its environment was not
created yet, or as a cleanup phase deleting a resource a later phase in the
same run was about to write.
