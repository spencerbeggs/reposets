---
title: A renamed ruleset creates a second one
description: Renaming a ruleset in config creates an orphan on GitHub instead of renaming the original.
type: Limitation
bounds: ../interfaces/config-file.md
tags: [github]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: b67fdf9a5fc4634a297c75306bdbd6a50e51a412fe3f5e3e984e95759cff2c10
sources:
  - id: rulesets-phase
    resource: ../../package/src/sync/phases/rulesets.ts
---

# A renamed ruleset creates a second one

## Condition

GitHub identifies a repository ruleset by a numeric id assigned at
creation. `reposets.config.toml` identifies a ruleset only by its
`[rulesets.<key>]` name — there is no id in the config at
all[^rulesets-phase]. The `rulesets` phase reconciles by building a `Map`
of live rulesets keyed by name (`live.has(payload.name)`) and upserting by
that same name, so it matches purely on the current name string[^rulesets-phase].

## Symptom

Changing a ruleset's `name` field in config — while leaving everything
else the same — does not rename the existing GitHub ruleset. `syncRuleset`
looks up the *new* name in the live listing, finds nothing there, and
creates a second ruleset with the new name; the original, now unreferenced
by that name, is left in place under its old name[^rulesets-phase]. A
repository ends up with two rulesets doing overlapping work until
something removes the old one.

## What resolves it, and what does not

`cleanup.rulesets` (see
[`enabled-cleanup-scope-deletes-everything-undeclared`](../decisions/enabled-cleanup-scope-deletes-everything-undeclared.md))
removes the orphan on the next run, because the renamed ruleset's old name
is no longer declared by any group and the scope's undeclared-resource
sweep deletes it — after first confirming it is not an organization-inherited
ruleset. Without `cleanup.rulesets` enabled, both rulesets remain
indefinitely, since nothing else in the sync pipeline ever looks at a
ruleset it is not currently asked to reconcile by name.

## Why this is acceptable

`GET /repos/{owner}/{repo}/rulesets` returns ruleset summaries — name, id,
source type — not the full rule configuration, so the phase already
accepts presence-level rather than value-level drift detection for
rulesets. Matching by name is the same shape of tradeoff carried one step
further: it is the behavior this repository's v3 line had before the
rebuild, ported deliberately rather than accidentally lost.

## What a fix would take

Either giving config-level identity a stable handle a rename cannot
change — recording the GitHub-assigned id in `AppliedState` the first time
a ruleset is created, and upserting by id thereafter instead of by
name — or matching live rulesets to config entries by content rather than
by name, which trades false renames for false content-collisions. Both are
a design change to how rulesets are compared, not a port.

[^rulesets-phase]: `package/src/sync/phases/rulesets.ts`
