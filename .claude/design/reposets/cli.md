---
module: reposets
title: CLI Commands
category: architecture
status: current
completeness: 90
created: 2026-04-21
updated: 2026-06-12
last-synced: 2026-06-12
related:
  - architecture.md
  - services.md
  - config-format.md
dependencies: []
---

## Overview

The CLI is built with `@effect/cli`. Each subcommand is one file under `package/src/cli/commands/`; the root command and runtime bootstrap live in `package/src/cli/index.ts`. This doc covers the command surface and what each command does at the topology level — see the command source for argument and flag detail.

## Entry point

`package/src/cli/index.ts` registers subcommands via `Command.withSubcommands`, defers evaluation with `Effect.suspend(() => cli(process.argv))` and provides `NodeContext.layer` plus `CliLogger` at the root before `NodeRuntime.runMain`. `CliLogger` replaces the default Effect logger so `Effect.log` reaches stdout and `Effect.logError` reaches stderr. Each command supplies its own `makeConfigFilesLive(config)` layer.

## Global options

`--log-level silent|info|verbose|debug` (default `info`) sets output verbosity and overrides `log_level` in config.

## Command tree

```text
reposets [--log-level]
  sync [--config] [--group] [--repo] [--dry-run] [--no-cleanup]
  list [--config]
  validate [--config]
  doctor [--config]
  init [--project]
  credentials
    create --profile [--github-token] [--op-token]
    list
    delete --profile
```

## Commands

- `sync` — loads config and credentials, builds the per-profile service layers and delegates to `SyncEngine.syncAll()`. Supports filtering by group or repo and dry-run mode. Layer composition for this command is described in `architecture.md`.
- `list` — prints a config summary: each group with its referenced settings, environments, secrets and variables (by scope, including environment-scoped), rulesets, owner and credential profile.
- `validate` — schema and reference-integrity checks without hitting the GitHub API. Cross-reference validation runs through `validateConfigRefs` during config loading; the command additionally checks file-kind group paths and credential-profile references.
- `doctor` — everything `validate` does, plus Levenshtein typo detection for unknown keys (top-level, group and per-group cleanup keys, including nested `cleanup.secrets`/`cleanup.variables`).
- `init` — scaffolds `reposets.config.toml` and `reposets.credentials.toml`. Default writes to the XDG config dir and gitignores the credentials file there; `--project` writes to cwd and appends the credentials file to the project `.gitignore`.
- `credentials create|list|delete` — manages named profiles in `reposets.credentials.toml`; `list` redacts tokens to first/last four characters.
