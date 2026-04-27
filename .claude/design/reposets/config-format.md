---
module: reposets
title: Configuration Format
status: current
completeness: 95
last-synced: 2026-04-27
---

## Files

| File | Purpose | Location |
| :--- | :------ | :------- |
| `reposets.config.toml` | Groups, settings, environments, secrets, variables, rulesets, security, code_scanning, cleanup | XDG or project-local |
| `reposets.credentials.toml` | Named credential profiles with resolve sections (gitignored) | XDG config dir |

## Config Path Resolution

Resolution uses a declarative resolver chain (`FirstMatch` strategy,
first match wins). `makeConfigFilesLive(configFlag)` builds the chain:

1. `--config` flag: `ExplicitPath(flag)` if file, `StaticDir({ dir,
   filename })` if directory (prepended when `--config` is provided)
2. `UpwardWalk({ filename })` - walk up from cwd looking for
   `reposets.config.toml`
3. `XdgConfigResolver({ filename })` - `$XDG_CONFIG_HOME/reposets/` or
   `~/.config/reposets/`

Credentials use a separate chain: `UpwardWalk` + `XdgConfigResolver`
only (no `--config` flag support), with `XdgSavePath` as the default
save location.

File references in `file`-kind groups resolve relative to the directory
containing `reposets.config.toml`.

## Config Structure

```toml
owner = "spencerbeggs"
log_level = "info"

[settings.default]
has_wiki = false
has_discussions = false
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

[environments.staging]
wait_timer = 0

[environments.production]
wait_timer = 30
prevent_self_review = true

[[environments.production.reviewers]]
type = "User"
id = 12345

[environments.production.deployment_branches]
# "all", "protected", or array of custom policies

[secrets.deploy.file]
NPM_TOKEN = "./private/NPM_TOKEN"

[secrets.api.resolved]
API_KEY = "SILK_API_KEY"

[variables.turbo.value]
NODE_ENV = "production"
DO_NOT_TRACK = "1"

[variables.bot.resolved]
BOT_NAME = "SILK_BOT_NAME"

[rulesets.branch-protection]
name = "branch-protection"
type = "branch"
enforcement = "active"
targets = "default"
non_fast_forward = true

[rulesets.branch-protection.pull_requests]
approvals = 1
dismiss_stale_reviews = false

[rulesets.branch-protection.status_checks]
update_branch = true
default_integration_id = { resolved = "SILK_APP_ID" }

[[rulesets.branch-protection.status_checks.required]]
context = "CI"

[groups.my-projects]
repos = ["repo-one", "repo-two"]
settings = ["default"]
environments = ["staging", "production"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], environments = { production = ["api"] } }
variables = { actions = ["turbo", "bot"], environments = { staging = ["turbo"] } }
rulesets = ["branch-protection"]
security = ["baseline"]
code_scanning = ["baseline"]

[groups.my-projects.cleanup]
rulesets = true
environments = true

[groups.my-projects.cleanup.secrets]
actions = true
dependabot = { preserve = ["LEGACY_TOKEN"] }
environments = true

[groups.my-projects.cleanup.variables]
actions = true
environments = true
```

## Resource Group Model

Secret and variable groups are discriminated by kind. Each group is
exactly one kind, determined by its sub-key:

- `{ file = { NAME = "path" } }` - read from disk relative to config dir
- `{ value = { NAME = "string" } }` - inline; strings as-is, TOML tables
  JSON-stringified
- `{ resolved = { NAME = "LABEL" } }` - map names to credential labels
  from the active profile's `[resolve]` section

Rulesets are defined inline as typed TOML tables (see Ruleset Schema).
Integer fields in rulesets accept `{ resolved = "LABEL" }` for runtime
substitution.

## Ruleset Schema

Rulesets are a discriminated union by `type` field: `BranchRuleset` or
`TagRuleset`. Branch rulesets support all 21 rule types plus the
`pull_requests` shorthand; tag rulesets support 16 rule types (no
`merge_queue`, `pull_request`, `branch_name_pattern`, `workflows`,
`code_scanning`, `copilot_code_review`).

