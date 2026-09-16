---
type: Convention
title: Effect patterns
description: How Effect v4 idioms are used consistently across this codebase — services, errors, logging, credentials, layers.
stale_after: 2027-03-16T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 285c5c60729d7d66eef5b67d69313c836f1191e47de16f702b61d9416fbb1bbe
tags: [effect, architecture]
---

# Effect patterns

Build on **`effect/unstable/cli`, from core**. `@effect/cli` does not exist on
the Effect v4 line — do not reach for it.

Define a service as a `Context.Service` class, never a bare `Context.Tag`.
`package/src/services/OnePasswordClient.ts`, `CredentialResolver.ts`, and
`package/src/sync/SyncEngine.ts` all follow this shape: the class extends
`Context.Service<Self, Shape>()("tag/string", { make: ... })`, and a `Layer`
is built with `Layer.effect`/`Layer.succeed` over that `make` — never a
`Layer.scoped` where the plain form suffices, and never a service's own
implementation module reaching for `Layer.provide` on itself.

Model an error as a tagged data class extending `Data.TaggedError`, never a
plain `Error` subclass or a bare string tag. `ResolveError`
(`package/src/services/CredentialResolver.ts:32-43`),
`OnePasswordError` (`package/src/services/OnePasswordClient.ts:21-30`), and
`ConfigFlagNotFound` (`package/src/services/ConfigFiles.ts:117-128`) each
override `get message()` so the class renders a useful string rather than a
bare `Tag:` prefix with the payload never reaching the log line.

In CLI commands, log through `Effect.log`/`Effect.logError`, never
`Console.log`/`console.log` directly. `CliLoggerLive`
(`package/src/cli/logger.ts`) replaces Effect's default logger for the whole
process and routes `Error`/`Fatal` severity to stderr, everything else to
stdout — a direct console write bypasses that routing entirely, which is the
one thing `reposets sync > log.txt` depends on to keep failures visible on
the terminal while a redirected log only captures progress.

Route every line the sync pipeline emits through `SyncLogger`
(`package/src/services/SyncLogger.ts`), never through `Effect.log` calls
scattered across phases. `SyncEngine` and every phase describe *what*
happened; `SyncLogger` decides how to say it, and that split is what let the
four verbosity tiers collapse to one output plus a `debug` flag without
touching a single phase.

Keep a resolved credential as `Redacted.Redacted<string>` end to end, and
unwrap it with `Redacted.value` only where a value must physically leave the
process, be fingerprinted for drift comparison, or be substituted as a
literal in an API payload — never to log, print, or serialize it. Five call
sites do this today, enumerated in
[`invariants/resolved-credentials-are-redacted.md`](../invariants/resolved-credentials-are-redacted.md):
a numeric-id substitution in `rulesets.ts`, a fingerprint-only unwrap in each
of `secrets.ts` and `variables.ts` (the secrets write itself passes the
still-`Redacted` value through to `@effected/github`'s sealed box), and the
two literal write calls in `variables.ts`, since GitHub Actions variables are
not secret. `Redacted.value` is deliberately the only way to read the
plaintext, because it greps: a codebase-wide search for it enumerates every
place a secret is permitted to exist unwrapped, which is the property
`Redacted` exists to make checkable.

Wrap I/O in `Effect.try`/`Effect.tryPromise`, never a bare `try`/`catch` or an
un-lifted Promise. `CredentialResolver.ts:90` uses `Effect.try` for a
synchronous file read; `OnePasswordClient.ts:91` uses `Effect.tryPromise` for
the SDK call. Each `catch` maps to the tagged error the surrounding service
already defines, never to a raw `Error` re-thrown.

Provide layers at the entrypoint (`package/src/cli/index.ts`) and inside a
per-command handler (`package/src/cli/commands/sync.ts`'s `sharedLayer` and
per-partition `engineLayer`), never inside a service's own implementation
module. A service that provides its own dependencies cannot be swapped for a
test double without editing the service itself.

Catch a `GitHubError` per operation rather than letting one propagate and
abort the run. `attempt` (`package/src/sync/phase.ts:180-191`) is the shared
helper: it folds a failure into `PhaseResult.errors` with the failure's own
`message` preserved, so a rejected ruleset on one repository is reported in
its own words and the run continues to the next repository rather than
dying.
