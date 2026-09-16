---
title: An enabled cleanup scope with nothing declared deletes everything in that scope
description: Why cleanup treats an empty declaration as "this repository should have none", not "leave alone".
type: Decision
status: stable
tags: [security, architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: ceb441570dc9645ac9a611f5fba15213383ae21bd122af7e935183385e6c70a0
sources:
  - id: cleanup-phase
    resource: ../../package/src/sync/phases/cleanup.ts
  - id: cleanup-schema
    resource: ../../package/src/schemas/common.ts
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:29Z
---

# An enabled cleanup scope with nothing declared deletes everything in that scope

## Context

`[groups.<name>.cleanup]` is per-group, and each scope in it is a
`CleanupScope`: `false` (disabled, the default), `true` (delete every
undeclared resource in that scope), or `{ preserve = [...] }` (delete
every undeclared resource except the named ones)[^cleanup-schema]. The
`cleanup` phase is the only phase that removes anything and runs last, so
every other phase's writes have already defined what "declared"
means[^cleanup-phase]. `undeclared()` computes the delete set for a scope
by filtering live resources against the group's declared names — nothing
in that function treats an empty declared set as a special case[^cleanup-phase].

## Decision

An enabled scope with nothing declared deletes everything already in that
scope. That is the literal reading of "delete what the config does not
declare", and it is intentional rather than an edge case nobody
considered: a group that turns on `cleanup.secrets.actions` while
referencing no secret groups is saying this repository should have no
Actions secrets, and there is no other syntax available to say
that[^cleanup-phase]. Every deletion is named in the sync output, and
`--dry-run` lists the same names without touching anything, so the
consequence of enabling a scope is visible before it is destructive.

Cleanup is per group, not global — `[groups.<name>.cleanup]` sits on each
group individually, so one group's declaration to delete undeclared
secrets never reaches into a sibling group's repositories[^cleanup-schema].

Deletion decisions use `declaredNames`, which reads names out of the
config without resolving any values, so a `{ file }`-kind secret or
variable group is never opened on the deletion path — cleanup can decide
what to delete without ever knowing what a file-backed secret
contains[^cleanup-phase].

## Alternatives rejected

- **Treating an empty declaration as "leave alone".** This removes the
  only way to express "this repository should have zero resources in this
  scope" — a config with cleanup enabled and no secret groups referenced
  would then be indistinguishable from cleanup being off, silently
  defeating the purpose of turning the scope on.
- **A global cleanup switch.** Collapses "sync-and-delete" onto every
  scope and every group at once, when a group frequently wants to manage
  one resource type strictly (secrets) while leaving another alone
  entirely (environments) — the per-group, per-scope shape is what lets
  those coexist.

## Consequences

- Enabling a cleanup scope is a destructive action that requires reading
  the group's full declared set correctly, not just adding the scope
  flag — an accidentally-thin `secrets.actions` reference list combined
  with `cleanup.secrets.actions = true` deletes real secrets.
- `--dry-run` is the safe way to preview an enabled scope's consequences
  before running for real, since the deletion targets are computed and
  named identically in both modes.

[^cleanup-phase]: `package/src/sync/phases/cleanup.ts`
[^cleanup-schema]: `package/src/schemas/common.ts`