The full 22 GitHub rule types supported across both:
`creation`, `update`, `deletion`, `required_linear_history`,
`required_signatures`, `non_fast_forward`, `pull_request`,
`required_status_checks`, `required_deployments`, `merge_queue`,
`commit_message_pattern`, `commit_author_email_pattern`,
`committer_email_pattern`, `branch_name_pattern`, `tag_name_pattern`,
`file_path_restriction`, `file_extension_restriction`,
`max_file_path_length`, `max_file_size`, `workflows`, `code_scanning`,
`copilot_code_review`.

### Shorthand Fields

Rulesets support several shorthand fields that `normalizeRuleset()`
converts into API-compatible format:

- `targets` - `"default"` | `"all"` | array of `{ include }` /
  `{ exclude }` patterns -> `conditions.ref_name`
- `pull_requests` (branch only) - `{ approvals, dismiss_stale_reviews,
  code_owner_review, last_push_approval, resolve_threads, merge_methods,
  reviewers }` -> `pull_request` rule
- `status_checks` - `{ update_branch, on_creation,
  default_integration_id, required }` -> `required_status_checks` rule;
  `default_integration_id` applied to checks that omit it
- Boolean flags: `creation`, `update`, `deletion`,
  `required_linear_history`, `required_signatures`, `non_fast_forward` ->
  corresponding parameterless rules
- `deployments` - array of environment names ->
  `required_deployments` rule

All shorthand fields are stripped from the output after normalization.

Fields `actor_id`, `integration_id`, and `repository_id` accept either
a static integer or `{ resolved = "LABEL" }`.

## Environment Schema

Top-level `[environments.<name>]` tables define deployment environment
configurations:

- `wait_timer` - minutes to wait before allowing deployments (0-43200)
- `prevent_self_review` - prevent deployment trigger from approving
- `reviewers` - array of `{ type: "User"|"Team", id: number }`
- `deployment_branches` - `"all"` | `"protected"` | array of
  `{ name, type? }` custom policies (type defaults to `"branch"`)

Environments referenced by `group.environments` array are synced via
`GitHubClient.syncEnvironment()` before secrets/variables.

## Secret Scopes

Scoping is now structured as a `SecretScopes` object with four fields:

- `actions` - array of secret group names for GitHub Actions secrets
- `dependabot` - array of secret group names for Dependabot secrets
- `codespaces` - array of secret group names for Codespaces secrets
- `environments` - record mapping environment names to arrays of secret
  group names for environment-scoped secrets

The same secret group can be assigned to different scopes on different
groups.

## Variable Scopes

Variables use a `VariableScopes` object with two fields:

- `actions` - array of variable group names for GitHub Actions variables
- `environments` - record mapping environment names to arrays of variable
  group names for environment-scoped variables

## Group Reference Fields

`[groups.<name>]` accepts the following reference arrays, each pointing
into the matching top-level table:

- `settings: string[]` -> `[settings.*]`
- `rulesets: string[]` -> `[rulesets.*]`
- `environments: string[]` -> `[environments.*]`
- `security: string[]` -> `[security.*]` (new)
- `code_scanning: string[]` -> `[code_scanning.*]` (new)

Plus the `secrets: SecretScopes` and `variables: VariableScopes` structs
described above.

The `validateConfigRefs` callback (registered as the
`ReposetsConfigFile` validator) collects errors across every reference
array, including the new `security` and `code_scanning` arrays, and
reports all unknown references in a single `ConfigError`.

## Settings Schema

The `SettingsGroupSchema` is a typed struct with 20+ known fields and
pass-through for additional unknown fields via index signature. Known
fields include:

- Repository features: `is_template`, `has_wiki`, `has_issues`,
  `has_projects`, `has_discussions`, `has_sponsorships` (GraphQL),
  `has_pull_requests` (GraphQL)
- Forking: `allow_forking`
- Merge strategies: `allow_merge_commit`, `allow_squash_merge`,
  `allow_rebase_merge`, `allow_auto_merge`, `allow_update_branch`
- Merge commit formatting: `squash_merge_commit_title`,
  `squash_merge_commit_message`, `merge_commit_title`,
  `merge_commit_message`
- Cleanup: `delete_branch_on_merge`
- Security: `web_commit_signoff_required`

