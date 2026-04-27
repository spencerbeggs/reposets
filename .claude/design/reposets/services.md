---
module: reposets
title: Effect Services
status: current
completeness: 95
last-synced: 2026-04-27
---

## ConfigFiles

Declarative config file loading via xdg-effect `ConfigFile.Tag` services.
Replaces the former `ConfigLoader` service.

- `ReposetsConfigFile` (`ConfigFile.Tag<Config>`) - config file service
  with `discover` (find and parse), `load`, `loadOrDefault`, `save`,
  `update` methods; schema validation via `ConfigSchema`; cross-reference
  validation via `validateConfigRefs` callback
- `ReposetsCredentialsFile` (`ConfigFile.Tag<Credentials>`) - credentials
  file service with same methods; schema validation via
  `CredentialsSchema`; default XDG save path
- `makeConfigFilesLive(configFlag: Option<string>)` - factory that builds
  resolver chains based on the `--config` flag:
  - `Some(file)` -> prepends `ExplicitPath(flag)`
  - `Some(directory)` -> prepends `StaticDir({ dir, filename })`
  - Always appends `UpwardWalk` + `XdgConfigResolver` as fallbacks
- `ConfigFilesLive` - convenience alias for `makeConfigFilesLive(Option.none())`
- `validateConfigRefs(config)` - validates all internal cross-references
  (settings, secrets, variables, rulesets, environments) and collects
  errors into a single `ConfigError`

Implementation: `XdgConfigLive.multi()` with `TomlCodec` and
`FirstMatch` strategy. Each command provides its own layer via
`makeConfigFilesLive(config)`. No direct I/O in the service definition.

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
this service rather than direct console calls. CLI commands use
`Effect.log`/`Effect.logError` with a custom `CliLogger` (defined in
the entrypoint) that routes to stdout/stderr.

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

Wraps Octokit with typed methods for all GitHub API operations. 30 methods
organized into five domains: repo-level resources, environments,
environment-scoped resources, repository security features, and CodeQL
default setup.

### Repo-Level Methods

- `getOwnerType(owner)` - determine if owner is a User or Organization
- `syncSecret(owner, repo, name, value, scope)` - encrypt and upsert
  (actions/dependabot/codespaces)
- `syncVariable(owner, repo, name, value)` - create or update
- `syncSettings(owner, repo, settings)` - REST `repos.update` for standard
  fields; GraphQL `updateRepository` mutation for `has_sponsorships` and
  `has_pull_requests` (mapped via `GRAPHQL_SETTINGS` constant). The
  `security_and_analysis` field is folded into the REST PATCH body by the
  SyncEngine via `transformSecurityAndAnalysis()` (status fields wrapped
  as `{ status: "enabled" | "disabled" }`; `delegated_bypass_reviewers`
  rewritten under `secret_scanning_delegated_bypass_options.reviewers`)
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

### Repository Security Methods

State-probe + toggle pairs for each of the three dedicated PUT/DELETE
endpoints. Probes are used by the SyncEngine's security-features stage to
diff current vs. desired state and only call PUT/DELETE on change. All
return booleans normalized from the underlying API responses.

- `getVulnerabilityAlerts(owner, repo): boolean` -
  `GET /repos/{o}/{r}/vulnerability-alerts` (404 -> `false`,
  204 -> `true`)
- `setVulnerabilityAlerts(owner, repo, enabled): void` -
  `PUT` (enabled) / `DELETE` (disabled) on the same path
- `getAutomatedSecurityFixes(owner, repo): boolean` -
  `GET /repos/{o}/{r}/automated-security-fixes`; reads `data.enabled`
- `setAutomatedSecurityFixes(owner, repo, enabled): void` -
  `PUT`/`DELETE /repos/{o}/{r}/automated-security-fixes`
- `getPrivateVulnerabilityReporting(owner, repo): boolean` -
  `GET /repos/{o}/{r}/private-vulnerability-reporting`; reads
  `data.enabled`
