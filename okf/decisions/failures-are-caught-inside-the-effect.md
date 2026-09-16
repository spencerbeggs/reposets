---
type: Decision
title: Failures are caught inside the effect
description: The entrypoint wraps the whole command effect in Effect.catch(reportAndExit) rather than letting an unhandled failure reach NodeRuntime.runMain's own reporting path.
status: stable
tags: [effect, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: b099c319cf73495816f1d8ad5639dc58dfa9aa0002b75ff9a351089361954d2c
sources:
  - id: cli-index
    resource: ../../package/src/cli/index.ts
  - id: cli-logger
    resource: ../../package/src/cli/logger.ts
  - id: effect-runtime
    resource: ../../.repos/effect/packages/effect/src/Runtime.ts
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:29Z
---

# Failures are caught inside the effect

`NodeRuntime.runMain` reports an unhandled failure through Effect's
*default* logger, which sits outside whatever layers the program was
provided — including `CliLoggerLive`. A failure that escapes to it prints
in the `[hh:mm:ss] ERROR (#2): …` shape `CliLoggerLive` exists to replace,
and does so on stdout, the one stream errors must not use.[^cli-logger]

So [`package/src/cli/index.ts`](../../package/src/cli/index.ts) wraps the
whole command pipeline in `Effect.catch(reportAndExit)`, *inside* the
effect passed to `NodeRuntime.runMain`, rather than letting a failure
propagate past it. `reportAndExit` logs the error through `Effect.logError`
— which does reach `CliLoggerLive`, because it fires before the effect's
own success/failure is resolved — renders a `ConfigValidationError`'s
structured `issue` through `formatSchemaIssue`, and sets
`process.exitCode = 1` itself, letting the wrapped effect return
successfully afterward.[^cli-index]

`CliLoggerLive` is merged onto `MainLive` with `Layer.mergeAll` rather than
provided beneath `AppLive`, specifically so it replaces Effect's default
logger for every line the program emits — including lines produced while
`AppLive`'s own layers are still being constructed, before the command
handler has even started.[^cli-index]

Core reportedly ships `Runtime.errorExitCode` and `Runtime.errorReported`
as marker properties an error object can carry: `errorExitCode` lets a
custom error request a specific exit code, and `errorReported` set to
`false` suppresses `runMain`'s own default-logger report of that
failure.[^effect-runtime] Together they are an alternative to catching
inside the effect — attach the markers to the error and let it escape —
worth reconsidering if this entrypoint's shape changes, though it was not
adopted here.

## Context

The `[hh:mm:ss] ERROR (#2): …` format and its stdout destination are both
properties of Effect's own default logger rather than of anything in this
package, so the only way to guarantee `CliLoggerLive`'s formatting and
stderr routing apply to *every* failure — not just the ones a handler
explicitly catches — is to keep every failure inside the scope where
`CliLoggerLive` is already the active logger.

[^cli-index]: `package/src/cli/index.ts`
[^cli-logger]: `package/src/cli/logger.ts`
[^effect-runtime]: `.repos/effect/packages/effect/src/Runtime.ts`
</content>
