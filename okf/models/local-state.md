---
title: Local state
description: The three SQLite-backed stores under the XDG data directory that back drift detection, run history, and per-repo GitHub lookups
type: DataModel
status: draft
resource: ../../package/src/store
tags:
  - architecture
  - observability
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 523805e7a816fdd8b1b025b360c458e1395491edd2eda72580cfecde17913bb5
sources:
  - id: applied-state
    resource: "../../package/src/store/AppliedState.ts"
  - id: sync-journal
    resource: "../../package/src/store/SyncJournal.ts"
  - id: repo-cache
    resource: "../../package/src/store/RepoCache.ts"
  - id: migrations
    resource: "../../package/src/store/migrations.ts"
---

# Local state

Three stores live under the XDG data directory and are wired once, by
`App.layer`, around a whole sync run. Each backs a different question a
maintainer asks after the fact, and each breaks in a different way when
an entry is wrong.

## AppliedState

`AppliedState` holds one row per `(repo, kind, name)`: the fingerprint
reposets last wrote for that resource, when, and which run wrote
it[^applied-state]. It is the baseline every drift comparison is measured
against — without it, a divergence between config and live state has no
attributable cause, because there is nothing to distinguish "the config
changed" from "someone edited GitHub directly."

The composite lookup key joins `kind` and `name` with a literal **NUL
byte**, not a space — the separator cannot occur in either component, so
no pair of `(kind, name)` values can collide by concatenation. The
`refKey` function that builds it is module-private on purpose: the NUL
byte does not survive being displayed (tools that render source show it
as whitespace), so a caller who reads the source and tries to compose the
key by hand will silently build the wrong key and miss every lookup. The
exported `lookup` function is the only supported way to read a `getMany`
result back out by `(kind, name)`[^applied-state].

`forget` deletes a resource's row, and every deletion in the cleanup
phase calls it: once a resource is gone, its baseline is meaningless, and
leaving it behind would make a later re-creation of the same
`(repo, kind, name)` compare against a fingerprint from before the
deletion — a resource that comes back identical to what was deleted would
then read as unchanged instead of as a fresh creation.

What breaks if an entry is wrong: a stale fingerprint (one `forget` skips,
or a `record` that writes the wrong digest) reports drift nobody caused,
because the baseline no longer describes what reposets actually pushed
last. A missing `forget` on a deleted resource does the same in reverse —
it compares a recreated resource against a pre-deletion baseline.

## SyncJournal

`SyncJournal` is append-only: one row per run (`sync_run`) and one row
per resource that run touched (`sync_change`), written on every run
including dry runs[^sync-journal]. A run that fails records its error in
`sync_run.error`, so a failed run can be explained later rather than only
counted.

`history` orders by `rowid`, the table's physical insertion order, not by
the UUIDv7 primary key. `sync_run.id` is minted with
`crypto.randomUUIDv7`, which is only millisecond-precision — ids minted
within the same millisecond sort by their random suffix rather than by
the order they were created, so sorting on the id itself would not be
deterministic for two runs started in the same millisecond. `rowid`
always is[^sync-journal].

What breaks if an entry is wrong: nothing here feeds drift detection —
`prune` and `clear` delete journal rows only, deliberately leaving
`AppliedState` and the cache untouched, because deleting a baseline
disarms drift detection rather than tidying it. A journal row with the
wrong `run_id` on its changes, or a run stuck without a `finished_at`,
makes `history show` misreport what a run did, but does not change what
the next sync compares against.

## RepoCache

`RepoCache` is a TTL-bounded read-through cache over three GitHub
lookups a sync run would otherwise repeat once per repository: a team
slug's numeric id (`team:{org}/{slug}`, 30 days — a team's id survives
renames and is never reissued after deletion), an owner's account type
(`owner:{owner}`, 30 days — changes only on a deliberate one-way user-to-org
conversion), and — held far more briefly, at ten minutes, because a stale
answer under-configures a repository that just changed — the repository's
detected languages (`langs:{owner}/{repo}`), its workflow file count
(`workflows:{owner}/{repo}`, gating the `actions` code-scanning language),
and whether it is private (`private:{owner}/{repo}`)[^repo-cache].

What breaks if an entry is wrong: a stale `langs` or `workflows` entry
under-configures code scanning on a repository that just gained a
language or a workflow file, silently, since the cache never reports
that it served a stale answer — this is the reason its TTL is ten
minutes rather than the 30 days used for team and owner lookups, which
change far more rarely.

## Migrations

`migrations.ts` defines the schema for both `SyncJournal`
(`sync_run`/`sync_change`, one migration since rolling one table back
without the other would orphan a foreign key) and `AppliedState`
(`applied_state`, keyed `(repo, kind, name)`)[^migrations]. Every
migration defines `down`: a migration with no rollback would let
`rollback` remove its ledger row while leaving the schema change in
place, so a later `migrate` would re-run its `up` against a table that
already exists.

[^applied-state]: `../../package/src/store/AppliedState.ts`
[^sync-journal]: `../../package/src/store/SyncJournal.ts`
[^repo-cache]: `../../package/src/store/RepoCache.ts`
[^migrations]: `../../package/src/store/migrations.ts`
