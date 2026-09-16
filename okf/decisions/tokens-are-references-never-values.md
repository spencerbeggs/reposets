---
title: Tokens are references, never values
description: github_token and op_service_account are addresses only; no field in the credentials file ever holds a plaintext secret.
type: Decision
status: stable
tags: [security]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 81f22c9f0b471c3b6f42bf9097f5a5828002f6701c2adafc858d9f64efe9d17e
sources:
  - id: credentials-schema
    resource: ../../package/src/schemas/credentials.ts
  - id: credential-resolver
    resource: ../../package/src/services/CredentialResolver.ts
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:24Z
---

# Tokens are references, never values

## Context

`github_token` decodes against `CredentialSourceSchema`, a union of exactly `{ op = "op://..." }` or `{ env = "VAR" }`[^credentials-schema]. `op_service_account` is not in the credentials schema at all: the 1Password service-account token that unlocks every `op://` reference comes from the `OP_SERVICE_ACCOUNT_TOKEN` environment variable, never from a field in the file[^credentials-schema]. A previous version of `reposets.credentials.toml` accepted a literal token string and a literal `op_service_account_token` field.

## Decision

A credentials file is the file people are most likely to copy, share in a support thread, or accidentally commit, so the only thing it is allowed to contain is an address, never a secret[^credentials-schema]. `OpReferenceSchema` and `EnvReferenceSchema` each carry a single string field — a 1Password reference or an environment variable name — and `CredentialSourceSchema` is a two-member union of exactly those, with no bare-string or inline-value branch[^credentials-schema]. `CredentialResolver.resolveGitHubToken` turns that reference into a usable credential at run time: `{ op }` resolves through the 1Password SDK, `{ env }` reads the named environment variable, and the plaintext token is `Redacted.Redacted<string>` the moment it exists in the process[^credential-resolver]. `{ env }` exists specifically for CI, where a platform secret store injects the value and no 1Password service account is available[^credentials-schema].

A user grants access to one scoped 1Password vault by exporting `OP_SERVICE_ACCOUNT_TOKEN` in their own shell, rather than pasting a service-account token into a file this CLI also asks them to keep out of version control.

## Alternatives rejected

- **A literal `github_token` string field.** Puts the plaintext credential in the exact file most likely to be copied or committed.
- **A literal `op_service_account_token` field.** Stores the credential that unlocks every other credential in the file, which is strictly worse than storing one token.

## Consequences

- `reposets.credentials.toml` is credential-free but not categorically secret-free: `[profiles.<name>.resolve.value]` can still hold an inline non-secret value such as an SBOM supplier block or a registry list, because that section serves named values generally rather than credentials specifically[^credentials-schema]. Keeping the whole file out of version control is still the right default.
- Resolving a token or a `[resolve]` label can fail for reasons distinguishable to the operator — an unset environment variable, a missing 1Password item — because `ResolveError` carries the label and the sub-group that failed, never a value[^credential-resolver].

[^credentials-schema]: `package/src/schemas/credentials.ts`
[^credential-resolver]: `package/src/services/CredentialResolver.ts`
