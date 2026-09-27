---
type: Decision
title: The CLI runs under @effected/cli's CliRuntime.main
description: The entrypoint assembles through CliRuntime.main, program output goes to stdout with Console.log and every Effect.log level to stderr, usage mistakes exit 64 and findings exit 1 through CliExit.
status: stable
supersedes: failures-are-caught-inside-the-effect.md
tags: [effect, dx, architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-27T17:39:49Z
  body_sha256: f72bcd714404f4129a39c4e84cfe4a236d7a7827d0ec3c43b43ad0aa1817c2ff
sources:
  - id: cli-index
    resource: ../../package/src/cli/index.ts
  - id: effected-cli
    resource: npm:@effected/cli@0.9.0
  - id: cli-sync
    resource: ../../package/src/cli/commands/sync.ts
  - id: cli-credentials
    resource: ../../package/src/cli/commands/credentials.ts
  - id: cli-nuke
    resource: ../../package/src/cli/commands/nuke.ts
  - id: cli-init
    resource: ../../package/src/cli/commands/init.ts
  - id: cli-doctor
    resource: ../../package/src/cli/commands/doctor.ts
  - id: sync-logger
    resource: ../../package/src/services/SyncLogger.ts
  - id: core-command
    resource: ../../.repos/effect/packages/effect/src/unstable/cli/Command.ts
  - id: bin-e2e
    resource: ../../package/__test__/cli/bin.e2e.test.ts
verified:
  - by: human:spencer
    at: 2026-09-27T17:38:39Z
---

# The CLI runs under @effected/cli's CliRuntime.main

## Decision

[`package/src/cli/index.ts`](../../package/src/cli/index.ts) hands the
command tree to `CliRuntime.main` from `@effected/cli` and runs the result
with `NodeRuntime.runMain`:

```ts
NodeRuntime.runMain(
  CliRuntime.main(Command.run(cli, { version: VERSION }), {
    platform: PlatformLive,
    render,
    helpOnUsageError: "stderr",
  }),
);
```

`PlatformLive` merges `App.layer`, `CliColor.formatterLayer()` and the
`Invocation` layer over `NodeServices.layer`.[^cli-index] `main` supplies
the rest in the one order that reports every failure well. The logger
(`CliLogger.layer()` by default) is outermost, so it is present on every
failure branch. The platform is provided inside failure reporting, so a
layer-build failure renders as one line. `CliExit` is provided
fresh.[^effected-cli] The entrypoint adds only a `render` callback. For a
`ConfigValidationError` it prints the error's message, then the lines
`ConfigIssueRenderer.render` produces, then the
`Run 'reposets doctor' for suggested spellings.` hint, and only when one of
those lines starts with `unknown key`. For any other failure that carries a
`cause`, it prints the cause on a second line.[^cli-index]

Five rules follow from it:

1. **Streams split by purpose, not by severity.** A command's output (the
   thing a caller redirects or parses) is written with `Console.log` and
   lands on stdout. Every `Effect.log*` level is a diagnostic and lands on
   stderr, because `CliLogger.layer()`'s default `stderrFrom` is
   `"All"`.[^effected-cli] That covers `SyncLogger`'s report lines and the
   closing summary, which are `Console.log`. `SyncLogger`'s failures are
   `Effect.logError`.[^sync-logger]
2. **A usage mistake exits 64.** A handler refuses a bad invocation by
   failing with `CliError.UserError`. `Command.runWith` prints the message
   once on stderr, and `main` maps it, like a parse error, to its default
   `usageExitCode` of 64 (BSD `EX_USAGE`).[^cli-credentials][^effected-cli]
   With `helpOnUsageError: "stderr"`, help printed beside a usage error goes
   to stderr as well, so a usage mistake writes nothing to stdout. An
   explicit `--help` still prints on stdout and exits 0.[^bin-e2e]
