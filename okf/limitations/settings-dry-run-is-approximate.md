---
type: Limitation
title: A settings dry run reports the request, not the write
description: A dry run of the settings phase reports the fields the config would send; only a real run reports the fields @effected/github's applySettings actually sent.
bounds: ../interfaces/cli.md
tags: [github, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 29838d774596035435af68f6f67f59924210b33e0cd7bf9c3f81aa45dbe1fe06
sources:
  - id: settings-phase
    resource: ../../package/src/sync/phases/settings.ts
---

# A settings dry run reports the request, not the write

The settings phase only calls `settingsClient.applySettings(desired)` when
`ctx.dryRun` is false. On a real run, `applySettings` returns the fields it
actually put on the wire — `outcome.applied.rest` and
`outcome.applied.graphql` — after `@effected/github`'s own `preparePatch`
has dropped whatever GitHub would have rejected, such as a dependent key
like `merge_commit_title` when `allow_merge_commit` is `false`. A dry run
never reaches that call, so it has nothing to report but the request it
would have sent: `logger.settingsApplied(sent ?? Object.keys(desired))`
falls back to `Object.keys(desired)` precisely because `sent` is
`undefined` on every dry run.[^settings-phase]

**Condition:** running `reposets sync --dry-run` (or `reposets drift`,
which forces the same path) against a group whose merged settings include
at least one field with a dependent-key relationship to another setting.

**Observable symptom:** `would apply settings` lists a field that the
following real run's `applied settings` line does not — the dry run named
a key the eventual write silently dropped or reshaped, because the
dry run path never asks GitHub's own precondition logic what it would do
with that key.

This is acceptable because the alternative is worse: re-deriving GitHub's
dependent-key rules a second time inside the phase, so the dry-run path
can predict what `preparePatch` would drop, is exactly the shape of bug
the precondition pass elsewhere in this phase was written to remove — two
copies of one rule that can silently drift apart, and the reporting copy
is the more dangerous one because nothing fails when it does.

Closing this gap needs a preview or plan capability upstream in
`@effected/github` — something that runs `preparePatch`'s logic without
issuing the PATCH — which is a different return shape from what
`applySettings` gives today and has not been requested of that package.

[^settings-phase]: `package/src/sync/phases/settings.ts`
</content>
