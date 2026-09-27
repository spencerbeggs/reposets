---
type: Decision
title: One output level, plus --debug
description: Output is one level, plus a --debug flag on sync and drift that adds two diagnostic suffixes; there is no config-selected tier, and the report cannot be silenced by a flag.
status: stable
supersedes: no-verbosity-tiers.md
tags: [dx, observability]
generated:
  by: okfit/claude-code
  at: 2026-09-27T17:39:49Z
  body_sha256: 80d79e38d6284cf618e6c420325a9b6ca56dc4ae77e913b96dd42a4a30ad0b65
sources:
  - id: sync-logger
    resource: ../../package/src/services/SyncLogger.ts
  - id: cli-sync
    resource: ../../package/src/cli/commands/sync.ts
  - id: core-command
    resource: ../../.repos/effect/packages/effect/src/unstable/cli/Command.ts
verified:
  - by: human:spencer
    at: 2026-09-27T17:38:40Z
---

# One output level, plus --debug

## Decision

`SyncLoggerConfig` has exactly two fields: `dryRun` and `debug`.[^sync-logger]
There is no `log_level` config key, and there is no tier selecting how much
a run prints. Output is one level. `--debug`, a flag on `sync` and `drift`
rather than a value in `reposets.config.toml`, adds two diagnostic suffixes
to lines that print either way. One says where a resolved value came from
(`syncOperation`'s `source` parameter). The other gives the
applied-versus-live fingerprints behind a drift report (`driftDetected`'s
`fingerprints` suffix). Neither suffix is a line of its own; both attach to
output that was already going to appear. `--debug` is declared on `sync`
and reused by `drift` through the same handler.[^cli-sync]

The report itself cannot be quieted by a flag. It is the command's output,
written with `Console.log` to stdout.[^sync-logger] Core's `--log-level`
filters only the `Effect.log*` diagnostics a handler emits, which all go to
stderr.[^core-command] A caller who wants a silent run redirects stdout,
and the exit code carries the result either way. The stream split is
[cli-runtime-via-effected-cli](cli-runtime-via-effected-cli.md). The trap
it creates is
[`gotchas/log-level-none-still-prints-reports.md`](../gotchas/log-level-none-still-prints-reports.md).

## Context

This supersedes [no-verbosity-tiers](no-verbosity-tiers.md). The tier
decision is unchanged. The part that changed is how a run is quieted:
`--log-level` used to filter the report too, because the report was logged
rather than written.

The prior config-driven scheme had four tiers: `silent`, `info`,
`verbose` and `debug`. Enumerating what each one actually gated is what
retired them. `verbose` guarded exactly one call site, the per-resource
`syncOperation` line that is the entire content of a sync. So a dry run at
the default tier printed a change count with most of the list that
justified it suppressed. `silent` gated `syncError` and `finish` along with
everything else, so a failing run under that setting printed nothing but
its exit code.

## Alternatives rejected

- **A reduced tier set.** Any remaining tier still has to draw a line
  between "summary" and "detail" inside one sync. The four-tier scheme
  already showed that the natural line falls between settings and
  everything else, not between two levels of everything else. A smaller
  tier count does not remove the discovery that motivated dropping tiers
  altogether.
- **A `--verbose` flag.** This swaps one boolean knob for another without
  removing the actual problem. A config-level or flag-level toggle for
  "some things print, some don't" brings back the suppressed-list failure
  mode `verbose` had, spelled differently. `--debug`'s two named suffixes
  replace it because they attach to existing lines instead of gating
  whether a line exists at all.
- **Letting `--log-level` keep silencing the report.** This would have
  meant logging the report at `Info` under
  `CliLogger.layer({ stderrFrom: "Error" })`. It was rejected in
  [cli-runtime-via-effected-cli](cli-runtime-via-effected-cli.md), because
  it keeps diagnostics mixed into the stream a caller redirects.

[^sync-logger]: `package/src/services/SyncLogger.ts`
[^cli-sync]: `package/src/cli/commands/sync.ts`
[^core-command]: `.repos/effect/packages/effect/src/unstable/cli/Command.ts`
