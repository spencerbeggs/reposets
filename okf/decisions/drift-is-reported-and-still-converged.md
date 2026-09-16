---
title: Drift is reported and still converged
description: reposets always overwrites out-of-band changes to a resource it manages, but always reports them first, and `drift` reuses the sync handler rather than a second read-only pipeline
type: Decision
status: stable
tags:
  - architecture
  - observability
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 8dbb99510b4813a694047731c525385330236c5ef587535f67bcbca6c08bdb84
sources:
  - id: decide
    resource: "../../package/src/sync/decide.ts"
  - id: fingerprint
    resource: "../../package/src/lib/fingerprint.ts"
  - id: drift-command
    resource: "../../package/src/cli/commands/drift.ts"
  - id: secrets-phase
    resource: "../../package/src/sync/phases/secrets.ts"
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:25Z
---

# Drift is reported and still converged

## Context

reposets records a blake2b fingerprint of what it last wrote for every
resource, keyed by `(repo, kind, name)`. The fingerprint is taken over the
key-sorted canonical JSON of the resource's payload: key order does not
change the digest, so reordering a TOML table is never drift, but array
order does — a ruleset's `rules` or an environment's reviewers are ordered
on purpose, so reordering the array is a real change[^fingerprint].

`decide(desired, live, applied)` in [^decide] is a pure, total, three-way
comparison over three fingerprints — the resolved config, what GitHub
currently reports, and the last fingerprint reposets itself wrote — and
returns one of four outcomes: `FirstSync` (no applied baseline exists yet,
so no drift claim is possible), `InSync` (all three agree), `ConfigChanged`
(live still matches the baseline; only the config moved), or `Drift` (live
no longer matches the baseline — someone changed the resource outside
reposets). A missing baseline yields `FirstSync` rather than `Drift`,
because with no prior fingerprint there is no evidence anyone changed
anything, and treating first contact as drift would flag every
pre-existing repository.

## Decision

The policy is report-and-still-converge, not refuse-on-drift: the config
in `reposets.config.toml` is the source of truth, so a `Drift` decision is
overwritten on the next non-dry-run sync exactly like a `ConfigChanged`
one — but it is always reported through `SyncLogger.driftDetected`
first[^secrets-phase], even when `needsApply` on the decision is `false`
(the case where the out-of-band edit happens to match the config; nothing
needs writing, but a human still changed something and the journal should
say so)[^decide]. `--fail-on-drift` turns that report into a nonzero exit
so it can gate CI.

`reposets drift` is `sync --dry-run --no-cleanup --fail-on-drift` through
the same handler, not a second implementation[^drift-command]. The
three-way comparison lives inside the phases; a separate read-only `drift`
pipeline would be a second copy of that decision, free to disagree with
the one that actually converges — the worst possible property for a
command whose entire job is to be believed. Every phase gates its
`applied.record` write on `ctx.dryRun`, so a drift check cannot quietly
accept the drift it just reported by adopting the live state as the new
baseline; the run still appears in `reposets history`, flagged as a dry
run. Cleanup is off for `drift` because an undeclared resource is not
drift — it is undeclared, a different question `sync` answers on its own.

## Alternatives rejected

- **Refuse to converge on drift.** Rejected: the config is the declared
  source of truth, and a tool that stops syncing the moment someone edits
  a value in the GitHub UI turns every manual tweak into a support
  incident. Reporting-then-overwriting keeps the guarantee ("what's on
  GitHub always ends up matching the config") while still surfacing the
  out-of-band change.
- **A separate, read-only implementation of `drift`.** Rejected: the
  three-way comparison already lives in the phases that `sync` runs.
  Duplicating it into a second pipeline risks the two diverging, and the
  value of `drift` depends entirely on it agreeing with what `sync` would
  actually do.

[^decide]: `../../package/src/sync/decide.ts`
[^fingerprint]: `../../package/src/lib/fingerprint.ts`
[^drift-command]: `../../package/src/cli/commands/drift.ts`
[^secrets-phase]: `../../package/src/sync/phases/secrets.ts`
