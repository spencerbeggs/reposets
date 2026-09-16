---
title: The run boundary belongs to the command, not the engine
description: SyncEngine records into a runId it is given and never opens or closes one; sync owns exactly one journal run per invocation.
type: Decision
status: stable
tags: [architecture, effect, observability]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 7076501a4cc46ed91f1b431cdfeeb4ec88aa93661fad6f7b79acb462135982e1
sources:
  - id: sync-engine
    resource: ../../package/src/sync/SyncEngine.ts
  - id: sync-command
    resource: ../../package/src/cli/commands/sync.ts
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:27Z
---

# The run boundary belongs to the command, not the engine

## Context

`SyncOptions.runId` is a required input to `SyncEngine.syncAll`, and `syncAll` writes into that run rather than opening or closing one of its own[^sync-engine]. `syncHandler` calls `journal.startRun` exactly once per invocation, before it iterates any credential-profile partition, and `journal.finishRun` exactly once after every partition has run[^sync-command]. `sync` partitions groups by credential profile with `partitionByProfile` and drives one `SyncEngine` per partition, because a token is fixed at `GitHubClient` construction and a second identity therefore means a second service graph[^sync-command].

## Decision

The run boundary belongs to the command. `SyncEngineLive(makePhases)` is constructed per partition — a fresh engine over a fresh `GitHubClient.layerFromToken({ token })` and its eight resource services — but every partition's engine is handed the **same** `runId`, obtained once from `journal.startRun` before the partition loop begins[^sync-command][^sync-engine]. An engine that opened its own run would split one `sync` invocation across as many `history` rows as it had credential-profile partitions, for a reason no reader of `history` could see from the row count alone[^sync-engine].

The layers shared across every partition — `SyncJournal`, `AppliedState`, `RepoCache`, `CredentialResolver`, and `SyncLoggerLive({ dryRun, debug })` — are merged into one `sharedLayer` and provided once around the **whole** partition loop, not per partition[^sync-command]. This is load-bearing rather than tidy: a `Layer` memoizes per `Effect.provide` build, not by value identity, so providing the logger layer inside the loop would construct a new `SyncLogger` per profile, each starting its own error tally; `logger.finish()` would then report only the last partition's errors as if they were the whole run's, and `SyncJournal`/`RepoCache` would each open a separate store connection per profile instead of one shared connection for the run.

## Alternatives rejected

- **Engine-owned runs.** Would tie the `history` row boundary to however many credential-profile partitions a config happens to produce, rather than to the CLI invocation the user actually made.
- **Per-partition full graphs**, including the journal, applied-state, cache, resolver and logger. Rebuilds those layers once per profile: a second `SyncLogger` with its own error tally hides the true error count behind whichever partition ran last, and a second `SyncJournal`/`RepoCache` connection duplicates state that is meant to be shared for the run.

## Consequences

- One `sync` invocation is always one row in `history`, whatever the config's credential-profile partitioning looks like.
- `journal.finishRun` is called with the accumulated `errors === 0 ? "success" : "partial"` status across every partition, and `logger.finish()` reports the accumulated error tally across all of them, because both services were built once and shared.

[^sync-engine]: `package/src/sync/SyncEngine.ts`
[^sync-command]: `package/src/cli/commands/sync.ts`
