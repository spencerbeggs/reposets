---
module: reposets
title: Architecture
status: current
completeness: 95
last-synced: 2026-04-27
---

## Overview

reposets is an Effect-based CLI for syncing GitHub repository settings,
secrets, variables, rulesets, deployment environments, repository security
features, and CodeQL default setup across personal and organization repos.
Config files serve as distributable templates; environment-specific values
are resolved from credential profiles at runtime.

## Service Graph

```text
CLI Commands (--log-level flag, CliLogger)
  |
  v
ConfigFile services (xdg-effect ConfigFile.Tag)
  |--- ReposetsConfigFile (schema + validate callback)
  |--- ReposetsCredentialsFile (schema + XDG default path)
  |--- makeConfigFilesLive(configFlag) factory
  |      |--- ExplicitPath / StaticDir (--config flag)
  |      |--- UpwardWalk (directory walk)
  |      |--- XdgConfigResolver (XDG fallback)
  |
  v
SyncEngine (orchestration)
  |--- CredentialResolver (resolve credential profile labels)
  |      |--- OnePasswordClient (@1password/sdk)
  |
  |--- GitHubClient (Octokit wrapper + GraphQL mutations)
  |      |--- crypto (NaCl sealed box encryption)
  |
  |--- SyncLogger (structured output by log level)
```

## Layer Composition

Layers are composed at two levels:

- **Root entrypoint** (`index.ts`): provides `NodeContext.layer` and
  `CliLogger` (custom logger routing `Effect.log` to stdout and
  `Effect.logError` to stderr)
- **Per-command**: each command calls `makeConfigFilesLive(config)` to
  provide `ReposetsConfigFile` and `ReposetsCredentialsFile` layers,
  using the `--config` flag option to configure resolver chains
- **Per-sync invocation**: `GitHubClientLive(token)` +
  `OnePasswordClientLive` + `CredentialResolverLive` +
  `SyncLoggerLive({ dryRun, logLevel })` + `SyncEngineLive` composed
  in the sync command handler

## Data Flow

1. CLI parses args via @effect/cli (global `--log-level` flag)
2. Config path resolved via declarative resolver chain:
   `ExplicitPath`/`StaticDir` (--config flag) > `UpwardWalk` (directory
   walk) > `XdgConfigResolver` (XDG fallback)
3. TOML files read from disk, parsed by smol-toml, validated by Effect
   Schema; config cross-references validated by `validateConfigRefs`
   callback
4. SyncEngine iterates groups (`config.groups`), resolving credential
   profiles per group
5. CredentialResolver resolves all labels from the active profile's
   `[resolve]` section (op/file/value sub-groups) into a `Map<string, string>`
6. Secret and variable groups resolved by kind: `file` (read files),
   `value` (use inline strings/objects), `resolved` (look up from
   credential map)
7. Rulesets collected from config as typed objects; shorthand fields
   (`targets`, `pull_requests`, `status_checks`, boolean flags) normalized
   via `normalizeRuleset()` into API-compatible format; `{ resolved }`
   references substituted from the credential map with type coercion
8. Owner type detected once per group via `GitHubClient.getOwnerType()`;
   used downstream to strip org-only fields (e.g., `allow_forking` from
   settings, and `secret_scanning_delegated_*` /
   `delegated_bypass_reviewers` from `security_and_analysis`) on personal
   accounts
9. Settings stage: merged settings (REST `repos.update`) plus a folded
   `security_and_analysis` block (transformed via
   `transformSecurityAndAnalysis()`) plus GraphQL mutation for
   `has_sponsorships` / `has_pull_requests`. Org-owned repos resolve
   `delegated_bypass_reviewers` team slugs to numeric `reviewer_id`s via
   `GitHubClient.resolveTeamId()` (cached per `org:slug`) before the PATCH
10. Security features stage (between settings and secrets, implemented
    inline in `SyncEngine.syncAll`): for each of `vulnerability_alerts`,
    `automated_security_fixes`, and `private_vulnerability_reporting`,
    probe current state via the corresponding `getXxx` method, compare to
    the merged desired value, and PUT/DELETE only on diff
11. Code scanning stage (after the security features stage, also inline):
    filter configured CodeQL languages by what `listRepoLanguages` detects
    (mapped through `REPO_LANG_TO_CODEQL`); warn (don't fail) on
    non-detected entries; PATCH the default-setup endpoint (`202 Accepted`,
    sent without polling for completion)
12. Environments synced before secrets/variables (environments must exist
    before scoped resources can be attached)
13. GitHubClient applies remaining changes per repo: environments, secrets
    by scope (actions/dependabot/codespaces/environments), variables by
    scope (actions/environments), rulesets
14. Cleanup phase deletes undeclared resources per scope, respecting
    preserve lists and per-group cleanup configuration. (Security feature
    toggles and code scanning default setup follow "leave alone if
    omitted" semantics and have no `cleanup` scope of their own.)
15. SyncLogger emits tiered output throughout (info summaries, verbose
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

- `GitHubClientTest()` - records API calls, returns empty lists (covers
  all 30 service methods including environment, security feature, code
  scanning, and team-resolver operations)
- `OnePasswordClientTest(stubs)` - returns deterministic values
- `makeConfigFilesLive` - used directly in tests (builds xdg-effect
  resolver chains for config + credentials)
- `CredentialResolverLive` - tested with real filesystem + mock OP client
- `SyncLoggerLive` - tested with Ref-based output capture

230 tests (unit + integration) cover schemas, services, CLI commands,
and utilities.