- `setPrivateVulnerabilityReporting(owner, repo, enabled): void` -
  `PUT`/`DELETE /repos/{o}/{r}/private-vulnerability-reporting`

### Code Scanning Methods

- `getCodeScanningDefaultSetup(owner, repo): CodeScanningDefaultSetup` -
  `GET /repos/{o}/{r}/code-scanning/default-setup`. Returns the current
  setup (state, languages, query_suite, threat_model, runner_type,
  runner_label)
- `updateCodeScanningDefaultSetup(owner, repo, config): void` -
  `PATCH /repos/{o}/{r}/code-scanning/default-setup`. The endpoint
  responds `202 Accepted` and applies asynchronously; the SyncEngine
  sends the request without polling for completion

### Helper Methods

- `listRepoLanguages(owner, repo): string[]` - thin wrapper around
  `octokit.repos.listLanguages` returning the language-name keys; used to
  filter configured CodeQL languages against what GitHub detects in the
  repo
- `resolveTeamId(org, slug): number` - looks up
  `GET /orgs/{org}/teams/{slug}` and caches the numeric team id keyed by
  `org:slug` for the lifetime of the GitHubClient instance. Used to map
  `delegated_bypass_reviewers[].team` slugs to API-shaped
  `{ reviewer_id, reviewer_type: "TEAM" }` entries during settings sync

### `transformSecurityAndAnalysis` helper

Exported alongside the service interface for direct unit testing.
`transformSecurityAndAnalysis(value)` translates the user-facing
`security_and_analysis` config block into the shape the GitHub REST API
expects on `PATCH /repos/{o}/{r}`:

- Each known status field (members of the `SAA_STATUS_FIELDS` set:
  `advanced_security`, `code_security`, `secret_scanning`,
  `secret_scanning_push_protection`,
  `secret_scanning_ai_detection`,
  `secret_scanning_non_provider_patterns`,
  `secret_scanning_delegated_alert_dismissal`,
  `secret_scanning_delegated_bypass`,
  `dependabot_security_updates`) wraps its `"enabled" | "disabled"`
  value as `{ status: "..." }`
- `delegated_bypass_reviewers` is rewritten under
  `secret_scanning_delegated_bypass_options.reviewers` (entries are
  expected to already carry numeric `reviewer_id` and `reviewer_type`;
  team-slug resolution happens in the SyncEngine before calling the
  transform)
- Returns `undefined` when the result is empty so callers can omit the
  field cleanly from the PATCH body

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

Live: `GitHubClientLive(token)` creates an Octokit instance per token; the
`teamIdCache` (Map<string, number> keyed by `org:slug`) is per-instance.
Test: `GitHubClientTest()` returns `{ layer, calls() }` recorder covering
all 30 methods.

## SyncEngine

Orchestrates the full sync workflow. Depends on `GitHubClient`,
`CredentialResolver`, and `SyncLogger`.

- `syncAll(config, credentials, options)` - main entry point

Flow per group:

1. Resolve owner (group override or config default)
2. Resolve credential profile (explicit or implicit single profile)
3. Resolve all credential labels via `CredentialResolver.resolveAll()`
   into a flat `Map<string, string>`
4. Detect ownership type via `GitHubClient.getOwnerType()` (defaults to
   `"User"` on API failure); used to strip org-only fields
5. Resolve secret groups by scope: `actions`, `dependabot`, `codespaces`
   each get their own resolved map
6. Resolve variable groups from `variables.actions` references
7. Collect rulesets from config; normalize shorthands via
   `normalizeRuleset()`; substitute `{ resolved }` references with values
   from the credential map, coercing to integers where needed
8. Resolve environment references from `group.environments` array
9. Resolve environment-scoped secrets from `group.secrets.environments`
   mapping (env name -> secret group refs)
10. Resolve environment-scoped variables from `group.variables.environments`
    mapping (env name -> variable group refs)
