---
module: reposets
title: Architecture
category: architecture
status: current
completeness: 90
created: 2026-04-21
updated: 2026-06-12
last-synced: 2026-06-12
related:
  - services.md
  - cli.md
  - config-format.md
  - json-schema.md
dependencies: []
---

## Overview

reposets is an Effect-based CLI for syncing GitHub repository settings, secrets, variables, rulesets, deployment environments, repository security features and CodeQL default setup across personal and organization repos. Config files are distributable templates; environment-specific values resolve from credential profiles at runtime. This doc owns the topology: which services exist, how layers compose and the order the sync pipeline runs in. Service interfaces live in `services.md`, the CLI surface in `cli.md` and the TOML schema in `config-format.md`.

## Service graph

```text
CLI commands (--log-level flag, CliLogger)
  |
  v
ConfigFile services (xdg-effect ConfigFile.Tag)
  |--- ReposetsConfigFile (schema + validateConfigRefs callback)
  |--- ReposetsCredentialsFile (schema + XDG default path)
  |--- makeConfigFilesLive(configFlag) factory -> resolver chain
  |
  v
SyncEngine (orchestration)
  |--- CredentialResolver --- OnePasswordClient (@1password/sdk)
  |--- GitHubClient (Octokit + GraphQL) --- crypto (NaCl sealed box)
  |--- SyncLogger (tiered output)
```

## Layer composition

Layers compose at three levels:

- Root entrypoint (`package/src/cli/index.ts`) provides `NodeContext.layer` and `CliLogger`, a custom logger that routes `Effect.log` to stdout and `Effect.logError` to stderr.
- Per command: each command calls `makeConfigFilesLive(config)` to provide the `ReposetsConfigFile` and `ReposetsCredentialsFile` layers, using the `--config` flag to seed the resolver chain.
- Per sync invocation: the sync handler composes `GitHubClientLive(token)`, `OnePasswordClientLive`, `CredentialResolverLive`, `SyncLoggerLive({ dryRun, logLevel })` and `SyncEngineLive`.

The key constraint: layers are provided at the entrypoint and per-command handlers, never inside service implementations.

## Data flow

The sync pipeline is a delegation chain, not a flat function. The boundaries that matter:

1. The CLI resolves a config path through the declarative resolver chain (`--config` flag > upward walk > XDG fallback; see `config-format.md`), reads and parses the TOML, validates it against Effect Schema and runs the `validateConfigRefs` cross-reference check.
2. `SyncEngine.syncAll` iterates config groups. Per group it resolves the owner, the credential profile and all credential labels (into a flat `Map<string, string>`), then detects the owner type once via `GitHubClient.getOwnerType()` to strip org-only fields on personal accounts.
3. Per repo, the engine applies stages in a fixed order: settings (with folded `security_and_analysis` and resolved reviewer IDs) -> security features (diff-and-toggle) -> code scanning default setup -> environments -> secrets -> variables -> rulesets -> cleanup.

Two ordering constraints are load-bearing and not obvious from the code: environments must sync before any environment-scoped secrets or variables, and cleanup runs last so freshly synced resources are never deleted. The security-features and code-scanning stages are implemented inline in `SyncEngine.syncAll` rather than as separate methods. See `services.md` for the per-stage detail and `package/src/services/SyncEngine.ts` for the full flow.

Security feature toggles and code scanning default setup follow "leave alone if omitted" semantics — they have no `cleanup` scope of their own.

## Error model

All errors are `Data.TaggedError` subclasses; see the union in `package/src/errors.ts`. The load-bearing decision: `GitHubApiError` is caught per operation so a single failed API call does not abort the rest of the sync.

## Rationale

Config-as-template plus runtime credential resolution lets the same `reposets.config.toml` be committed and shared while secrets stay out of version control in `reposets.credentials.toml`. Modeling the pipeline as Effect programs gives uniform error handling and lets every service ship a Live and a Test layer, so the orchestration can be exercised without touching the GitHub API.
