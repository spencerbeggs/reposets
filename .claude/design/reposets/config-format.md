---
module: reposets
title: Configuration Format
category: other
status: current
completeness: 90
created: 2026-04-21
updated: 2026-06-12
last-synced: 2026-06-12
related:
  - architecture.md
  - services.md
  - json-schema.md
dependencies: []
---

## Overview

reposets reads two TOML files. This doc describes their structure and the schemas that validate them — the authoritative shapes live in `package/src/schemas/`. Generation of editor JSON schemas from these definitions is a separate build-time subsystem; see `json-schema.md`.

| File | Purpose | Location |
| :--- | :------ | :------- |
| `reposets.config.toml` | Groups, settings, environments, secrets, variables, rulesets, security, code_scanning, cleanup | XDG or project-local |
| `reposets.credentials.toml` | Named credential profiles with resolve sections (gitignored) | XDG config dir |

## Config path resolution

A declarative resolver chain (first match wins) finds the config. `makeConfigFilesLive(configFlag)` builds it:

1. `--config` flag: `ExplicitPath(flag)` for a file or `StaticDir` for a directory, prepended when the flag is present.
2. `UpwardWalk` — walk up from cwd looking for `reposets.config.toml`.
3. `XdgConfigResolver` — `$XDG_CONFIG_HOME/reposets/` or `~/.config/reposets/`.

Credentials use a separate chain — `UpwardWalk` + `XdgConfigResolver` only, no `--config` support — with `XdgSavePath` as the default save location. File references in `file`-kind groups resolve relative to the directory containing `reposets.config.toml`.

## Config structure

```toml
owner = "spencerbeggs"
log_level = "info"

[settings.default]
has_wiki = false
delete_branch_on_merge = true

[settings.default.security_and_analysis]
secret_scanning = "enabled"
secret_scanning_push_protection = "enabled"
dependabot_security_updates = "enabled"

[security.baseline]
vulnerability_alerts = true
automated_security_fixes = true
private_vulnerability_reporting = true

[code_scanning.baseline]
state = "configured"
languages = ["javascript-typescript", "python"]
query_suite = "extended"

[environments.production]
wait_timer = 30
prevent_self_review = true

[[environments.production.reviewers]]
type = "User"
id = 12345

[secrets.deploy.file]
NPM_TOKEN = "./private/NPM_TOKEN"

[secrets.api.resolved]
API_KEY = "SILK_API_KEY"

[variables.turbo.value]
NODE_ENV = "production"

[rulesets.branch-protection]
name = "branch-protection"
type = "branch"
enforcement = "active"
targets = "default"
non_fast_forward = true

[rulesets.branch-protection.pull_requests]
approvals = 1

[rulesets.branch-protection.status_checks]
default_integration_id = { resolved = "SILK_APP_ID" }

[[rulesets.branch-protection.status_checks.required]]
context = "CI"

[groups.my-projects]
repos = ["repo-one", "repo-two"]
settings = ["default"]
environments = ["production"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], environments = { production = ["api"] } }
variables = { actions = ["turbo"], environments = { staging = ["turbo"] } }
rulesets = ["branch-protection"]
security = ["baseline"]
code_scanning = ["baseline"]

[groups.my-projects.cleanup]
rulesets = true
environments = true

[groups.my-projects.cleanup.secrets]
actions = true
dependabot = { preserve = ["LEGACY_TOKEN"] }

[groups.my-projects.cleanup.variables]
actions = true
```

## Resource group model

Secret and variable groups are discriminated by kind — each group is exactly one kind, determined by its sub-key:

- `{ file = { NAME = "path" } }` — read from disk relative to the config dir.
- `{ value = { NAME = "string" } }` — inline; strings as-is, TOML tables JSON-stringified.
- `{ resolved = { NAME = "LABEL" } }` — map names to credential labels from the active profile's `[resolve]` section.

Rulesets are typed TOML tables (see Ruleset schema). Integer fields in rulesets accept `{ resolved = "LABEL" }` for runtime substitution.

## Ruleset schema

Rulesets are a discriminated union by `type`: `BranchRuleset` or `TagRuleset`. Branch rulesets support the full GitHub rule set plus the `pull_requests` shorthand; tag rulesets support the subset that applies to tags (no `merge_queue`, `pull_request`, `branch_name_pattern`, `workflows`, `code_scanning` or `copilot_code_review`). The authoritative rule list and per-type support are in `package/src/schemas/ruleset.ts`.

### Shorthand fields

`normalizeRuleset()` converts ergonomic shorthand fields into the API-compatible rule format, then strips them from the output:

- `targets` (`"default"` | `"all"` | array of `{ include }` / `{ exclude }` patterns) -> `conditions.ref_name`.
- `pull_requests` (branch only) -> the `pull_request` rule.
- `status_checks` -> the `required_status_checks` rule; a top-level `default_integration_id` is applied to checks that omit it.
- Boolean flags (`creation`, `update`, `deletion`, `required_linear_history`, `required_signatures`, `non_fast_forward`) -> the corresponding parameterless rules.
- `deployments` (array of environment names) -> the `required_deployments` rule.

Fields `actor_id`, `integration_id` and `repository_id` accept a static integer or `{ resolved = "LABEL" }`.

## Environment schema

Top-level `[environments.<name>]` tables define deployment environments:

- `wait_timer` — minutes to wait before deployments (0-43200).
- `prevent_self_review` — prevent the deployment trigger from approving.
- `reviewers` — array of `{ type: "User" | "Team", id: number }`.
- `deployment_branches` — `"all"` | `"protected"` | array of `{ name, type? }` custom policies (type defaults to `"branch"`).

Environments referenced by a group's `environments` array sync via `GitHubClient.syncEnvironment()` before secrets and variables.

