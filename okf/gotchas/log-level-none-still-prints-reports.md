---
type: Gotcha
title: --log-level none still prints the report
description: "--log-level none looks like the switch that silences a run, but it filters only Effect.log diagnostics; every report, summary and listing is Console.log on stdout and prints regardless."
status: draft
stale_after: 2027-03-27T00:00:00Z
resource: ../../package/src/cli/index.ts
tags: [dx, ci, observability, effect]
generated:
  by: okfit/claude-code
  at: 2026-09-27T17:39:49Z
  body_sha256: a6fa55f9e62ca15a40b87c1144d6e687af3dbfa3c0a14f4aaa190c6e1120a064
sources:
  - id: cli-index
    resource: ../../package/src/cli/index.ts
  - id: sync-logger
    resource: ../../package/src/services/SyncLogger.ts
  - id: core-command
    resource: ../../.repos/effect/packages/effect/src/unstable/cli/Command.ts
  - id: effected-cli
    resource: npm:@effected/cli@0.9.0
---

# --log-level none still prints the report

**What you see.** You run `reposets sync --log-level none` or
`reposets drift --log-level error`. The group headers, every operation
line, the drift lines and `Sync complete!` still print.

**What you will wrongly conclude.** That the flag is broken, or was not
parsed, or that reposets ignores core's global flags.

**What is true.** `--log-level` works, but it now filters diagnostics
only. Core applies it by providing `MinimumLogLevel` around the command
handler, which filters `Effect.log*` calls and nothing
else.[^core-command] Under
[cli-runtime-via-effected-cli](../decisions/cli-runtime-via-effected-cli.md),
a command's output is `Console.log` on stdout, which `--log-level` does not
reach. That output includes the whole `SyncLogger` report, the `list`,
`validate`, `doctor` and `history` output, and the `nuke` target
list.[^sync-logger] Every `Effect.log*` level is routed to stderr by
`CliLogger.layer()`'s default.[^effected-cli] Two more things print
whatever the level is. A usage error's message is printed by
`Command.runWith`'s formatter, not the logger. A failure that escapes a
command is rendered by `CliRuntime.main` outside the handler's
scope.[^cli-index]

**What to do instead.** To quiet the report, redirect stdout:
`reposets sync > /dev/null` keeps failures visible on stderr and the exit
code intact. To keep only the exit code, redirect both streams. Use
`--log-level` to trim the diagnostics a handler logs, such as the
`Nothing was synced.` explanation beside a dangling reference.

[^cli-index]: `package/src/cli/index.ts`
[^sync-logger]: `package/src/services/SyncLogger.ts`
[^core-command]: `.repos/effect/packages/effect/src/unstable/cli/Command.ts`
[^effected-cli]: npm:@effected/cli@0.9.0
