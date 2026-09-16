---
type: Project
title: reposets
description: What this project is, its boundaries, and its non-goals.
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: f0dd7c4203f9c4a8bad8e12c0ec9ba66ef71486c767e7e0e380f3a7b9690dfa6
---

# reposets

## Purpose

reposets is an Effect v4 command-line tool that syncs GitHub repository
settings, secrets, variables, rulesets, deployment environments, repository
security features and CodeQL default setup across a person's or an
organization's repositories, driven from a TOML config. `reposets.config.toml`
is a distributable template: it names groups of repositories and the resource
groups (`[settings.*]`, `[secrets.*]`, `[rulesets.*]`, and so on) each group
applies, but never a credential — a group only names the credential *profile*
it authenticates as. `reposets.credentials.toml` holds those profiles, and
every value inside one is a reference (`{ op = "op://..." }` or
`{ env = "VAR" }`) resolved at runtime, never a value stored on disk. That
split is what makes the config file safe to commit and share while the
credentials file stays local and out of version control.

## Boundaries

This repository owns the CLI surface (`package/src/cli`), the config and
credentials schemas (`package/src/schemas`), the phase pipeline that decides
what to write and in what order (`package/src/sync`), the local state a run
reads back to detect drift (`package/src/store`), and the small set of
services that turn a config into GitHub API calls
(`package/src/services`) — `ConfigFiles`, `CredentialResolver`,
`OnePasswordClient`, `SyncLogger`. Everything that actually talks to the
GitHub REST/GraphQL surface — the eight resource services (`GitHubRepository`,
`Ruleset`, `RepositorySecurity`, `CodeScanning`, `DeploymentEnvironment`,
`RepositorySecret`, `RepositoryVariable`, `WorkflowDispatch`), `GitHubClient`
itself, and the libsodium sealed-box encryption secrets need before they can
be written — lives upstream in `@effected/github`. This repository never
re-implements a GitHub API call or a sealed-box encryption; it composes those
services into phases and decides, per repository, which of them to invoke.

## Non-goals

- Renaming a repository, changing its visibility, archiving it, or moving its
  default branch, even though all four are ordinary fields on the same PATCH
  endpoint every other setting rides on. Getting one of these wrong is not
  fixable by a second sync the way a mistyped label is — the blast radius
  argument, worked through in
  [settings-fields-deliberately-not-typed](decisions/settings-fields-deliberately-not-typed.md],
  is why they stay untyped rather than merely undocumented.
- Storing tokens, or anything derived from them, on disk. A credential in
  `reposets.credentials.toml` is always a `{ op }` or `{ env }` reference; the
  value itself only ever exists in memory, as a `Redacted.Redacted<string>`,
  for the duration of one run.
- Managing repository topics, labels, webhooks, or Actions permissions policy.
  These are real, requested surfaces reposets does not cover today; see
  [subsystems-reposets-does-not-manage](limitations/subsystems-reposets-does-not-manage.md)
  for what each would need and why none is filed as planned work.
