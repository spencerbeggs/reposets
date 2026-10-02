---
type: Decision
title: CliRuntime.main builds the audience environment over a directories-only platform
description: The entrypoint runs CliAudience.run under CliRuntime.main with an env block, provides only the XDG directories at the platform and attaches the databases per command; streams split by purpose, usage exits 64, findings exit 1 through CliExit, a cancelled prompt exits 130, and doctor always exits 0.
status: draft
supersedes: cli-runtime-via-effected-cli.md
tags: [effect, dx, architecture]
generated:
  by: okfit/claude-code
  at: 2026-10-02T19:04:30Z
  body_sha256: f114f72b341f2bcb5ab89ef94d678570d976627fc979e8c12954f146bc249113
sources:
  - id: cli-index
    resource: ../../package/src/cli/index.ts
  - id: effected-cli
    resource: npm:@effected/cli@0.11.0
  - id: effected-app
    resource: npm:@effected/app@0.20.0
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
    resource: ../../.repos/effect/packages/effect/src/cli/Command.ts
  - id: bin-e2e
    resource: ../../package/__test__/cli/bin.e2e.test.ts
---

# CliRuntime.main builds the audience environment over a directories-only platform

## Decision

[`package/src/cli/index.ts`](../../package/src/cli/index.ts) runs the
command tree through `CliAudience.run` under `@effected/cli`'s
`CliRuntime.main`, and hands `main` an `env` block so the kit builds the
presentation environment itself:

```ts
NodeRuntime.runMain(
  CliRuntime.main(CliAudience.run(cli, { version: VERSION }), {
    platform: PlatformLive,
    env: {
      audienceEnvVar: "REPOSETS_AUDIENCE",
      log: { envVar: "REPOSETS_LOG_LEVEL" },
      stderrIsTerminal: Effect.sync(() => process.stderr.isTTY === true),
    },
    render,
    helpOnUsageError: "stderr",
  }),
);
```

The root command carries `Command.withSharedFlags(CliAudience.flags())`,
which adds `--audience`, `--human`, `--agent` and `--ci`, and
`CliAudience.run` resolves them before core parses.[^cli-index] Under `env`,
`main` builds the audience, terminal, theme, links and the `CliInteractive`
decision once, installs `CliLog` as the logger set (diagnostics opt in
through `REPOSETS_LOG_LEVEL`) and installs the colour-aware help formatter.
The logger is outermost, the platform is provided inside failure reporting
so a layer-build failure renders as one line, and `CliExit` is provided
fresh.[^effected-cli]

`PlatformLive` is only the XDG directories (`AppDirs` over `Xdg`) and the
`Invocation` layer over `NodeServices.layer`. The databases are not on the
platform: `StoreLive` and `AppCache.layer` are bound once at module scope
and attached with `Command.provide` to `sync` and `drift`, and the journal
over `StoreLive` to `history`. Every other command runs without opening a
database file.[^cli-index][^effected-app]

`render` hands a defect, and any failure it does not recognise, to the kit's
default report. For a `ConfigValidationError` it keeps the default report,
which draws the issue as a tree of rejected keys, and appends
`Run 'reposets doctor' for suggested spellings.` only when one of the
issues is an unknown key. For a typed failure that carries a `cause`, such
as a TOML syntax error whose message names no position, it appends the
sanitised cause on its own line.[^cli-index]

Six rules follow from it:

1. **Streams split by purpose, not by severity.** A command's product is
   written with `Doc.print` or `Console.log` and lands on stdout. A one-line
   outcome is a `CliMessage`, success and info on stdout and warning and
   failure on stderr, and no log level silences it. Every `Effect.log*`
   level is a diagnostic on stderr.[^effected-cli] `SyncLogger`'s report
   lines are stdout output; its per-resource failures are
   `Effect.logError`.[^sync-logger]
2. **A usage mistake exits 64.** A handler refuses a bad invocation by
   failing with `CliError.UserError`, and `main` maps it, like a parse
   error, to its default `usageExitCode` of 64. With
   `helpOnUsageError: "stderr"`, help printed beside a usage error goes to
   stderr, so a usage mistake writes nothing to stdout. More than one
   audience flag is a usage error too.[^cli-credentials][^bin-e2e]
