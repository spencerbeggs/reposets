---
module: repo-sync
title: Effect Services
status: current
completeness: 95
last-synced: 2026-04-20
---

## ConfigLoader

Parses and validates TOML config and credentials files.

- `parseConfig(toml: string)` - parse TOML, validate against ConfigSchema
- `parseCredentials(toml: string)` - parse TOML, validate against
  CredentialsSchema; empty string returns default empty profiles

Implementation: `Layer.succeed` (pure parsing, no I/O). File reading is
handled by the CLI command layer.

## OnePasswordClient

Wraps `@1password/sdk` for resolving `op://` secret references.

- `resolve(reference, serviceAccountToken)` - resolve a 1Password reference

Live: dynamically imports `@1password/sdk`, creates client per call.
Test: `OnePasswordClientTest(stubs)` returns values from a stub map.

## CredentialResolver

Resolves all named labels from a credential profile's `[resolve]` section
into a flat `Map<string, string>`.

- `resolveAll(profile, basePath)` - resolve all labels from the profile

Depends on `OnePasswordClient` for `op` sources. Built with `Layer.effect`.

Resolution by sub-group:

- `resolve.value` - strings as-is, objects JSON-stringified
- `resolve.file` - `readFileSync` relative to basePath, trimmed
- `resolve.op` - delegate to OnePasswordClient (requires op_service_account_token)

All three sub-groups contribute to one flat namespace. Duplicate labels
across sub-groups are a validation error.

## SyncLogger

Tiered output service for the sync pipeline. All sync output flows through
this service rather than direct `Console.log` calls.

Methods: `groupStart`, `repoStart`, `repoSkip`, `syncSummary`,
`settingsApplied`, `cleanupSummary`, `syncOperation`, `syncError`, `finish`

The `syncSummary` resource parameter accepts `"secret" | "variable" |
"ruleset" | "environment"` to cover environment sync output.

Visibility tiers:

- `silent` - no output
- `info` - group/repo headers, summary counts, cleanup summaries with names
- `verbose` - per-operation lines (sync/apply/delete per resource)
- `debug` - per-operation lines with source info appended

Dry-run: verbs prefixed with "would" (e.g., "would sync" instead of "synced").
Errors accumulated via `Ref` and reported in `finish()` as an end-of-run
summary.

Live: `SyncLoggerLive({ dryRun, logLevel, output? })` - `output` Ref is
for test capture. Test layer uses `logLevel: "silent"` to suppress output.

## GitHubClient

Wraps Octokit with typed methods for all GitHub API operations. 16 methods
organized into four domains: repo-level resources, environments, and
environment-scoped resources.

### Repo-Level Methods

- `syncSecret(owner, repo, name, value, scope)` - encrypt and upsert
  (actions/dependabot/codespaces)
- `syncVariable(owner, repo, name, value)` - create or update
- `syncSettings(owner, repo, settings)` - REST `repos.update` for standard
  fields; GraphQL `updateRepository` mutation for `has_sponsorships` and
  `has_pull_requests` (mapped via `GRAPHQL_SETTINGS` constant)
- `syncRuleset(owner, repo, name, payload)` - create or update by name;
  accepts `Ruleset` schema type directly
- `listSecrets/listVariables/listRulesets` - query existing resources
- `deleteSecret/deleteVariable/deleteRuleset` - cleanup operations

### Environment Methods

- `syncEnvironment(owner, repo, name, config)` - create or update a
  deployment environment (wait_timer, reviewers, deployment_branches)
- `syncEnvironmentSecret(owner, repo, envName, name, value)` - encrypt
  and upsert an environment-scoped secret
- `syncEnvironmentVariable(owner, repo, envName, name, value)` - create
  or update an environment-scoped variable
- `listEnvironments` - list all deployment environments for a repo
- `listEnvironmentSecrets/listEnvironmentVariables` - query environment
  resources
- `deleteEnvironment/deleteEnvironmentSecret/deleteEnvironmentVariable` -
  cleanup operations

### GraphQL Settings

The `GRAPHQL_SETTINGS` constant maps config keys to GraphQL mutation
fields. Settings matching these keys are routed through a
`updateRepository` GraphQL mutation instead of the REST API:

- `has_sponsorships` -> `hasSponsorshipsEnabled`
- `has_pull_requests` -> `hasPullRequestsEnabled`

The mutation resolves the repository `node_id` via `octokit.repos.get()`
before executing.

### Settings Sanitization

The `syncSettings` method strips merge commit config when the strategy is
disabled: if `allow_merge_commit` is false, `merge_commit_title` and
`merge_commit_message` are removed from the payload (same for squash).

Secret scopes: `actions`, `dependabot`, `codespaces` - each routes to the
appropriate Octokit API namespace. The `SecretScope` type is
`"actions" | "dependabot" | "codespaces"`.

Live: `GitHubClientLive(token)` creates an Octokit instance per token.
Test: `GitHubClientTest()` returns `{ layer, calls() }` recorder covering
all 16 methods.

## SyncEngine

Orchestrates the full sync workflow. Depends on `GitHubClient`,
`CredentialResolver`, and `SyncLogger`.

- `syncAll(config, credentials, options)` - main entry point

Flow per group:

1. Resolve owner (group override or config default)
2. Resolve credential profile (explicit or implicit single profile)
3. Resolve all credential labels via `CredentialResolver.resolveAll()`
   into a flat `Map<string, string>`
4. Resolve secret groups by scope: `actions`, `dependabot`, `codespaces`
   each get their own resolved map
5. Resolve variable groups from `variables.actions` references
6. Collect rulesets from config; normalize shorthands via
   `normalizeRuleset()`; substitute `{ resolved }` references with values
   from the credential map, coercing to integers where needed
7. Resolve environment references from `group.environments` array
8. Resolve environment-scoped secrets from `group.secrets.environments`
   mapping (env name -> secret group refs)
9. Resolve environment-scoped variables from `group.variables.environments`
   mapping (env name -> variable group refs)
10. Compute per-group cleanup config (no global merge; defaults to all-off)
11. For each repo (skipping mutations in dry-run):
    - Sync settings (merged from referenced setting groups)
    - Sync environments (must exist before scoped resources)
    - Sync secrets by scope (actions/dependabot/codespaces)
    - Sync environment secrets per environment
    - Sync variables (actions scope)
    - Sync environment variables per environment
    - Sync rulesets (fully resolved/normalized `Ruleset` objects)
12. Cleanup phase per scope: delete undeclared resources respecting
    preserve lists from the three-way `CleanupScope` union
    - Actions/dependabot/codespaces secrets
    - Environment secrets (per environment)
    - Actions variables
    - Environment variables (per environment)
    - Rulesets (skips org-level with `source_type !== "Repository"`)
    - Environments

Options: `dryRun`, `noCleanup`, `groupFilter`, `repoFilter`, `configDir`