## Secret and variable scopes

Secrets are assigned through a `SecretScopes` struct: `actions`, `dependabot` and `codespaces` (each an array of secret group names) plus `environments` (a record mapping environment names to arrays of secret group names). Variables use a `VariableScopes` struct with `actions` and `environments`. The same group can be assigned to different scopes on different groups.

## Group reference fields

`[groups.<name>]` accepts reference arrays, each pointing into the matching top-level table: `settings`, `rulesets`, `environments`, `security` and `code_scanning`, plus the `secrets` and `variables` scope structs above. The `validateConfigRefs` callback (the `ReposetsConfigFile` validator) collects unknown references across every array and reports them in a single `ConfigError`.

## Settings schema

`SettingsGroupSchema` is a typed struct of known fields with an index signature for pass-through of unknown fields. See `package/src/schemas/config.ts` for the field list. Known fields cover repository features, forking, merge strategies and commit formatting, branch-delete-on-merge and `web_commit_signoff_required`. `has_sponsorships` and `has_pull_requests` are synced via the GraphQL `updateRepository` mutation rather than REST.

### `security_and_analysis` block

`SettingsGroupSchema` allows a nested `security_and_analysis` table whose fields ride along with the same `PATCH /repos/{owner}/{repo}` call as the rest of the settings (reshaped by `transformSecurityAndAnalysis()` in `GitHubClient`). Status fields take `"enabled" | "disabled"` and cover the GHAS toggles, secret-scanning variants and `dependabot_security_updates`; some are GHAS-licensed and some are org-only. The exact field set is `SAA_STATUS_FIELDS` in `package/src/services/GitHubClient.ts`.

The block also accepts an org-only `delegated_bypass_reviewers` array. Each entry is a discriminated union of exactly one of `team` (a GitHub team slug) or `role` (an organization role name from `GET /orgs/{org}/organization-roles`), with an optional `mode = "ALWAYS" | "EXEMPT"`. Both forms resolve to numeric `reviewer_id`s at sync time — team slugs via `GitHubClient.resolveTeamId()`, role names via `GitHubClient.resolveRoleId()`. Role IDs are per-org even for predefined roles, so resolution consults the live API per (org, role) pair.

```toml
[settings.oss-defaults.security_and_analysis]
secret_scanning = "enabled"
secret_scanning_push_protection = "enabled"
dependabot_security_updates = "enabled"

[[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
team = "security-team"
mode = "ALWAYS"

[[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
role = "admin"
mode = "EXEMPT"
```

GHAS-licensed fields generally succeed on public repos and fail (HTTP 422) on unlicensed private repos; org-only fields are stripped from the merged block on personal accounts before the PATCH. Omitting any field means "leave alone" — there is no cleanup scope for it.

## Security group schema

Top-level `[security.<name>]` groups configure the repository security features that have dedicated PUT/DELETE endpoints. Each field is an optional boolean; omitted fields are "leave alone".

- `vulnerability_alerts` — Dependabot vulnerability alerts.
- `automated_security_fixes` — Dependabot security PRs; requires `vulnerability_alerts` to also be enabled.
- `private_vulnerability_reporting` — private vulnerability reporting inbox.

Groups reference these via the `security: string[]` field. Multiple references merge last-write-wins via `mergeSecurityGroups()`; the SyncEngine probes current state with the matching `getXxx` method and only toggles on diff.

## Code scanning group schema

Top-level `[code_scanning.<name>]` groups configure CodeQL default setup, applied via `PATCH /repos/{o}/{r}/code-scanning/default-setup`. Fields: `state` (`"configured" | "not-configured"`), `languages` (default-setup language literals, filtered against detected languages with a warning rather than a failure), `query_suite`, `threat_model`, `runner_type` and `runner_label` (required when `runner_type = "labeled"`).

The default-setup language enum is `actions`, `c-cpp`, `csharp`, `go`, `java-kotlin`, `javascript-typescript`, `python`, `ruby` and `swift`. This is intentionally narrower than the CodeQL analyzer language list — for example Rust is supported by the CodeQL analyzer but not by default setup. Widen the literal in `package/src/schemas/config.ts` if GitHub extends default-setup support.

Groups reference these via `code_scanning: string[]`; multiple references merge last-write-wins via `mergeCodeScanningGroups()`. The PATCH endpoint returns `202 Accepted` and the engine fires it without polling for completion.

## Cleanup configuration

Cleanup is per group, not global; each group can have its own `[groups.<name>.cleanup]` section. The `CleanupScope` type is a three-way union: `false` (disabled, the default), `true` (delete all undeclared resources) or `{ preserve = [...] }` (delete undeclared except preserved).

Scopes nest as `cleanup.secrets.{actions,dependabot,codespaces,environments}`, `cleanup.variables.{actions,environments}`, `cleanup.rulesets` and `cleanup.environments`. All default to `false`. Cleanup runs after sync so newly synced items are never deleted. Security features and code scanning have no cleanup scope — omission means "leave alone".

## Credentials

```toml
[profiles.personal]
github_token = "ghp_..."
op_service_account_token = "ops_..."

[profiles.personal.resolve.op]
SILK_APP_ID = "op://vault/item/field"

[profiles.personal.resolve.file]
DEPLOY_KEY = "./private/deploy.key"

[profiles.personal.resolve.value]
BOT_NAME = "mybot[bot]"
REGISTRIES = { npm = "https://registry.npmjs.org" }
```

A single profile is used implicitly; multiple profiles are referenced by name from groups via `credentials = "profile-name"`. The `[resolve]` section defines named labels in three sub-groups — `op` (1Password references), `file` (file paths) and `value` (inline strings or objects) — that all contribute to one flat namespace referenced by config templates.