Fields `has_sponsorships` and `has_pull_requests` are synced via GraphQL
`updateRepository` mutation (not available in REST API).

### `security_and_analysis` Block

`SettingsGroupSchema` allows a nested `security_and_analysis` table whose
fields ride along with the same `PATCH /repos/{owner}/{repo}` call as the
rest of the settings block (see `transformSecurityAndAnalysis()` in
`GitHubClient`). Status fields take `"enabled" | "disabled"`:

- `advanced_security` (GHAS-licensed) - master GHAS toggle
- `code_security` (GHAS-licensed)
- `secret_scanning`
- `secret_scanning_push_protection`
- `secret_scanning_ai_detection` (GHAS-licensed)
- `secret_scanning_non_provider_patterns` (GHAS-licensed)
- `secret_scanning_delegated_alert_dismissal` (org-only)
- `secret_scanning_delegated_bypass` (org-only)
- `dependabot_security_updates`

Plus an optional `delegated_bypass_reviewers` array (org-only). Each
entry is a discriminated union: exactly one of `team` (a GitHub team
slug) or `role` (an organization role name from
`GET /orgs/{org}/organization-roles` such as `all_repo_admin` or a
custom role like `security_manager`), with an optional
`mode = "ALWAYS" | "EXEMPT"`. Both forms are resolved to numeric
`reviewer_id`s at sync time -- team slugs via
`GitHubClient.resolveTeamId()` and role names via
`GitHubClient.resolveRoleId()`. Role IDs are per-org even for predefined
roles, so the resolver must consult the live API per (org, role) pair.

```toml
[settings.oss-defaults.security_and_analysis]
secret_scanning = "enabled"
secret_scanning_push_protection = "enabled"
secret_scanning_ai_detection = "enabled"
dependabot_security_updates = "enabled"

[[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
team = "security-team"
mode = "ALWAYS"

[[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
role = "admin"
mode = "EXEMPT"
```

GHAS-licensed fields generally succeed on public repos and fail
(HTTP 422) on unlicensed private repos; org-only fields are silently
stripped from the merged block on personal accounts before the PATCH.
Omitting any field means "leave alone" - no separate cleanup scope.

## Security Group Schema

Top-level `[security.<name>]` groups configure repository security
features that have dedicated PUT/DELETE endpoints. Each field is an
optional boolean; omitted fields are "leave alone".

- `vulnerability_alerts` - Dependabot vulnerability alerts
  (`PUT`/`DELETE /repos/{o}/{r}/vulnerability-alerts`)
- `automated_security_fixes` - Dependabot security PRs
  (`PUT`/`DELETE /repos/{o}/{r}/automated-security-fixes`); requires
  `vulnerability_alerts` to also be enabled
- `private_vulnerability_reporting` - private vulnerability reporting
  inbox (`PUT`/`DELETE /repos/{o}/{r}/private-vulnerability-reporting`)

```toml
[security.baseline]
vulnerability_alerts = true
automated_security_fixes = true
private_vulnerability_reporting = true
```

Groups reference security groups via the `security: string[]` field on
`[groups.<name>]`. Multiple references are merged last-write-wins by
`mergeSecurityGroups()` at sync time; the SyncEngine probes current
state via the matching `getXxx` GitHubClient method and only PUTs/DELETEs
on diff.

## Code Scanning Group Schema

Top-level `[code_scanning.<name>]` groups configure the
CodeQL default-setup feature, applied via
`PATCH /repos/{o}/{r}/code-scanning/default-setup`. Fields:

- `state` - `"configured" | "not-configured"`
- `languages` - array of CodeQL default-setup language literals (see
  enum below); languages not detected in the repository are filtered
  out at sync time with a warning rather than failing the run
- `query_suite` - `"default" | "extended"`
- `threat_model` - `"remote" | "remote_and_local"`
- `runner_type` - `"standard" | "labeled"`
- `runner_label` - free-form runner label string; required when
  `runner_type = "labeled"`

```toml
[code_scanning.baseline]
state = "configured"
languages = ["javascript-typescript", "python"]
query_suite = "extended"
threat_model = "remote"
runner_type = "standard"
```

