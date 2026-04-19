---
module: gh-sync
title: Architecture
status: current
completeness: 90
last-synced: 2026-04-18
---

## Overview

gh-sync is an Effect-based CLI for syncing GitHub repository settings,
secrets, variables, and rulesets across personal repos. Config files serve
as distributable templates; environment-specific values are resolved from
credential profiles at runtime.

## Service Graph

```text
CLI Commands (--log-level flag)
  |
  v
ConfigLoader (TOML parsing + Schema validation)
  |
  v
SyncEngine (orchestration)
  |--- CredentialResolver (resolve credential profile labels)
  |      |--- OnePasswordClient (@1password/sdk)
  |
  |--- GitHubClient (Octokit wrapper)
  |      |--- crypto (NaCl sealed box encryption)
  |
  |--- SyncLogger (structured output by log level)
```

## Layer Composition

Layers are composed at the CLI entrypoint, not inside services:

- `ConfigLoaderLive` provided at root command level
- `NodeContext.layer` provided at root command level
- Per-sync invocation: `GitHubClientLive(token)` + `OnePasswordClientLive` +
  `CredentialResolverLive` + `SyncLoggerLive({ dryRun, logLevel })` +
  `SyncEngineLive` composed in the sync command handler

## Data Flow

1. CLI parses args via @effect/cli (global `--log-level` flag)
2. Config path resolved: --config flag > directory walk > XDG fallback
3. TOML files read from disk, parsed by smol-toml, validated by Effect Schema
4. SyncEngine iterates groups (`config.groups`), resolving credential
   profiles per group
5. CredentialResolver resolves all labels from the active profile's
   `[resolve]` section (op/file/value sub-groups) into a `Map<string, string>`
6. Secret and variable groups resolved by kind: `file` (read files),
   `value` (use inline strings/objects), `resolved` (look up from
   credential map)
7. Rulesets collected from config as typed objects; `{ resolved }` references
   substituted from the credential map with type coercion
8. GitHubClient applies changes per repo: secrets by scope, variables,
   settings, rulesets
9. Cleanup phase deletes undeclared resources (if enabled)
10. SyncLogger emits tiered output throughout (info summaries, verbose
    per-operation, debug with source details)

## Error Model

All errors are `Data.TaggedError` subclasses:

- `ConfigError` - TOML parse or schema validation failure
- `CredentialsError` - missing credentials file or profile
- `ResolveError` - file not found, OP resolution failed, missing
  credential label
- `GitHubApiError` - API call failure (includes HTTP status); caught
  per-operation so sync continues past individual failures
- `SyncError` - orchestration-level failure
- `OnePasswordError` - 1Password SDK failure

## Testing Strategy

Each service has Live and Test layer implementations:

- `GitHubClientTest()` - records API calls, returns empty lists
- `OnePasswordClientTest(stubs)` - returns deterministic values
- `ConfigLoaderLive` - used directly in tests (pure parsing, no I/O)
- `CredentialResolverLive` - tested with real filesystem + mock OP client
- `SyncLoggerLive` - tested with Ref-based output capture

108 unit tests cover schemas, services, and utilities.
