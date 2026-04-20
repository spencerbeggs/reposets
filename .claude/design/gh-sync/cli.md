---
module: gh-sync
title: CLI Commands
status: current
completeness: 95
last-synced: 2026-04-20
---

## Entry Point

`package/src/cli/index.ts` bootstraps the CLI:

1. Root command created with `Command.make("gh-sync")`
2. All subcommands registered via `Command.withSubcommands`
3. `Command.run` creates the CLI handler
4. `Effect.suspend(() => cli(process.argv))` defers evaluation
5. `ConfigLoaderLive` and `NodeContext.layer` provided at root
6. `NodeRuntime.runMain` executes the program

## Global Options

`--log-level silent|info|verbose|debug` (default: `info`) - sets output
verbosity. Overrides `log_level` in config.

## Command Tree

```text
gh-sync [--log-level]
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

## sync

Loads config and credentials, builds service layers per credential
profile, delegates to SyncEngine. Log level resolved from config
`log_level` field, overridden by `--log-level` CLI flag.
SyncLoggerLive wired with `{ dryRun, logLevel }`. Supports filtering
by group or repo and dry-run mode.

Layer composition: `GitHubClientLive(token)` + `OnePasswordClientLive` +
`CredentialResolverLive` + `SyncLoggerLive` -> `SyncEngineLive`, all
provided to the `SyncEngine.syncAll()` call.

## list

Displays a config summary: repo groups with their referenced settings,
environments, secrets (by scope including environment-scoped), variables
(by scope including environment-scoped), rulesets, owner, and credential
profile.

## validate

Schema compliance + reference integrity checks without hitting the
GitHub API:

- Config and credentials schema validation
- Cross-reference checks (do referenced groups exist?)
- File path existence checks
- Credential profile reference checks

## doctor

Everything validate does, plus Levenshtein-based typo detection for
unknown keys in the config. Reports suggestions like "unknown key
'has_wikis' -- did you mean 'has_wiki'?"

Checks top-level keys, repo group keys, and cleanup keys against known
sets.

## init

Scaffolds `gh-sync.config.toml` and `gh-sync.credentials.toml`:

- Default (no flags): creates in XDG config dir, adds `.gitignore`
  containing `gh-sync.credentials.toml` to the config dir
- `--project`: creates in cwd, appends `gh-sync.credentials.toml` to
  the project's `.gitignore`

## credentials

Manages named credential profiles in `gh-sync.credentials.toml`:

- `create` - add a profile with `--github-token` and/or `--op-token`
- `list` - show profiles with tokens redacted (first/last 4 chars)
- `delete` - remove a profile by name