3. **A finding exits 1 from a handler that succeeds.** A handler that ran
   correctly and found something wrong calls `CliExit.set(1)` and returns.
   Examples are a dangling reference, a sync partition error, drift under
   `--fail-on-drift`, or a file `nuke` could not remove or `init` could not
   write. `nuke` and `init` still try every target before exiting 1. `main`
   turns the recorded code into the process exit code after the program
   succeeds.[^cli-sync][^cli-nuke][^cli-init]
4. **`doctor` always exits 0.** It is a report, and `validate` is the
   gate. A schema-validation failure or a rejected token appears in
   `doctor`'s output but never in its exit code. A CI job that needs a
   non-zero exit on a broken config runs `validate`. This was a deliberate
   ruling.[^cli-doctor]
5. **A failure that escapes a command exits 1.** A config that fails to
   read or decode propagates as an ordinary failure. `main` renders it
   through `render` and exits with its fallback code, 1. No file under
   `package/src` sets `process.exitCode`.[^cli-index]

`--log-level` is core's own filter, and it now reaches diagnostics only.
Core provides `MinimumLogLevel` around the command handler and nowhere
else.[^core-command] It therefore filters the handler's `Effect.log*`
calls. It does not reach `Console.log` output, the usage-error text
`runWith` prints, or the lines `main` renders for an escaped failure. The
report cannot be quieted by a flag at all, which
[one-output-level-plus-debug](one-output-level-plus-debug.md) records. See
[`gotchas/log-level-none-still-prints-reports.md`](../gotchas/log-level-none-still-prints-reports.md).

## Context

This supersedes
[failures-are-caught-inside-the-effect](failures-are-caught-inside-the-effect.md).
That decision hand-rolled the same fix `CliRuntime.reportFailures` now
ships: catch every failure inside the effect so the program's logger, not
Effect's default one, reports it. The old wrapper, `Effect.catch` plus
`reportAndExit`, set `process.exitCode` and used one exit code for every
failure. `CliRuntime` re-fails with core's `Runtime.errorExitCode` and
`Runtime.errorReported` marks instead, which the old decision had named as
the alternative worth reconsidering.[^effected-cli] The e2e suite runs the
built dev bin through `CliTest.sandbox` and `CliTest.run`. It pins each
rule above by exit code and by which stream carries which text.[^bin-e2e]

## Alternatives rejected

- **Keeping the hand-rolled wrapper.** It worked, but it duplicated
  `CliRuntime.reportFailures` line for line and carried none of what `main`
  adds: layer-build failures rendered as one line, a distinct usage exit
  code, and a way for a succeeding handler to record a non-zero exit
  without touching `process`.
- **`CliLogger.layer({ stderrFrom: "Error" })` to keep the old split.** This
  would have preserved "info on stdout, errors on stderr" without touching
  a single command. But it keeps diagnostics mixed into the output a caller
  redirects, and `--log-level` would keep silencing the report along with
  the noise. The kit's own guidance is that this setting is for a tool
  whose output *is* its log lines, and reposets' reports are
  documents.[^effected-cli]
- **`doctor` exiting 1 on a failed check.** This would make `doctor` a
  second gate. It was rejected by ruling: `doctor` is a report, and
  `validate` is the one command a CI job gates on.
- **`usageExitCode: 1`.** This would keep every failure on one code, as
  before. It was rejected because a CI job then cannot tell "you invoked me
  wrong" from "I ran and found a problem". The whole point of the 64-versus-1
  split is that a gate can treat the first as a broken pipeline and the
  second as a real finding.

[^cli-index]: `package/src/cli/index.ts`
[^effected-cli]: npm:@effected/cli@0.9.0
[^cli-sync]: `package/src/cli/commands/sync.ts`
[^cli-credentials]: `package/src/cli/commands/credentials.ts`
[^cli-nuke]: `package/src/cli/commands/nuke.ts`
[^cli-init]: `package/src/cli/commands/init.ts`
[^cli-doctor]: `package/src/cli/commands/doctor.ts`
[^sync-logger]: `package/src/services/SyncLogger.ts`
[^core-command]: `.repos/effect/packages/effect/src/unstable/cli/Command.ts`
[^bin-e2e]: `package/__test__/cli/bin.e2e.test.ts`
