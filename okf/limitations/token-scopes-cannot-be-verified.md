---
title: Token scopes cannot be verified
description: doctor prints the required permission list as a requirement, never as a verification, because GitHub does not expose a fine-grained PAT's own scopes
type: Limitation
bounds: ../interfaces/token-permissions.md
tags:
  - security
  - github
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 87cfcf939ac981d7d470c6125d22d039d023177f6596a7b6914ae138fcea45b7
sources:
  - id: doctor
    resource: "../../package/src/cli/commands/doctor.ts"
---

# Token scopes cannot be verified

`reposets doctor` prints the [required permission list](../interfaces/token-permissions.md)
and, immediately after it, says plainly that the list is not checked:
"These are NOT verified — GitHub does not expose a fine-grained token's
own scopes."[^doctor] That sentence exists because the printed list
otherwise reads like a checklist that has already been checked, and it
has not.

## Why

GitHub's API reports a permission set for **App installation tokens**
only. A fine-grained personal access token's own granted scopes are not
readable through any endpoint reposets or its dependencies can call.
`doctor` resolves each credential profile's token and calls `GET /user`
with it — the cheapest question that proves the token is live and
unrevoked — but a successful `GET /user` says nothing about which of the
scopes in the required list were actually granted.

## The observable symptom

A token that authenticates cleanly can still fail partway through a
sync: `GET /user` succeeds, `doctor` reports the credential as resolved,
and the run proceeds to write settings, environments and rulesets
successfully — then 403s on secrets and variables, or on whichever scope
was left ungranted. Nothing before that point can distinguish "this
token has every required scope" from "this token has enough scopes to
authenticate and write the first few resource kinds a sync happens to
reach."

## Why this is acceptable, and what a fix would take

There is nothing reposets can do about this on its own side: it is a gap
in the GitHub API surface for fine-grained PATs, not a check reposets
chose not to write. The mitigation available today is printing the
required list plainly and pairing it with the disclaimer, so a 403
midway through a run points back at a list to compare by hand rather
than presenting as a mystery. A fix would need GitHub to ship an
endpoint that reports a fine-grained PAT's own granted permissions,
comparable to what already exists for App installation tokens; until
that exists, this limitation is not liftable from this codebase.

[^doctor]: `../../package/src/cli/commands/doctor.ts`
