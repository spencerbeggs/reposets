---
type: Gotcha
title: --log-level none still prints the report
description: "--log-level none looks like the switch that silences a run, but it filters only Effect.log diagnostics; every report, outcome line and finding prints regardless."
status: draft
stale_after: 2027-03-27T00:00:00Z
resource: ../../package/src/cli/index.ts
tags: [dx, ci, observability, effect]
generated:
  by: okfit/claude-code
  at: 2026-10-03T18:11:28Z
  body_sha256: 7f18adabfb0614a16c7e17075c8ca98a6b04281ae9d37e12aade196788e43958
sources:
  - id: cli-index
    resource: ../../package/src/cli/index.ts
  - id: sync-logger
    resource: ../../package/src/services/SyncLogger.ts
  - id: core-command
    resource: ../../.repos/effect/packages/effect/src/cli/Command.ts
  - id: effected-cli
    resource: npm:@effected/cli@0.11.0
  - id: cli-sync
    resource: ../../package/src/cli/commands/sync.ts
---

# --log-level none still prints the report

**What you see.** You run `reposets sync --log-level none` or
`reposets drift --log-level error`. The group headers, every operation
line, the drift lines, the summary and `✓ Sync complete!` still print. A
run that finds no config still prints `✗ No config found…` on stderr.

**What you will wrongly conclude.** That the flag is broken, or was not
parsed, or that reposets ignores core's global flags.

**What is true.** `--log-level` works, but it filters diagnostics only.
Core applies it by providing `MinimumLogLevel` around the command
handler, which filters `Effect.log*` calls and nothing
else.[^core-command] Under
[cli-runtime-main-builds-the-environment-v2](../decisions/cli-runtime-main-builds-the-environment-v2.md),
a command's output is written to stdout without the logger, which
`--log-level` does not reach. That output includes the whole `SyncLogger`
report, the `list`, `validate`, `doctor` and `history` documents, and the
`nuke` target list.[^sync-logger] Under
[adopt-interactive-cli-kit-v2](../decisions/adopt-interactive-cli-kit-v2.md),
a finding that exits 1 is a `CliMessage.failure` line on stderr, not a
log call, so it prints too: "No config found", "No groups configured",
the dangling-reference block, `validate`'s `✗ Invalid:` and `doctor`'s
early stops.[^cli-sync][^effected-cli] Two more things print whatever the
level is. A usage error's message is printed by `Command.runWith`'s
formatter, not the logger. A failure that escapes a command is rendered by
`CliRuntime.main` outside the handler's scope.[^cli-index]

What `--log-level` does filter is every `Effect.log*` level, all of which
the kit's logger sends to stderr: sync's per-resource error lines and its
`✗ Sync complete with N errors:` block, `init`'s next-steps hint, and
`nuke`'s `could not remove` lines.[^sync-logger]

**What to do instead.** To quiet the report, redirect stdout:
`reposets sync > /dev/null` keeps failures visible on stderr and the exit
code intact. To keep only the exit code, redirect both streams. Use
`--log-level` to trim the diagnostics a handler logs.

[^cli-index]: `package/src/cli/index.ts`
[^sync-logger]: `package/src/services/SyncLogger.ts`
[^core-command]: `.repos/effect/packages/effect/src/cli/Command.ts`
[^effected-cli]: npm:@effected/cli@0.11.0
[^cli-sync]: `package/src/cli/commands/sync.ts`