3. **A finding exits 1 from a handler that succeeds.** A handler that ran
   correctly and found something wrong writes the finding as a
   `CliMessage.failure` line, calls `CliExit.set(1)` and returns. `nuke` and
   `init` try every target before exiting 1.[^cli-sync][^cli-nuke][^cli-init]
4. **A cancelled prompt exits 130.** Esc, `q` or Ctrl-C at any prompt is
   the kit's `Cancelled`, which `main` reports as one line. A run that
   cannot prompt never reaches one: it takes a default or refuses with
   64.[^effected-cli]
5. **`doctor` always exits 0.** It is a report, and `validate` is the gate.
   A schema-validation failure or a rejected token appears in `doctor`'s
   output, painted as a failure, but never in its exit code.[^cli-doctor]
6. **A failure that escapes a command exits 1.** A config that fails to
   read or decode propagates as an ordinary failure, and `main` renders it
   through `render` with its fallback code, 1. No file under
   `package/src` sets `process.exitCode`.[^cli-index]

`--log-level` is core's own filter and reaches the handler's `Effect.log*`
calls only.[^core-command] It does not reach `Console.log` or `Doc.print`
output, `CliMessage` lines, the usage-error text, or the escaped-failure
report.

## Context

This supersedes
[cli-runtime-via-effected-cli](cli-runtime-via-effected-cli.md), whose
five exit and stream rules carry over unchanged here; what changed is the
assembly. Adopting the interactive kit moved the logger, formatter and
environment into `main`'s `env`
([adopt-interactive-cli-kit](adopt-interactive-cli-kit.md)), and the
platform stopped carrying `App.layer`, because `App.layer` opens the state
and cache databases for every command: `nuke` was deleting `store.db` while
its own process held it open, which orphaned the file's `-wal` and `-shm`
beside the next run's fresh database.[^effected-app][^cli-nuke] The e2e
suite runs the built dev bin and pins each rule above by exit code and by
which stream carries which text.[^bin-e2e]

## Alternatives rejected

- **`App.layer` on the platform.** It is the kit's one-call control plane,
  but it opens and migrates both SQLite files for every command, including
  ones that never touch state. That made `nuke` delete an open database and
  every read-only command create one. The kit has no directories-only
  layer yet, so the entrypoint composes `AppDirs` over `Xdg` itself.
- **Keeping `CliColor.formatterLayer()` and `CliLogger.layer()` on the
  platform.** Under `env`, `main` installs its own formatter closer to the
  program and `CliLog` owns the logger set, so both would be shadowed or
  replaced. Without `env`, `CliInteractive` stays `false` and nothing could
  ever prompt.
- **`Command.run` with `CliAudience.provide`.** It covers the handler but
  not a fallback prompt or the failure report, which core resolves before
  the handler runs. `CliAudience.run` resolves the audience before parsing.
- **`doctor` exiting 1 on a failed check, and `usageExitCode: 1`.** Both
  rejected for the reasons the superseded decision records: `doctor` is a
  report and `validate` the gate, and a CI job must be able to tell a
  broken invocation from a real finding.

[^cli-index]: `package/src/cli/index.ts`
[^effected-cli]: npm:@effected/cli@0.11.0
[^effected-app]: npm:@effected/app@0.20.0
[^cli-sync]: `package/src/cli/commands/sync.ts`
[^cli-credentials]: `package/src/cli/commands/credentials.ts`
[^cli-nuke]: `package/src/cli/commands/nuke.ts`
[^cli-init]: `package/src/cli/commands/init.ts`
[^cli-doctor]: `package/src/cli/commands/doctor.ts`
[^sync-logger]: `package/src/services/SyncLogger.ts`
[^core-command]: `.repos/effect/packages/effect/src/cli/Command.ts`
[^bin-e2e]: `package/__test__/cli/bin.e2e.test.ts`
