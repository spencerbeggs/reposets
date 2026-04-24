---
module: reposets
title: CLI Commands
status: current
completeness: 95
last-synced: 2026-04-23
---

## Entry Point

`package/src/cli/index.ts` bootstraps the CLI:

1. Root command created with `Command.make("reposets")`
2. All subcommands registered via `Command.withSubcommands`
3. `Command.run` creates the CLI handler
4. `Effect.suspend(() => cli(process.argv))` defers evaluation
5. `NodeContext.layer` and `CliLogger` provided at root (CliLogger
   replaces the default Effect logger, routing `Effect.log` to stdout
   and `Effect.logError` to stderr via `globalThis.console`)
6. Each command provides its own `makeConfigFilesLive(config)` layer
7. `NodeRuntime.runMain` executes the program

## Global Options

`--log-level silent|info|verbose|debug` (default: `info`) - sets output
verbosity. Overrides `log_level` in config.

## Command Tree

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

- Config and credentials schema validation (via `configFile.discover`
  which runs `validateConfigRefs` automatically)
- Cross-reference validation (settings, secrets, variables, rulesets,
  environments group references) performed by `validateConfigRefs`
  callback during config loading
- File path existence checks (file-kind secret/variable groups)
- Credential profile reference checks

## doctor

Everything validate does, plus Levenshtein-based typo detection for
unknown keys in the config. Reports suggestions like "unknown key
'has_wikis' -- did you mean 'has_wiki'?"

Checks top-level keys, repo group keys, and per-group cleanup keys
(including nested `cleanup.secrets` and `cleanup.variables` sub-keys)
against known sets.

## init

Scaffolds `reposets.config.toml` and `reposets.credentials.toml`:

- Default (no flags): creates in XDG config dir, adds `.gitignore`
  containing `reposets.credentials.toml` to the config dir
- `--project`: creates in cwd, appends `reposets.credentials.toml` to
  the project's `.gitignore`

## credentials

Manages named credential profiles in `reposets.credentials.toml`:

- `create` - add a profile with `--github-token` and/or `--op-token`
- `list` - show profiles with tokens redacted (first/last 4 chars)
- `delete` - remove a profile by name
