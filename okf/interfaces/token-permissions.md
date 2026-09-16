---
title: Token permissions
description: The fine-grained GitHub PAT permission set a full reposets sync needs, as a single authoritative list rather than a maintained document
type: Interface
kind: runtime
resource: ../../package/src/cli/commands/doctor.ts
tags:
  - security
  - github
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: b652ff6f5956562542dae675d4a20b16bafaae0578160bbe0f3fca9165073bbb
sources:
  - id: doctor
    resource: "../../package/src/cli/commands/doctor.ts"
---

# Token permissions

reposets needs a fine-grained personal access token, not a classic one.
`REQUIRED_PERMISSIONS` in `doctor.ts` is the single authority for which
scopes that token needs, and `reposets doctor` prints it verbatim as part
of its diagnostic output[^doctor]. No document — including this one —
maintains a second copy of the list; read it off `doctor.ts`, or run
`reposets doctor`, rather than trusting a table transcribed anywhere
else, because a hand-maintained second list is exactly how the wrong
entry described below shipped.

The current scope list, by category:

- **Repository > Administration (Read and write)** — settings sync
- **Repository > Secrets (Read and write)** — Actions, Codespaces and
  environment secrets
- **Repository > Variables (Read and write)** — Actions and environment
  variables
- **Repository > Environments (Read and write)** — deployment environment
  sync
- **Repository > Dependabot secrets (Read and write)** — Dependabot
  secrets
- **Repository > Code scanning alerts (Read and write)** — CodeQL default
  setup
- **Repository > Actions (Read)** — count workflow files for the CodeQL
  `actions` language
- **Repository > Dependabot alerts (Read and write)** — vulnerability
  alerts and automated fixes
- **Repository > Secret scanning alerts (Read and write)** — secret
  scanning and delegated bypass
- **Organization > Members (Read)** — resolve team slugs, org-owned repos
  only

`Metadata: Read` is mandatory on every fine-grained token and is granted
automatically, so it needs no separate entry and reposets does not list
it as something to enable.

## Two entries that read as mistakes and are not

**Repository > Actions is Read, not Read and write.** The code-scanning
phase only *lists* workflows, to decide whether the `actions` CodeQL
language is settable — GitHub validates that language against workflow
files, and the language-detection endpoint cannot see it. The phase
never starts, stops, enables, or disables a workflow, so granting write
would hand a tool that only counts files the ability to disable every
workflow in a repository, for no capability it uses[^doctor].

**There is no account-level permission**, and this is corrected from an
earlier, wrong assumption rather than an oversight. An earlier list
named `Account permissions > GPG keys (Read and write)` as the scope
secret encryption needed. That is wrong: the public keys used to seal a
secret's value come from repository-scoped endpoints — `GET
/repos/{owner}/{repo}/actions/secrets/public-key` and the Dependabot,
Codespaces and environment equivalents — already covered by the
repository Secrets permission above. Account-level GPG keys governs
`/user/gpg_keys`, a user's commit-signing keys, which reposets never
touches; following the old list granted an unnecessary account-wide
scope while granting nothing the tool actually used[^doctor].

[^doctor]: `../../package/src/cli/commands/doctor.ts`