11. Merge settings from referenced setting groups; pull each group's
    `security_and_analysis` block aside and merge those separately via
    `mergeSecurityAndAnalysis()` (last-write-wins). Strip `ORG_ONLY_SAA_FIELDS`
    (`secret_scanning_delegated_alert_dismissal`,
    `secret_scanning_delegated_bypass`, `delegated_bypass_reviewers`) on
    personal accounts; on org accounts, resolve each
    `delegated_bypass_reviewers[].team` slug to a numeric `reviewer_id`
    via `GitHubClient.resolveTeamId()` and rewrite `{ role: ... }` entries
    to `{ reviewer_id: <role-string>, reviewer_type: "ROLE" }`. Inject the
    resolved block back into `mergedSettings` under
    `security_and_analysis` so it rides along with the existing
    `syncSettings` PATCH (where `transformSecurityAndAnalysis()` reshapes
    it for the API)
12. Merge `[security.*]` groups via `mergeSecurityGroups()` and
    `[code_scanning.*]` groups via `mergeCodeScanningGroups()` -
    last-write-wins across all references; missing keys remain undefined
    so they're "leave alone" at sync time
13. Compute per-group cleanup config (no global merge; defaults to all-off)
14. For each repo (skipping mutations in dry-run):
    - Sync settings (merged settings + folded `security_and_analysis`)
    - Security features stage (inline): for each of `vulnerability_alerts`,
      `automated_security_fixes`, `private_vulnerability_reporting`, probe
      current state via the corresponding `getXxx` method and call PUT or
      DELETE only when the desired value differs
    - Code scanning stage (inline): filter merged
      `code_scanning.languages[]` against languages detected by
      `listRepoLanguages` (mapped through the `REPO_LANG_TO_CODEQL`
      table; `actions` always passes through), then call
      `updateCodeScanningDefaultSetup`. Languages not detected emit a
      `skip` log line at info/verbose levels rather than failing
    - Sync environments (must exist before scoped resources)
    - Sync secrets by scope (actions/dependabot/codespaces)
    - Sync environment secrets per environment
    - Sync variables (actions scope)
    - Sync environment variables per environment
    - Sync rulesets (fully resolved/normalized `Ruleset` objects)
15. Cleanup phase per scope: delete undeclared resources respecting
    preserve lists from the three-way `CleanupScope` union
    - Actions/dependabot/codespaces secrets
    - Environment secrets (per environment)
    - Actions variables
    - Environment variables (per environment)
    - Rulesets (skips org-level with `source_type !== "Repository"`)
    - Environments

Options: `dryRun`, `noCleanup`, `groupFilter`, `repoFilter`, `configDir`

### Merge Helpers

Three internal helpers implement last-write-wins merging across reference
lists in declaration order:

- `mergeSecurityAndAnalysis(blocks)` - merges
  `SecurityAndAnalysis | undefined` blocks pulled from each referenced
  setting group; returns `undefined` when no block contributed any keys
  so the entire `security_and_analysis` field can be omitted from the
  PATCH
- `mergeSecurityGroups(groups)` - merges `SecurityGroup` toggles from
  `[security.*]` references; only keeps boolean values, so partial
  configurations cleanly carry through
- `mergeCodeScanningGroups(groups)` - merges `CodeScanningGroup` configs
  from `[code_scanning.*]` references; preserves any defined keys
  (state/languages/query_suite/etc.) and lets undefined keys fall through
  as "leave alone"

### Language Mapping

`REPO_LANG_TO_CODEQL` (defined at the top of `SyncEngine.ts`) maps repo
language names (as returned by `octokit.repos.listLanguages`) onto the
default-setup language enum:

- `JavaScript`, `TypeScript` -> `javascript-typescript`
- `C`, `C++` -> `c-cpp`
- `C#` -> `csharp`
- `Go` -> `go`
- `Java`, `Kotlin` -> `java-kotlin`
- `Python` -> `python`
- `Ruby` -> `ruby`
- `Swift` -> `swift`

Languages outside the map are dropped from the detected set; the
code scanning stage uses this set to decide whether a configured
CodeQL language should be passed through or skipped with a warning. The
`actions` pseudo-language always passes through unchanged because it
isn't a repo language at all.
