---
module: gh-sync
title: Architecture
status: current
completeness: 90
last-synced: 2026-04-18
---

## Overview

gh-sync is an Effect-based CLI for syncing GitHub repository settings,
secrets, variables, and rulesets across personal repos. It replaces the
Commander.js-based github-repo-sync with a composable, service-oriented
architecture.

## Service Graph

```text
CLI Commands
  |
  v
ConfigLoader (TOML parsing + Schema validation)
  |
  v
SyncEngine (orchestration)
  |--- ValueResolver (file/value/json/op resolution)
  |      |--- OnePasswordClient (@1password/sdk)
  |
  |--- GitHubClient (Octokit wrapper)
         |--- crypto (NaCl sealed box encryption)
```

## Layer Composition

Layers are composed at the CLI entrypoint, not inside services:

- `ConfigLoaderLive` provided at root command level
- `NodeContext.layer` provided at root command level
- Per-sync invocation: `GitHubClientLive(token)` + `OnePasswordClientLive` +
  `ValueResolverLive` + `SyncEngineLive` composed in the sync command handler

## Data Flow

1. CLI parses args via @effect/cli
2. Config path resolved: --config flag > directory walk > XDG fallback
3. TOML files read from disk, parsed by smol-toml, validated by Effect Schema
4. SyncEngine iterates repo groups, resolving credential profiles per group
5. ValueResolver resolves all secret/variable/ruleset values (file, inline,
   JSON, or 1Password)
6. GitHubClient applies changes per repo: secrets by scope, variables,
   settings, rulesets
7. Cleanup phase deletes undeclared resources (if enabled)

## Error Model

All errors are `Data.TaggedError` subclasses:

- `ConfigError` - TOML parse or schema validation failure
- `CredentialsError` - missing credentials file or profile
- `ResolveError` - file not found, OP resolution failed
- `GitHubApiError` - API call failure (includes HTTP status)
- `SyncError` - orchestration-level failure
- `OnePasswordError` - 1Password SDK failure

## Testing Strategy

Each service has Live and Test layer implementations:

- `GitHubClientTest()` - records API calls, returns empty lists
- `OnePasswordClientTest(stubs)` - returns deterministic values
- `ConfigLoaderLive` - used directly in tests (pure parsing, no I/O)
- `ValueResolverLive` - tested with real filesystem + mock OP client

61 unit tests cover schemas, services, and utilities.
