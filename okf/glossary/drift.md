---
title: Drift
description: A live value that differs from the applied baseline while the config still matches that baseline
type: Glossary
tags:
  - docs
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 9e2c2817b4732a34f6856c5a4c19fb260462ab980f7099dd6d0e74f5680bf2df
sources:
  - id: decide
    resource: "../../package/src/sync/decide.ts"
---

# Drift

In reposets, "drift" means specifically: the value GitHub currently
reports for a resource differs from the fingerprint reposets last
recorded as applied, while the resource's config still matches that same
baseline. Someone changed the resource outside reposets — in the GitHub
UI, through another tool, by hand against the API — and that is the only
condition `decide` labels `Drift`[^decide].

This is narrower than the everyday sense of the word, and the repository
draws two boundaries around it on purpose:

- **`ConfigChanged` is not drift.** If the live value still matches the
  applied baseline but the config now asks for something else, that is
  the config moving, not the resource. Nobody touched GitHub.
- **`FirstSync` is not drift.** With no applied baseline at all there is
  no prior state to have diverged from, so `decide` cannot and does not
  claim drift on first contact — every value on a repository reposets has
  never synced reports as `FirstSync`, never `Drift`.

See [the drift decision](../decisions/drift-is-reported-and-still-converged.md)
for how a `Drift` result is handled once decided.

## The trap

A first sync after wiping local state is easy to mistake for drift, and
it is not. `reposets history prune`/`clear` delete only journal rows —
they leave the `applied_state` table untouched, so drift detection keeps
working against the same baseline it always had. `reposets nuke`, by
contrast, deletes the whole local data directory including
`applied_state`. The next `sync` or `drift` run against that repository
then has no baseline for any resource, so every resource reports
`FirstSync`, not `Drift` — even for resources nobody touched. Reading a
post-`nuke` `FirstSync` wave as evidence of out-of-band changes is the
mistake this glossary entry exists to head off.

[^decide]: `../../package/src/sync/decide.ts`
