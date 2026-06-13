---
module: reposets
title: Effect Services
category: architecture
status: current
completeness: 90
created: 2026-04-21
updated: 2026-06-12
last-synced: 2026-06-12
related:
  - architecture.md
  - config-format.md
  - json-schema.md
dependencies: []
---

## Overview

Six Effect services compose the sync pipeline. Each lives in its own file under `package/src/services/` and ships a Live and a Test layer. This doc records what each service is responsible for, the boundaries between them and the non-obvious decisions — interface shapes and method signatures are authoritative in the source files, not here.

## ConfigFiles

Declarative config loading via xdg-effect `ConfigFile.Tag`. See `package/src/services/ConfigFiles.ts`.

- `ReposetsConfigFile` and `ReposetsCredentialsFile` are `ConfigFile.Tag` services (`discover`, `load`, `loadOrDefault`, `save`, `update`), validated against `ConfigSchema` / `CredentialsSchema`.
- `makeConfigFilesLive(configFlag)` builds the resolver chain from the `--config` flag: a file flag prepends `ExplicitPath`, a directory flag prepends `StaticDir`, and `UpwardWalk` + `XdgConfigResolver` are always appended as fallbacks. `ConfigFilesLive` is the no-flag alias.
- `validateConfigRefs(config)` is registered as the config validator; it collects every cross-reference error (settings, secrets, variables, rulesets, environments, security, code_scanning) into a single `ConfigError`.

The service definition does no direct I/O — it composes xdg-effect's `XdgConfigLive.multi()` with a TOML codec and first-match strategy.

## OnePasswordClient

Wraps `@1password/sdk` to resolve `op://` references. The Live layer dynamically imports the SDK and creates a client per call; the Test layer returns values from a stub map. See `package/src/services/OnePasswordClient.ts`.

## CredentialResolver

Resolves every label in a profile's `[resolve]` section into one flat `Map<string, string>`. The three sub-groups — `value` (inline, objects JSON-stringified), `file` (read relative to the config dir, trimmed) and `op` (delegated to `OnePasswordClient`) — share a single namespace, so duplicate labels across sub-groups are a validation error. Depends on `OnePasswordClient`. See `package/src/services/CredentialResolver.ts`.

## SyncLogger

Tiered output for the sync pipeline; all sync output flows through it rather than direct console calls. CLI commands use `Effect.log`/`Effect.logError` routed by `CliLogger` instead. See `package/src/services/SyncLogger.ts`.

Visibility tiers: `silent` (nothing), `info` (group/repo headers, summary and cleanup counts with names), `verbose` (per-operation lines), `debug` (per-operation lines with source info). Dry-run prefixes verbs with "would". Errors accumulate in a `Ref` and are reported in `finish()` as an end-of-run summary. `SyncLoggerLive` accepts an optional `output` Ref for test capture.

## GitHubClient

Octokit wrapper exposing typed methods across five domains: repo-level resources, environments, environment-scoped resources, repository security features and CodeQL default setup. See the service interface and `GitHubClientTest()` recorder in `package/src/services/GitHubClient.ts`. The decisions worth knowing:

- `getOwnerType(owner)` drives org-only field stripping upstream in the SyncEngine.
- `syncSettings` sends standard fields via REST `repos.update`; `has_sponsorships` and `has_pull_requests` route through a GraphQL `updateRepository` mutation (mapped by the `GRAPHQL_SETTINGS` constant), which resolves the repo `node_id` via `octokit.repos.get()` first. The method strips merge-commit/squash formatting fields when the matching strategy is disabled.
- The `security_and_analysis` block is folded into the same settings PATCH. `transformSecurityAndAnalysis(value)` (exported for unit testing) wraps each status field as `{ status: "..." }`, rewrites `delegated_bypass_reviewers` under `secret_scanning_delegated_bypass_options.reviewers`, and returns `undefined` when empty so callers omit the field. The status-field set is `SAA_STATUS_FIELDS` in the same file.
- Repository security features (`vulnerability_alerts`, `automated_security_fixes`, `private_vulnerability_reporting`) each have a `getXxx` probe returning a normalized boolean and a `setXxx` toggle hitting dedicated PUT/DELETE endpoints. The SyncEngine uses the probe to diff before toggling.
- `updateCodeScanningDefaultSetup` PATCHes the default-setup endpoint, which responds `202 Accepted` and applies asynchronously; the engine fires the request without polling.
- `listRepoLanguages` returns the language-name keys from `octokit.repos.listLanguages`, used to filter configured CodeQL languages against what GitHub detects.
- `resolveTeamId(org, slug)` and `resolveRoleId(org, name)` map `delegated_bypass_reviewers` entries to numeric `{ reviewer_id, reviewer_type }`. Both cache per `org:slug` / `org:name` for the GitHubClient instance lifetime. Role IDs are per-org even for predefined roles, so resolution must hit the live API the first time each (org, role) pair appears; an unknown role surfaces as `GitHubApiError` and follows the catch-and-warn path.

`GitHubClientLive(token)` creates one Octokit instance per token; the team/role caches are per instance.

## SyncEngine

Orchestrates the full workflow; depends on `GitHubClient`, `CredentialResolver` and `SyncLogger`. Entry point `syncAll(config, credentials, options)` with options `dryRun`, `noCleanup`, `groupFilter`, `repoFilter` and `configDir`. The stage order is described in `architecture.md`; the per-stage detail lives in `package/src/services/SyncEngine.ts`. The decisions worth recording:

- Settings from referenced groups merge, and each group's `security_and_analysis` block merges separately via `mergeSecurityAndAnalysis()` (last-write-wins). On personal accounts `ORG_ONLY_SAA_FIELDS` are stripped; on org accounts `delegated_bypass_reviewers` team slugs and role names resolve to numeric reviewer IDs before the merged block is reinjected for the PATCH.
- `mergeSecurityGroups()` and `mergeCodeScanningGroups()` merge `[security.*]` and `[code_scanning.*]` references last-write-wins, leaving undefined keys as "leave alone". After the security merge the engine detects the `automated_security_fixes = true` with `vulnerability_alerts = false` contradiction that a single group's schema rejects but merging can recreate; if found it logs an error and skips the security stage for those repos rather than letting GitHub return 422.
- Rulesets are collected from config, normalized via `normalizeRuleset()` and have `{ resolved }` references substituted from the credential map (coerced to integers where needed).
- Cleanup is computed per group (no global merge, defaults to all-off) and runs last, respecting the three-way `CleanupScope` preserve lists. Ruleset cleanup skips org-level rulesets whose `source_type !== "Repository"`.

### Language mapping

`REPO_LANG_TO_CODEQL` (top of `SyncEngine.ts`) maps repo language names from `octokit.repos.listLanguages` onto the CodeQL default-setup enum. Languages outside the map are dropped from the detected set; the code-scanning stage uses that set to decide whether a configured CodeQL language passes through or is skipped with a warning. The `actions` pseudo-language always passes through because it is not a repo language. See `config-format.md` for the default-setup enum.
