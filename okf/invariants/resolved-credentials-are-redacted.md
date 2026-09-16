---
title: Every value CredentialResolver returns is Redacted
description: resolveGitHubToken and resolveAll return Redacted.Redacted<string> only, so a secret cannot reach toString, interpolation or JSON.stringify by accident.
type: Invariant
status: draft
resource: ../../package/src/services/CredentialResolver.ts
tags: [security, effect]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 733f862df39be21dfeb5a9b9c9057138df8dcdf4ce4a9eb37ac22e205db8c1b3
sources:
  - id: credential-resolver
    resource: ../../package/src/services/CredentialResolver.ts
  - id: rulesets-phase
    resource: ../../package/src/sync/phases/rulesets.ts
  - id: secrets-phase
    resource: ../../package/src/sync/phases/secrets.ts
  - id: variables-phase
    resource: ../../package/src/sync/phases/variables.ts
---

# Every value `CredentialResolver` returns is `Redacted`

## Property

`CredentialResolver.resolveGitHubToken` and `CredentialResolver.resolveAll` return `Redacted.Redacted<string>` (a token) and `ReadonlyMap<string, Redacted.Redacted<string>>` (every `[resolve]` label) respectively, never a plain `string`[^credential-resolver]. A `Redacted` value renders as `<redacted>` through `toString`, template interpolation and `JSON.stringify`, so the common ways a secret escapes a log line, an error message, or a serialized object are closed structurally rather than by convention[^credential-resolver]. Reading the plaintext requires the explicit call `Redacted.value(...)`, which is what makes every unwrap in the codebase greppable[^credential-resolver].

## Mechanism

Every path inside `CredentialResolver.make` that produces a resolved value wraps it before returning: `fromEnv` wraps with `Redacted.make(value, { label })`, `fromFile` wraps the file's trimmed contents the same way, `fromOnePassword` returns whatever `OnePasswordClient.resolve` already returns as `Redacted`, and the inline `value` sub-group wraps its string-or-JSON-stringified value with `Redacted.make` too[^credential-resolver]. There is no branch in `resolveAll` that returns an unwrapped string.

`Redacted.value` is called only where a resolved value must physically leave the process, be fingerprinted for drift comparison, or be substituted as a literal in an API payload — never to log, print, or serialize it. The current call sites, all under `package/src`:

- `package/src/sync/phases/secrets.ts:100` — `fingerprint(Redacted.value(value))`, to compute the desired-state fingerprint for drift comparison; the write call itself (`secrets.set(name, value, scope)` / `secrets.setForEnvironment(...)`, a few lines below) passes the still-`Redacted` value through to `@effected/github`'s `RepositorySecret` service, which performs the sealed-box encryption and unwrap internally[^secrets-phase].
- `package/src/sync/phases/variables.ts:112` — the same fingerprint unwrap, for variables' drift comparison[^variables-phase].
- `package/src/sync/phases/variables.ts:135` and `:136` — the unwrap at the actual write call, `variables.set(name, Redacted.value(value))` and `variables.setForEnvironment(environment, name, Redacted.value(value))`, since GitHub Actions variables are not secret and the plaintext is sent as-is rather than sealed[^variables-phase].
- `package/src/sync/phases/rulesets.ts:57` — `const text = Redacted.value(value)`, inside `substituteResolved`, the sole unwrap in that file; the docstring states it is deliberate because a `{ resolved }` reference in a ruleset always resolves to a numeric id (an integration id, a repository id), never a secret, and a config that puts a secret there has mis-declared it[^rulesets-phase].

## What would break it

Adding a branch to `CredentialResolver.make` that returns a plain `string` — for example, an inline `value` entry short-circuited before it reaches `Redacted.make` — would make that one resolution path bypass every structural protection the type otherwise guarantees, reopening exactly the `toString`/interpolation/`JSON.stringify` leak paths the return type exists to close. Unwrapping inside `SyncLogger` or any other logging call site, rather than only at a write or a fingerprint computation, would defeat the same guarantee from the consuming side: the type stops meaning anything the moment a caller is allowed to hold the unwrapped value past the single call site that needs it.

[^credential-resolver]: `package/src/services/CredentialResolver.ts`
[^secrets-phase]: `package/src/sync/phases/secrets.ts`
[^variables-phase]: `package/src/sync/phases/variables.ts`
[^rulesets-phase]: `package/src/sync/phases/rulesets.ts`
