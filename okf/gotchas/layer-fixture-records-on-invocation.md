---
title: A prepared-but-unrun fixture request still reads as sent
description: GitHubClient.layerFixture records a call when the request function is invoked, not when the effect it returns is run — a built-but-unexecuted delete looks like it happened.
type: Gotcha
status: draft
stale_after: 2027-03-16T00:00:00Z
tags: [testing, github]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 5b2a3c9eed014574a0fbc9ad44b4ce9a16d099cea970f3cd6b8c0891597327ee
sources:
  - id: cleanup-phase
    resource: ../../package/src/sync/phases/cleanup.ts
---

# A prepared-but-unrun fixture request still reads as sent

## What a reader sees

A test built against `@effected/github`'s `GitHubClient.layerFixture` asserts that a *disabled* cleanup scope issued no delete requests, or that a `--dry-run` sync deleted nothing. Building the delete effects for every live resource — even ones the test never intends to run — and then only running some of them still shows every one of those requests as recorded by the fixture, because the recording happened at the point each request-producing function was called to build its effect, not at the point that effect was executed.

## What is actually true

`GitHubClient.layerFixture` records a call when the request function is **invoked** — i.e. when the code that would send it is called to produce an `Effect` — not when the `Effect` it returns is actually run. A prepared-but-unrun effect therefore reads as a request that was sent. `package/src/sync/phases/cleanup.ts` documents this explicitly on `Sweepable.remove`: "a thunk, not a prepared effect... building a delete for every live resource and running only some of them records deletions that never happened"[^cleanup-phase]. The same reasoning is repeated on the `live` field of the `sweep` options: a disabled scope must issue *no request at all*, which is only true if the listing itself is never even constructed, not merely never awaited[^cleanup-phase].

`cleanupPhase`'s `sweep` function therefore builds both the listing (`options.live`) and each deletion (`target.remove`) as zero-argument thunks — `() => Effect.Effect<...>` — rather than as already-built `Effect` values, and only calls them once the scope has been confirmed enabled and the target has been confirmed undeclared (`package/src/sync/phases/cleanup.ts:126-201`, the `sweep` function body, and the `Sweepable` interface at `package/src/sync/phases/cleanup.ts:29-43`)[^cleanup-phase].

## Where this shows up

Anywhere `GitHubClient.layerFixture` backs a test that distinguishes "built" from "sent" — most directly the cleanup phase's disabled-scope and dry-run guarantees, which is why both are built as thunks rather than prepared effects and why the phase's own docstrings call this out by name rather than leaving it implicit.

[^cleanup-phase]: `package/src/sync/phases/cleanup.ts`
