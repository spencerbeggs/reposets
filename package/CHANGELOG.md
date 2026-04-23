# reposets

## 0.2.1

### Patch Changes

* 848cb75: ## Bug Fixes

  ### JSON Schema `$id` URLs

  Updated `$id` values in generated JSON schemas to point to the actual hosting
  location on GitHub rather than SchemaStore URLs that never resolve for
  externally-hosted schemas.

  * `reposets.config.schema.json` now uses its raw GitHub URL as `$id`
  * `reposets.credentials.schema.json` now uses its raw GitHub URL as `$id`

  ### Schema Generation Pipeline

  Replaced hand-rolled Ajv validation with xdg-effect's `JsonSchemaValidator`
  service. The generation script now uses the standard
  `generateMany` -> `validateMany` -> `writeMany` pipeline.

  ## Dependencies

  * Upgraded `xdg-effect` from 0.3.1 to 0.3.3

  ## Maintenance

  * Fixed invalid `x-tombi-table-keys-order` annotation on `RulesetSchema` union
    node (now only on the individual struct members where it is valid)

## 0.2.0

### Minor Changes

* 550612e: ## Features

  ### SchemaStore Compatibility

  JSON Schemas now include `$id` fields pointing to SchemaStore URLs and pass Ajv strict-mode validation, ready for submission to the JSON Schema Store for automatic editor detection.

  * Config schema: `https://json.schemastore.org/reposets.config.json`
  * Credentials schema: `https://json.schemastore.org/reposets.credentials.json`

  ### TOML Language Server Support

  Added typed annotations for both major TOML language servers:

  * Taplo: `x-taplo` annotations with `initKeys` for autocompletion scaffolding and `links.key` for documentation URLs
  * Tombi: migrated all `x-tombi-*` annotations to typed `tombi()` helper calls

  ### Cleaner Schema Output

  * Replaced `Schema.Unknown` with `Jsonifiable` from xdg-effect, eliminating `$id: /schemas/unknown` artifacts
  * Empty `required: []` arrays and `properties: {}` on Record types removed by xdg-effect cleanup pass

  ## Maintenance

  * Upgraded xdg-effect from v0.2.0 to v0.3.1
  * Added ajv as a devDependency for strict schema validation
  * Improved schema annotation descriptions and titles across all definitions

## 0.1.0

### Minor Changes

* fd26544: ## Features

  ### Effect-based CLI with six commands

  Rewrote the CLI from Commander.js to `@effect/cli` with composable Effect services and typed error handling. Six commands are available:

  * `sync` - Apply config to all repos in a group (or all groups) with `--dry-run`, `--group`, `--repo`, `--no-cleanup`, and `--log-level` options
  * `list` - Show config summary (groups, repos, settings, credentials, secrets, variables, rulesets)
  * `validate` - Validate config against schema, check cross-references, and verify file paths
  * `doctor` - Deep config diagnostics with typo detection and Levenshtein-based suggestions
  * `init` - Scaffold config files in the current directory or XDG config location
  * `credentials create|list|delete` - Manage named credential profiles

  ### TOML configuration with composable resource groups

  Replaced the JSON config format with TOML. Settings, secrets, variables, and rulesets are defined as named groups and assigned to named repo groups, allowing reuse across multiple sets of repositories.

  ### XDG config resolution via xdg-effect

  Config file discovery uses the `xdg-effect` package with a three-tier resolver chain:

  1. Explicit `--config` flag (file or directory path)
  2. Walk up from `cwd` looking for `reposets.config.toml`
  3. XDG fallback at `$XDG_CONFIG_HOME/reposets/` (defaults to `~/.reposets/`)

  The `AppDirs` service from xdg-effect handles directory resolution for `init` and `credentials` commands. JSON Schema generation uses xdg-effect's `JsonSchemaExporter` service.

  ### Credential profiles with resolved templates

  Credential profiles in `reposets.credentials.toml` support multi-account workflows. Each profile holds a GitHub fine-grained token, an optional 1Password service account token, and an optional `[resolve]` section with three sub-groups:

  * `op` - 1Password `op://` references resolved via the 1Password SDK
  * `file` - file paths resolved relative to the credentials directory
  * `value` - inline strings or JSON objects

  Secret and variable groups are typed by kind (`file`, `value`, or `resolved`). Resolved groups map names to credential labels, enabling distributable configs with no secrets committed to version control.

  ### Inline rulesets with 22 GitHub rule types

  Rulesets are defined entirely in TOML using a discriminated union schema keyed on `type`:

  * `type = "branch"` enables pull request rules, merge queue, code scanning, and Copilot review
  * `type = "tag"` enables tag name pattern rules

  Ergonomic shorthands reduce boilerplate: boolean flags for common rules (`creation`, `deletion`, `required_signatures`, etc.), a `targets` shorthand for ref name conditions, `pull_requests` for flattened PR rule configuration, and `deployments` for required deployment environments.

  ### Deployment environments

  A top-level `[environments]` section defines named deployment environment configurations with `wait_timer`, `prevent_self_review`, `reviewers`, and `deployment_branches`. Groups reference environments by name, and secrets/variables can be scoped to specific environments.

  ### Per-group cleanup with preserve lists

  Cleanup configuration lives inside each `[groups.<name>.cleanup]` section. The `CleanupScope` union accepts `false` (disabled), `true` (delete all undeclared), or `{ preserve = [...] }` (delete undeclared except named resources). Scopes are nested by resource type: `secrets.actions`, `secrets.dependabot`, `secrets.codespaces`, `secrets.environments`, `variables.actions`, `variables.environments`, `rulesets`, and `environments`.

  ### Structured sync logging

  The `SyncLogger` service provides tiered output controlled by `--log-level` (silent, info, verbose, debug). In dry-run mode all verbs are prefixed with `would`. Errors are accumulated rather than aborting, with a final summary listing every failure by repo.

  ### Settings parity with GitHub API

  `SettingsGroupSchema` covers 20+ typed fields including feature toggles, merge strategy configuration, and `has_sponsorships`/`has_pull_requests` synced via GraphQL mutation. Unknown fields are passed through to the API. Org-only settings are automatically stripped for personal accounts.

  ## Documentation

  * Added user-facing documentation: README, CONTRIBUTING, and nine pages under `docs/` covering commands, configuration, credentials, secrets, variables, rulesets, environments, cleanup, and token permissions
  * Generated JSON Schema files with Tombi annotations for TOML editor autocompletion

  ## Maintenance

  * Renamed the project from `gh-sync` to `reposets`
  * Added comprehensive integration tests for all CLI commands and the xdg-effect config service layer (236 tests, 90% line coverage)
