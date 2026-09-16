---
type: Decision
title: Phases are data, not a hardcoded sequence
description: The sync pipeline is a list of Phase values the engine walks, which is what lets --only/--skip select a subset without the engine knowing what any phase does.
status: stable
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 388cc132b65fca8e98de4ed936aef76b2e5bc2e1ab78dac9d8844bd33fe26b4c
tags: [architecture, effect]
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:23Z
---

# Phases are data, not a hardcoded sequence

## Context

`reposets sync` needs to run eight kinds of work — settings, security,
code-scanning, environments, secrets, variables, rulesets, cleanup — over
every selected repository, and needs a `--only`/`--skip` flag pair that
selects a subset of them by name. `SyncEngine` also needs to be testable
against a fake phase list rather than only against the real eight.

## Decision

A `Phase` (`package/src/sync/phase.ts:114-133`) is a plain value: a `name`,
an `appliesTo` predicate, and a `run` function. `PHASE_NAMES`
(`package/src/sync/phase.ts:81-90`) is an ordered tuple, and `allPhases`
(`package/src/sync/phases/index.ts`) builds the real `ReadonlyArray<Phase>`
in that order. `SyncEngine` never imports a phase by name; `SyncEngineLive`
(`package/src/sync/SyncEngine.ts:112-133`) takes a
`makePhases: Effect.Effect<ReadonlyArray<Phase>, never, R>` as a parameter,
resolves it once at layer construction, and `selectPhases`
(`package/src/sync/phase.ts:149-157`) filters that list against `--only`/
`--skip` before the engine's repository loop walks what remains — preserving
`PHASE_NAMES` order regardless of the order the flags were given, since the
order is a correctness property (environments must exist before the
secrets/variables scoped to them) rather than a display preference.

`appliesTo` lets a phase decline before paying for a round trip: a
repository with no rulesets configured for its group costs nothing to skip,
and the engine does not log a declining phase, since "did nothing because
nothing was configured" is not news.

Every phase's dependencies bind at `SyncEngineLive(makePhases)` rather than
appearing on `Phase.run`'s own signature — leaving them on `run` would push
every phase's service requirements through `SyncEngine`'s type and out to
every caller of `syncAll`. `Repo` is the deliberate exception
(`package/src/sync/phase.ts:126-131`): `@effected/github`'s resource
services resolve `Repo` from context **per call** rather than taking an
`owner`/`repo` parameter, which is what lets one program act on many
repositories with a scoped override meaning something. A phase therefore
still carries `Repo` in its `R`, and the engine discharges it once at the
repository loop (`package/src/sync/SyncEngine.ts:244-250`,
`Repo.provide(ref)`) — the one place in the whole pipeline that knows which
repository is currently in play.

## Alternatives rejected

A hardcoded sequence of phase calls inside `SyncEngine` — `yield* settings`,
`yield* security`, and so on in order — was rejected. It would work for the
fixed eight-phase pipeline as it stands today, but `--only`/`--skip` would
then need a branch per phase inside the engine itself, coupling the engine's
code to exactly which phases exist rather than to the shape a phase has, and
leaving no way to hand the engine a fake phase list in a test without
editing the engine's own source.

## Consequences

`SyncEngine`'s tests build `RepoContext` values and small fake `Phase`
objects directly (`package/__test__/cli/commands.test.ts:114-129` exercises
`selectPhases` against a phase list built from `PHASE_NAMES` with trivial
`appliesTo`/`run` stand-ins), without needing to run real GitHub calls or
even construct a real engine. The same data-shaped list is also what
`--only`/`--skip` validate against before a sync begins: `sync.ts` rejects
any name that is not in `PHASE_NAMES` rather than silently filtering it out,
because an empty `only` set (the result of every name failing to match) is
indistinguishable from "no filter" and reads downstream as "run everything" —
see `package/__test__/cli/commands.test.ts:126-129`, which pins that
mechanism deliberately so it cannot regress silently.