Default-setup language enum (9 values):
`actions`, `c-cpp`, `csharp`, `go`, `java-kotlin`,
`javascript-typescript`, `python`, `ruby`, `swift`.

This is intentionally narrower than the CodeQL analyzer language list -
Rust is supported by CodeQL itself but not by default setup as of this
writing. Add to the literal when GitHub widens default-setup support.

Groups reference code scanning groups via the `code_scanning: string[]`
field on `[groups.<name>]`. Multiple references are merged last-write-wins
by `mergeCodeScanningGroups()`. The PATCH endpoint returns
`202 Accepted`; reposets fires-and-forgets by default and polls in
verbose mode.

## Cleanup Configuration

Cleanup is per-group (not global). Each group can have its own
`[groups.<name>.cleanup]` section.

The `CleanupScope` type is a three-way union:

- `false` - cleanup disabled (default)
- `true` - delete all undeclared resources
- `{ preserve = ["name1", "name2"] }` - delete undeclared except preserved

Cleanup is organized into nested scopes:

```text
cleanup
  secrets
    actions:      CleanupScope
    dependabot:   CleanupScope
    codespaces:   CleanupScope
    environments: CleanupScope
  variables
    actions:      CleanupScope
    environments: CleanupScope
  rulesets:       CleanupScope
  environments:   CleanupScope
```

All scopes default to `false`. Cleanup runs after sync so newly synced
items are never deleted.

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

If only one profile exists, it is used implicitly. Multiple profiles are
referenced by name from groups via `credentials = "profile-name"`.

The `[resolve]` section defines named labels in three sub-groups:
`op` (1Password references), `file` (file paths), `value` (inline
strings or objects). All three contribute to a flat namespace of
labels referenced by config templates.

## JSON Schema Generation

Effect Schema definitions generate JSON schemas via `JsonSchemaExporter`
from xdg-effect (v1.0.0). The generation script
(`package/lib/scripts/generate-json-schema.ts`) uses the standard
`generateMany` -> `validateMany` -> `writeMany` pipeline:

1. Calls `JsonSchemaExporter.generateMany()` with schema definitions,
   root def names, and `$id` URLs
2. Calls `JsonSchemaValidator.validateMany()` for strict-mode validation
   (custom extension keywords `x-tombi-*`, `x-taplo` are handled
   internally by the validator service)
3. Writes output via `JsonSchemaExporter.writeMany()` to
   `package/schemas/` (only writes when content changed)

`$id` values (externally hosted on GitHub):

- Config: `https://raw.githubusercontent.com/spencerbeggs/reposets/main/package/schemas/reposets.config.schema.json`
- Credentials: `https://raw.githubusercontent.com/spencerbeggs/reposets/main/package/schemas/reposets.credentials.schema.json`

### Schema Annotations

Schemas use two typed annotation helpers from xdg-effect:

- `tombi({ ... })` -- generates `x-tombi-*` annotations for Tombi TOML
  LSP: `additionalKeyLabel`, `tableKeysOrder`, `arrayValuesOrder`,
  `arrayValuesOrderBy`, `stringFormats`, `tomlVersion`
- `taplo({ ... })` -- generates `x-taplo` annotations for Taplo TOML
  LSP: `initKeys` (scaffolding hints) and `links.key` (documentation
  URLs)

Both helpers are applied via the `jsonSchema: { ... }` annotation
property. When a schema needs both, the results are spread together:
`jsonSchema: { ...tombi({ ... }), ...taplo({ ... }) }`.

Standard annotations (`title`, `description`, `examples`, `default`)
are set directly on all fields.

### Jsonifiable Type

Schema fields that accept arbitrary JSON-compatible values (settings
pass-through, inline credential values) use the `Jsonifiable` schema
from xdg-effect instead of `Schema.Unknown`. This ensures generated
JSON schemas produce `{}` instead of `{ "$id": "/schemas/unknown" }`
for those positions. Three files use `Jsonifiable`: `common.ts`
(resource value kind), `credentials.ts` (resolve value entries), and
`config.ts` (settings group index signature).

### Dependencies

- `xdg-effect` (^1.0.0) -- `JsonSchemaExporter`, `JsonSchemaValidator`,
  `Jsonifiable`, `tombi()`, `taplo()` helpers
