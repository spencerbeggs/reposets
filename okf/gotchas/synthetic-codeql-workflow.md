---
title: GitHub's own CodeQL workflow satisfies the check it should fail
description: Configuring CodeQL default setup makes GitHub add a synthetic workflow that persists after the setup is removed, and would otherwise make the actions language look satisfiable on a repository with no workflow files
type: Gotcha
stale_after: 2027-02-16T00:00:00Z
tags:
  - github
  - testing
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: dbb45b89e5702c6c5e059dddecb849c91843b5147dffdc9b9f3b86b3cfa887eb
sources:
  - id: code-scanning
    resource: "../../package/src/sync/phases/code-scanning.ts"
  - id: phases-test
    resource: "../../package/__test__/sync/phases.test.ts"
---

# GitHub's own CodeQL workflow satisfies the check it should fail

## What a reader sees

A repository with no workflow files under `.github/workflows/` reports
`total_count: 1` from `GET /repos/{owner}/{repo}/actions/workflows`
after CodeQL default setup has ever been configured on it — and stays
at `total_count: 1` even after default setup is set back to
`not-configured`. On a second sync run, the `actions` CodeQL language
check then passes for a repository that should, by every visible
signal, have no workflows to justify it.

## What that looks like it means

That the repository genuinely has a workflow, or that the `actions`
language check is reading stale or wrong data — either way, that the
gate meant to reject "no workflow files" isn't working.

## What is actually true

Configuring CodeQL default setup makes GitHub add a synthetic workflow
of its own, named `CodeQL` at the path
`dynamic/github-code-scanning/codeql` — not a file in the repository,
but an entry that appears in the same workflow listing as real ones.
That entry survives setting default setup back to `not-configured`, so
any repository that was ever configured reports it forever[^code-scanning].

`codeScanningPhase` counts only listed workflows whose `path` starts
with `.github/workflows/`, specifically to exclude this synthetic entry.
Without the path filter, the count would be self-confirming: a
repository with no real workflows drops the `actions` language on its
first sync, CodeQL's own workflow then appears in the listing because
default setup just ran, and every sync after that sees "a workflow" and
sends `actions` on the strength of an artifact reposets itself
caused to exist[^code-scanning].

Workflow **state** is deliberately not filtered — a disabled workflow
still counts. This was verified live against GitHub: an otherwise-empty
repository with one workflow in `disabled_manually` state is accepted
when `actions` is configured, zero workflows is a 422, and the synthetic
CodeQL workflow alone is also a 422[^code-scanning]. GitHub's rule is the
file's path, never its state, so narrowing the count to `active`
workflows would reproduce the same 422 on exactly the repositories that
park a workflow rather than delete it. A test pins this: `"counts a
disabled workflow, because GitHub does"` sends a single
`disabled_manually` workflow at `.github/workflows/ci.yml` and asserts
the phase does not report "no workflow files" and does send the PATCH
request[^phases-test].

[^code-scanning]: `../../package/src/sync/phases/code-scanning.ts`
[^phases-test]: `../../package/__test__/sync/phases.test.ts`
