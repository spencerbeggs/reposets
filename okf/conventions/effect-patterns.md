---
type: Convention
title: Effect patterns
description: How Effect v4 idioms are used consistently across this codebase — services, errors, output and logging, process confinement, credentials, layers.
stale_after: 2027-03-16T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-10-03T18:11:28Z
  body_sha256: f8b76cbd1952700323ae471827b0652030aa0214d7e8777bb6d538b61b7ed78d
tags: [effect, architecture]
---

# Effect patterns

Build on **`effect/cli`, from core**. `@effect/cli` does not exist on
the Effect v4 line — do not reach for it. `@effected/cli` is a different
package: the kit's boundary layer over core's CLI (`CliRuntime`, `CliLogger`,
`CliExit`, `CliAudience`, `CliMessage`, `Doc`, `CliInteractive`, `CliTest`,
and the prompts and live view in `@effected/cli/ui`), and the entrypoint
runs under its `CliRuntime.main`.

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

In CLI commands, print a report as a `Doc` document with `Doc.print`, and a
one-line outcome as a `CliMessage` line: `success` or `info` to stdout,
`warning` or `failure` to stderr. Both render for the audience, plain for an
agent and styled for a person, so never hand-paint a glyph or an escape.
Write a finding that exits 1, such as `No config found` or a dangling
reference, with `CliMessage.failure`, never `Effect.logError`: no log level
silences it, so a run that did nothing always says why. Keep `Effect.log*`
for diagnostics, which `CliLogger.layer()`, installed by `CliRuntime.main`
in `package/src/cli/index.ts`, sends to stderr at every level, and never use
it as a route to stdout. Never call `console.log` or `process.stdout.write`
directly: `CliLogger`, `CliTest` and the live view's `logConsole` all read
the `Console` off the fiber, and a direct write bypasses the routing a test
captures and tears a live view's frame. See
[`decisions/adopt-interactive-cli-kit-v2.md`](../decisions/adopt-interactive-cli-kit-v2.md).

Ask a question only behind `CliInteractive`, and give every prompt a
non-interactive answer: refuse with `CliError.UserError` naming the flag
that answers it, or take the default the command always took. Never probe
stdin or `TERM` yourself. Leave the kit's `Cancelled` to propagate, so
`CliRuntime.main` prints its one line and exits 130. Keep JSX in
`package/src/cli/views/` and load it through `CliUi.lazyView` from a
JSX-free module, so a run that draws nothing never loads React or Ink;
keep that JSX-free module apart from any module the JSX imports, or the
lazy import is an import cycle.

End a command by what went wrong, not by setting a code. Fail with
`CliError.UserError` when the invocation was wrong (exit 64), and call
`CliExit.set(1)` and return when the command ran and found a problem
(exit 1). Let a config read or decode failure propagate so `main` renders
it. Never write `process.exitCode`. See
[`decisions/cli-runtime-main-builds-the-environment-v2.md`](../decisions/cli-runtime-main-builds-the-environment-v2.md).

Read `process` only in `package/src/cli/index.ts`, and there only for the
working directory and the build-time version. Everything below the
entrypoint gets those two from the `Invocation` service
(`package/src/services/Invocation.ts`), and asks `CliInteractive` whether
it may prompt. Do not import `node:process` in a command or service.
Tests hand a command a different directory through `Invocation.layer(...)`
instead of calling `process.chdir`. The one exception today is config
discovery, where `@effected/config-file`'s `ConfigResolver.upwardWalk`
reads the process cwd itself. That is why
`package/__test__/cli/commands.test.ts` still calls `process.chdir`, and it
is a known follow-up.

Read an environment variable through `Config`, as
`Config.option(Config.String(name))`, never through `process.env`.
`OnePasswordClient` reads `OP_SERVICE_ACCOUNT_TOKEN` this way,
`CredentialResolver` reads `{ env = "VAR" }` references this way, and so
does `doctor`'s service-account line. In a test, provide the environment as
`ConfigProvider.layer(ConfigProvider.fromEnv({ env }))` with
`Layer.provideMerge`, not `Layer.provide`. `Config` is read when a method
runs, in the caller's fiber, so a provider hidden inside the layer never
reaches it, and the reads fall back to the real process environment. See
[`gotchas/config-provider-hidden-by-provide.md`](../gotchas/config-provider-hidden-by-provide.md).

Route every line the sync pipeline emits through `SyncLogger`
(`package/src/services/SyncLogger.ts`), never through `Effect.log` calls
scattered across phases. `SyncEngine` and every phase describe *what*
happened; `SyncLogger` decides how to say it, and that split is what let the
four verbosity tiers collapse to one output plus a `debug` flag without
touching a single phase. `SyncLogger` streams its report lines with
`Console.log` on stdout and its failures with `CliLog.status` on stderr,
and publishes a `SyncEvent` beside each line when a live view is drawn.

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
un-lifted Promise. `CredentialResolver.ts:94` uses `Effect.try` for a
synchronous file read; `OnePasswordClient.ts:96` uses `Effect.tryPromise` for
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
