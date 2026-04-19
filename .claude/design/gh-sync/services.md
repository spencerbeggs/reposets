---
module: gh-sync
title: Effect Services
status: current
completeness: 90
last-synced: 2026-04-18
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

Wraps Octokit with typed methods for all GitHub API operations.

Methods:

- `syncSecret(owner, repo, name, value, scope)` - encrypt and upsert
- `syncVariable(owner, repo, name, value)` - create or update
- `syncSettings(owner, repo, settings)` - repos.update
- `syncRuleset(owner, repo, name, payload)` - create or update by name;
  accepts `Ruleset` schema type directly
- `listSecrets/listVariables/listRulesets` - query existing resources
- `deleteSecret/deleteVariable/deleteRuleset` - cleanup operations

Secret scopes: `actions`, `dependabot`, `codespaces` - each routes to the
appropriate Octokit API namespace.

Live: `GitHubClientLive(token)` creates an Octokit instance per token.
Test: `GitHubClientTest()` returns `{ layer, calls() }` recorder.

## SyncEngine

Orchestrates the full sync workflow. Depends on `GitHubClient`,
`CredentialResolver`, and `SyncLogger`.

- `syncAll(config, credentials, options)` - main entry point

Flow per group:

1. Resolve owner (group override or config default)
2. Resolve credential profile (explicit or implicit single profile)
3. Resolve all credential labels via `CredentialResolver.resolveAll()`
   into a flat `Map<string, string>`
4. Resolve secret groups by kind: `file` (read files), `value` (use
   inline), `resolved` (look up from credential map)
5. Resolve variable groups by same kind pattern
6. Collect rulesets from config; substitute `{ resolved }` references
   with values from the credential map, coercing to integers where needed
7. For each repo (skipping mutations in dry-run):
   - Sync secrets by scope (actions/dependabot/codespaces)
   - Sync variables
   - Sync settings (merged from referenced setting groups)
   - Sync rulesets (fully resolved `Ruleset` objects)
8. Cleanup phase: delete undeclared resources per scope, respecting
   preserve lists and group-level cleanup overrides

Options: `dryRun`, `noCleanup`, `groupFilter`, `repoFilter`, `configDir`
