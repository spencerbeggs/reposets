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

## ValueResolver

Resolves `ValueSource` union types to string values.

- `resolve(source, basePath, opToken?)` - dispatch on source type

Depends on `OnePasswordClient` for `op` sources. Built with `Layer.effect`
to access the OP client from context.

Resolution by type:

- `file` - `readFileSync` relative to basePath, trimmed
- `value` - pass through
- `json` - `JSON.stringify`
- `op` - delegate to OnePasswordClient (requires opToken)

## GitHubClient

Wraps Octokit with typed methods for all GitHub API operations.

Methods:

- `syncSecret(owner, repo, name, value, scope)` - encrypt and upsert
- `syncVariable(owner, repo, name, value)` - create or update
- `syncSettings(owner, repo, settings)` - repos.update
- `syncRuleset(owner, repo, name, payload)` - create or update by name
- `listSecrets/listVariables/listRulesets` - query existing resources
- `deleteSecret/deleteVariable/deleteRuleset` - cleanup operations

Secret scopes: `actions`, `dependabot`, `codespaces` - each routes to the
appropriate Octokit API namespace.

Live: `GitHubClientLive(token)` creates an Octokit instance per token.
Test: `GitHubClientTest()` returns `{ layer, calls() }` recorder.

## SyncEngine

Orchestrates the full sync workflow.

- `syncAll(config, credentials, options)` - main entry point

Flow per repo group:

1. Resolve owner (group override or config default)
2. Resolve credential profile (explicit or implicit single profile)
3. Resolve all values via ValueResolver
4. For each repo (skipping mutations in dry-run):
   - Sync secrets by scope (actions/dependabot/codespaces)
   - Sync variables
   - Sync settings
   - Sync rulesets (JSON payload parsed from resolved value)
5. Cleanup phase: delete undeclared resources per scope, respecting
   preserve lists and group-level cleanup overrides

Options: `dryRun`, `noCleanup`, `groupFilter`, `repoFilter`
