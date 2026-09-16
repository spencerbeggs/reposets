---
type: Decision
title: There are no verbosity tiers
description: Output is one level, plus a --debug flag on sync and drift that adds two diagnostic suffixes, rather than a config-selected tier of output detail.
status: stable
tags: [dx, observability]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 27dff11a51e4d2428da6a1f6560fa588c672bb180547796e37ce3d3fc6989699
sources:
  - id: sync-logger
    resource: ../../package/src/services/SyncLogger.ts
  - id: cli-flags
    resource: ../../.repos/effect/packages/effect/src/unstable/cli/GlobalFlag.ts
  - id: cli-sync
    resource: ../../package/src/cli/commands/sync.ts
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:25Z
---

# There are no verbosity tiers

`SyncLoggerConfig` has exactly two fields: `dryRun` and `debug`.[^sync-logger]
There is no `log_level` config key, and there is no tier selecting how much
a run prints. Output is one level. `--debug`, a flag on `sync` and `drift`
rather than a value in `reposets.config.toml`, adds two diagnostic suffixes
to lines that print either way: where a resolved value came from
(`syncOperation`'s `source` parameter), and the applied-versus-live
fingerprints behind a drift report (`driftDetected`'s `fingerprints`
suffix). Neither suffix is a line of its own — both attach to output that
was already going to appear.

Quieting a run is a separate concern from tiering it, and belongs to
core's own `--log-level` flag (`all|trace|debug|…|none`),[^cli-flags] which
filters records by severity before `CliLoggerLive` ever routes them to
stdout or stderr — see
[`interfaces/cli.md`](../interfaces/cli.md#--log-level-is-the-per-run-silencer).
`--debug` itself is declared on `sync` and reused by `drift` through the
same handler.[^cli-sync]

## Context

The prior config-driven scheme had four tiers — `silent`, `info`,
`verbose`, `debug` — and enumerating what each one actually gated is what
retired them: `verbose` guarded exactly one call site, the per-resource
`syncOperation` line that is the entire content of a sync, so a dry run at
the default tier printed a change count with most of the list that
justified it suppressed, and `silent` gated `syncError` and `finish`
alongside everything else, so a failing run under that setting printed
nothing but its exit code.

## Alternatives rejected

- **A reduced tier set.** Any remaining tier still has to draw a line
  between "summary" and "detail" inside one sync, and the four-tier scheme
  already showed that the natural line falls between settings and
  everything else — not between two levels of everything else. A smaller
  tier count does not remove the discovery that motivated dropping tiers
  altogether.
- **A `--verbose` flag.** This substitutes one boolean knob for another
  without removing the actual problem: a config-level or flag-level
  toggle for "some things print, some don't" reintroduces exactly the
  suppressed-list failure mode `verbose` had, just spelled differently.
  `--debug`'s two named suffixes replace it because they attach to
  existing lines instead of gating whether a line exists at all.

[^sync-logger]: `package/src/services/SyncLogger.ts`
[^cli-flags]: `.repos/effect/packages/effect/src/unstable/cli/GlobalFlag.ts`
[^cli-sync]: `package/src/cli/commands/sync.ts`
</content>
