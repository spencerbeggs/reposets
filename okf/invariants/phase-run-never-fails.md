---
type: Invariant
title: Phase.run never fails
description: Phase.run's error channel is `never`; failures are collected into PhaseResult.errors instead of aborting the run.
resource: ../../package/src/sync/phase.ts
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: c63a53a3d08fb8412df8e86e1d0a1ad21c7c10c5608c3614711ee1cea6e0ea13
tags: [architecture, effect]
---

# Phase.run never fails

## Property

`Phase.run`'s type is
`(ctx: RepoContext) => Effect.Effect<PhaseResult, never, Repo>`
(`package/src/sync/phase.ts:132`) — `never` in the error channel. A phase
cannot fail as an Effect; whatever went wrong for one resource is instead
folded into `PhaseResult.errors`, an array of `{ context, message }` records
(`package/src/sync/phase.ts:61-66`), and the phase's `Effect` still
succeeds. A sync run spans many repositories and many resources, and one
repository's rejected ruleset must never stop the nineteen after it.

## Mechanism

`attempt` (`package/src/sync/phase.ts:180-191`) is the helper every phase
uses to get there: it takes a fallible `Effect.Effect<A, E, R>`, maps a
success to `{ value }`, and catches any failure into
`{ error: { context, message } }` — reading `error.message` when the failure
is an `Error` and falling back to `String(error)` otherwise, so a
`GitHubError`'s own words survive into the record rather than being replaced
by a generic message. The result type,
`Effect.Effect<{ value: A } | { error: ... }, never, R>`, has already
discharged `E` by the time a phase returns it, which is what lets `run`'s
own signature declare `never` truthfully rather than by convention.

`SyncEngine`'s repository loop (`package/src/sync/SyncEngine.ts:247-250`)
also wraps each `phase.run(ctx)` call in `Effect.orElseSucceed(() =>
emptyResult)` as a second line of defense, then iterates
`result.errors` and logs each one via `SyncLogger.syncError` without
stopping the loop (`package/src/sync/SyncEngine.ts:260-262`). Errors
accumulate across the whole run into `mergeResults` and surface in
`SyncReport.errorSummary` — the first error's text plus a count of how many
followed it, since a run over twenty repositories can fail twenty times for
one reason and the summary exists to say which reason came first
(`package/src/sync/SyncEngine.ts:292-297`).

## What a refactor would have to break

Giving `Phase.run` a real error type — even a narrow, well-typed one — would
mean the engine's repository loop can no longer treat every phase call the
same way; some caller would have to decide per phase whether a failure
aborts the repository, the group, or the run, and that decision does not
exist anywhere in the pipeline today. Removing `attempt`'s catch, or having
a phase reach for `Effect.die`/`Effect.fail` directly instead of folding a
failure into `PhaseResult.errors`, would let one repository's failing write
propagate up through `SyncEngine.syncAll` and abort every repository still
queued behind it in the same run.
