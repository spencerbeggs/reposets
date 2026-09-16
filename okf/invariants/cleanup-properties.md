---
title: Cleanup phase properties
description: Three properties the cleanup phase holds by construction, each pinned by a test.
type: Invariant
resource: ../../package/__test__/sync/phases.test.ts
tags: [testing, security]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 901ce933ea8975068d2f0536d717495e91ee284b0d495ef9abfb60d591f913bf
sources:
  - id: phases-test
    resource: ../../package/__test__/sync/phases.test.ts
  - id: cleanup-phase
    resource: ../../package/src/sync/phases/cleanup.ts
---

# Cleanup phase properties

## Property

The `cleanup` phase — the only phase that deletes anything — holds three
properties by construction, each pinned by a test in
`package/__test__/sync/phases.test.ts` under `describe("cleanup phase")`
that fails if the property is mutated away[^cleanup-phase]:

1. **An organization's inherited rulesets are never deleted.** The
   ruleset sweep filters `rulesets.list()` on `entry.source_type !==
   "Organization"` before anything is asked whether it is undeclared, so
   an inherited ruleset can never even reach the undeclared check[^cleanup-phase].
   Pinned by `"never deletes a ruleset inherited from the organization"`
   (`phases.test.ts:1138`), which seeds one repository-owned and one
   organization-owned ruleset, declares neither, enables
   `cleanup.rulesets`, and asserts only the repository-owned one is
   deleted[^phases-test].

2. **Every deletion calls `applied.forget`.** The sweep loop calls
   `applied.forget({ repo, kind, name })` immediately after a successful
   delete, before recording the change[^cleanup-phase] — otherwise a
   resource recreated in a later run would be compared against a
   fingerprint recorded before the deletion and report drift nobody
   caused. Pinned by `"forgets the applied-state row for every deletion"`
   (`phases.test.ts:1159`), which seeds two applied-state rows, deletes
   one live resource, and asserts only that row's fingerprint is gone
   while the untouched sibling row survives[^phases-test].

3. **A dry run deletes nothing, but names everything it would.** The
   sweep's delete branch is gated on `!ctx.dryRun`, so on a dry run no
   delete request is built and no `applied.forget` call happens, while the
   same target names are still pushed into `changes`[^cleanup-phase].
   Pinned by `"deletes nothing on a dry run, but reports and remembers"`
   (`phases.test.ts:1177`), which asserts the only outbound request is the
   listing `GET`, the reported change still names the stale resource, and
   the resource's applied-state row is unchanged after the run[^phases-test].

## Mechanism

All three properties live in `cleanupPhase`'s shared `sweep()` helper
(`package/src/sync/phases/cleanup.ts`), which every scope (secrets,
variables, rulesets, environments) routes through — so a refactor that
adds a new sweepable scope inherits all three properties rather than
having to reimplement them.

## What would break it

Any of: removing the organization-source filter from the ruleset listing
before the undeclared() call, moving or dropping the `applied.forget`
call, or removing the `!ctx.dryRun` gate around the delete-and-forget
block while still naming targets in `changes`. Each is a one-line change
that the corresponding test in `phases.test.ts` catches directly.

[^cleanup-phase]: `package/src/sync/phases/cleanup.ts`
[^phases-test]: `` package/__test__/sync/phases.test.ts ``
