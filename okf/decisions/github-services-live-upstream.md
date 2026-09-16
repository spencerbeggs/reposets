---
title: GitHub resource services live upstream, in @effected/github
description: Every GitHub resource service and the secret sealed-box encryption live in @effected/github, not this repository; sync merges eight of them over one client.
type: Decision
status: stable
tags: [architecture, github, deps, effect]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: b228913c1ab1852e2a918ff489c7fc0d2414eb64934a78f31cf0c86fde821373
sources:
  - id: sync-command
    resource: ../../package/src/cli/commands/sync.ts
  - id: sync-engine
    resource: ../../package/src/sync/SyncEngine.ts
  - id: package-json
    resource: ../../package/package.json
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:27Z
---

# GitHub resource services live upstream, in `@effected/github`

## Context

`package/package.json` pins `"@effected/github": "catalog:effected"`[^package-json]. Nothing under `package/src` wraps the GitHub API: there is no `package/src/services/github/` directory and no `package/src/lib/crypto.ts`. A previous design kept both in this repository; the v4 rebuild moved every GitHub resource service, and the libsodium sealed-box encryption used for secrets, upstream into `@effected/github` along with it.

## Decision

`syncHandler` imports eight resource services from `@effected/github` — `GitHubRepository`, `Ruleset`, `RepositorySecurity`, `CodeScanning`, `DeploymentEnvironment`, `RepositorySecret`, `RepositoryVariable`, `WorkflowDispatch` — and merges their layers with `Layer.mergeAll(...).pipe(Layer.provideMerge(GitHubClient.layerFromToken({ token })))`, once per credential-profile partition[^sync-command]. `SyncEngineLive` then feeds `allPhases` on top of that merged layer[^sync-command].

Two properties of this boundary are load-bearing in this repository rather than upstream:

- **A token is fixed at `GitHubClient` construction.** Every resource service in the merged layer is built from that one client, so a second identity is a second service graph — there is no swapping one mid-run. This is the reason `sync` partitions groups by credential profile at all, and why the run boundary had to move to the command rather than stay in the engine.
- **The resource services take no `owner`/`repo` argument.** Each resolves `Repo` from context per call, which is what lets `SyncEngineLive`'s type parameter bind every other phase requirement at layer construction while carrying `Repo` as the one deliberate exception in `R` — discharged once, at the repository loop, the single place that knows which repository is in play[^sync-engine].

## Alternatives rejected

Nothing in this repository re-implements a resource service or the sealed-box encryption; both possibilities were foreclosed by the rebuild moving them upstream, so there is no local alternative under consideration here — only the boundary the move drew.

## Consequences

- Reading `@effected/github`'s own source is the authority for those services' interfaces and behavior; no design doc in this repository documents them independently.
- A defect in a paginated GitHub read is a defect to fix upstream, not locally: every list read in these services was found truncated to its first page — including the ruleset existence check that decides create-versus-update — and was fixed in `@effected/github` and adopted here via the pinned version, rather than patched in this repository.

[^sync-command]: `package/src/cli/commands/sync.ts`
[^sync-engine]: `package/src/sync/SyncEngine.ts`
[^package-json]: `package/package.json`
