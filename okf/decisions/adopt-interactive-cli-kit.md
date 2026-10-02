---
type: Decision
title: Adopt @effected/cli's interactive kit
description: Output is presented for its audience, a missing input is asked for only when a person can answer it, sync and drift draw a hosted live view, and findings are failure lines no log level silences.
status: draft
tags: [dx, effect, ci, observability]
generated:
  by: okfit/claude-code
  at: 2026-10-02T15:49:51Z
  body_sha256: e30e5a28280bc0f8dff6b82be0c3bdcc0f62fa326a8ce79708fe7d594cfe65b5
sources:
  - id: cli-index
    resource: ../../package/src/cli/index.ts
  - id: effected-cli
    resource: npm:@effected/cli@0.11.0
  - id: cli-sync
    resource: ../../package/src/cli/commands/sync.ts
  - id: cli-nuke
    resource: ../../package/src/cli/commands/nuke.ts
  - id: cli-credentials
    resource: ../../package/src/cli/commands/credentials.ts
  - id: sync-progress
    resource: ../../package/src/cli/views/sync-progress.tsx
  - id: sync-progress-model
    resource: ../../package/src/cli/views/sync-progress-model.ts
  - id: sync-logger
    resource: ../../package/src/services/SyncLogger.ts
---

# Adopt @effected/cli's interactive kit

## Decision

The CLI adopts the whole of `@effected/cli` 0.11.0's presentation layer,
not only its runtime. Four parts follow from it.

1. **Output is presented for its audience.** The root command takes
   `CliAudience.flags()` (`--audience`, `--human`, `--agent`, `--ci`) as
   shared flags, and the tree runs through `CliAudience.run` inside
   `CliRuntime.main`, whose `env` option resolves the audience once:
   flag, then `REPOSETS_AUDIENCE`, then agent detection, then CI detection,
   then human.[^cli-index] Reports are `Doc` documents printed with
   `Doc.print`: plain for an agent, ANSI for a person, `::group::` blocks
   under GitHub Actions. One-line outcomes are `CliMessage` lines with a
   status glyph. An agent never receives an escape.[^effected-cli]
2. **A missing input is asked for only when a person can answer it.**
   `CliInteractive` is true only for a human audience with a terminal on
   both stdin and stdout and a `TERM` that is not `dumb`. When it is
   false, nothing prompts: a command either refuses with exit 64, naming
   the flag that would have answered, or takes the default it always took.
   Five commands ask: `nuke` without `--force`, `credentials create` and
   `credentials delete` with flags missing, `history show` without
   `--run`, and `init` without `--project`/`--no-project`. A cancelled
   prompt is the kit's `Cancelled`, rendered as one line, exit
   130.[^cli-nuke][^cli-credentials]
3. **`sync` and `drift` draw a hosted live view on a terminal.**
   `SyncLogger` publishes a `SyncEvent` beside every line it prints, and
   `CliUi.live` in `hosted` mode folds them into a redrawing footer. The
   report scrolls above it through the view's `logConsole`, and the
   committed final frame is the summary. A run that cannot draw mounts no
   view and loads neither React nor Ink: the view module is imported
   dynamically on the drawing path only, and the same summary block is
   printed statically instead.[^cli-sync][^sync-progress][^sync-progress-model][^sync-logger]
4. **Findings are failure lines, not diagnostics.** "No config found", "No
   groups configured", a dangling reference, `validate`'s `Invalid:` and
   `doctor`'s early stops are `CliMessage.failure` lines on stderr, which
   `--log-level` does not filter. Per-resource sync errors stay
   `Effect.logError`.[^cli-sync]

The exit-code contract and the stream split of
[cli-runtime-via-effected-cli](cli-runtime-via-effected-cli.md) are
unchanged; this decision adds 130 and decides how output is drawn inside
that contract. The interface is
[`interfaces/cli.md`](../interfaces/cli.md).

## Context

Before this, every command printed plain `Console.log` lines whoever was
reading, `nuke` was the only command that asked anything, and it asked
through core's `Prompt.Confirm` after checking `Stdio.stdinIsTerminal`
itself. A finding such as "No config found" was an `Effect.logError`
diagnostic, so `--log-level none` turned a run that did nothing into a
silent exit 1. The rule that a destructive command must never proceed
because nobody was there to answer already existed for `nuke`; the kit
lets every command apply it the same way, through one `CliInteractive`
answer instead of a per-command terminal probe.

## Alternatives rejected

- **An owned live view that loads React on every run.** Mounting the view
  unconditionally and letting it print nothing would have been simpler to
  wire. It was rejected because a CI run or an agent would load React and
  Ink for a view nobody sees. Hosted mode plus a dynamic import keeps the
  non-interactive path free of both, and the static summary is the same
  `syncSummaryBlock` the view's final frame draws.[^sync-progress-model]
- **Keeping `Effect.logError` for findings.** It kept the diagnostics
  channel uniform, but a finding is the reason a run exited 1. Letting
  `--log-level none` drop it leaves an exit code with no explanation.
  `CliMessage.failure` keeps it on stderr and out of the report a caller
  redirects, and no log level reaches it.
- **Core's `Prompt` in `nuke`.** It answered the one yes-or-no question
  `nuke` used to ask. It could not offer a pre-selected checklist grouped by
  what each file costs, it needed its own terminal check beside the kit's,
  and its cancel was not the kit's `Cancelled` with its exit 130. Using the
  kit's `MultiSelect` and `Confirm` puts every prompt in the CLI behind the
  same gate.[^cli-nuke]

[^cli-index]: `package/src/cli/index.ts`
[^effected-cli]: npm:@effected/cli@0.11.0
[^cli-sync]: `package/src/cli/commands/sync.ts`
[^cli-nuke]: `package/src/cli/commands/nuke.ts`
[^cli-credentials]: `package/src/cli/commands/credentials.ts`
[^sync-progress]: `package/src/cli/views/sync-progress.tsx`
[^sync-progress-model]: `package/src/cli/views/sync-progress-model.ts`
[^sync-logger]: `package/src/services/SyncLogger.ts`
