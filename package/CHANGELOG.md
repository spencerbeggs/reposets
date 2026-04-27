# reposets

## 0.4.0

### Minor Changes

* 3b2cd87: ## Features

  ### Advanced Security configuration

  Sync GitHub Advanced Security settings, vulnerability alert toggles, and CodeQL default setup across reposets. The feature spans three distinct GitHub API surfaces, each with its own config shape.

  #### Nested `security_and_analysis` block

  Configure secret scanning, push protection, AI detection, non-provider patterns, delegated dismissal/bypass, and Dependabot security updates inside any settings group. Folded into the same `PATCH /repos/{owner}/{repo}` call already used for repository settings.

  ```toml
  [settings.oss-defaults.security_and_analysis]
  secret_scanning = "enabled"
  secret_scanning_push_protection = "enabled"
  secret_scanning_ai_detection = "enabled"
  dependabot_security_updates = "enabled"

  [[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
  team = "security-team"
  mode = "ALWAYS"
  ```

  Team slugs in `delegated_bypass_reviewers` are resolved to numeric reviewer IDs at sync time. Org-only fields are silently skipped on personal repos with a warning.

  #### Top-level `[security.*]` groups

  Toggle vulnerability alerts, automated security fixes, and private vulnerability reporting. Each maps to a dedicated `PUT`/`DELETE` endpoint and is diffed against current state — only changed values are applied.

  ```toml
  [security.oss-defaults]
  vulnerability_alerts = true
  automated_security_fixes = true
  private_vulnerability_reporting = true
  ```

  #### Top-level `[code_scanning.*]` groups

  Configure CodeQL default setup with full enum-validated state, languages, query suite, threat model, and runner. Configured languages are filtered against repository languages detected by GitHub; mismatches are warned and dropped.

  ```toml
  [code_scanning.oss-defaults]
  state = "configured"
  languages = ["javascript-typescript", "python"]
  query_suite = "extended"
  threat_model = "remote"
  ```

  Reference both new section types from any group:

  ```toml
  [groups.personal]
  repos = ["repo-a", "repo-b"]
  security = ["oss-defaults"]
  code_scanning = ["oss-defaults"]
  ```

  ### License and ownership awareness

  Schema accepts every field regardless of repository visibility or GHAS license. At sync time, reposets:

  * Detects ownership type once per group via the cached `getOwnerType` API
  * Drops org-only fields (`secret_scanning_delegated_alert_dismissal`, `secret_scanning_delegated_bypass`, `delegated_bypass_reviewers`) on personal repos with a logged warning
  * Logs warnings on `422`/`403`/`404` errors from GHAS-licensed fields without failing the run
  * Filters configured CodeQL languages to those GitHub detects in the repo and warns about the rest

  ### CLI updates

  * `list` summarises `security` and `code_scanning` group references per group
  * `validate` rejects unknown `security`/`code_scanning` references with the same error format as other refs
  * `doctor` documents the additional fine-grained token permissions required (Code scanning alerts, Dependabot alerts, Secret scanning alerts, Members:read)
  * `init` template includes commented-out advanced security examples

  ## Documentation

  * New JSON schema sections for `security_and_analysis` (nested in settings groups), `[security.*]`, and `[code_scanning.*]` with `(GHAS-licensed)` and `(org-only)` annotations on relevant fields
  * CodeQL default-setup language enum constrained to GitHub's nine accepted values; Rust support deferred until GitHub adds it

## 0.3.0

### Minor Changes

* 7d2a44a: ## Features

  * Added `makeConfigFilesLive(configFlag)` factory function that builds a declarative `xdg-effect` resolver chain from the `--config` CLI flag. When the flag points to a directory, a `StaticDir` resolver is prepended; when it points to a file, an `ExplicitPath` resolver is prepended. Both cases fall through to `UpwardWalk` and `XdgConfigResolver` as standard fallbacks. Each CLI command now calls `makeConfigFilesLive` directly rather than sharing a single global layer, so the config flag is correctly scoped per command.
  * Added `validateConfigRefs(config)` callback that validates all internal cross-references in a parsed config file. It checks that every group's `settings`, `secrets`, `variables`, `rulesets`, and `environments` references point to defined top-level sections, and that environment-scoped secret/variable groups reference defined environments. All errors are collected into a single `ConfigError` rather than failing on the first mismatch. This callback is wired in as the `validate` option on the config spec so it runs automatically on every load.
  * Exported `CONFIG_FILENAME` and `CREDENTIALS_FILENAME` constants from the public package index so consumers do not need to hard-code the canonical filenames.
  * Exported `makeConfigFilesLive` and `validateConfigRefs` from the public package index, replacing the now-removed `resolveConfigFlag` and `loadConfigWithDir` exports.

  ## Dependencies

  | Dependency   | Type       | Action  | From     | To       |
  | :----------- | :--------- | :------ | :------- | :------- |
  | `xdg-effect` | dependency | updated | `^0.3.3` | `^1.0.0` |

  ## Refactoring

  * Upgraded to `xdg-effect` v1.0.0 ergonomic API throughout. `XdgConfigLive` is now called as `XdgConfigLive.multi` with a single `configs` array, `XdgConfig` resolver references are replaced with `XdgConfigResolver`, and `ConfigError as XdgConfigError` aliasing is no longer needed.
  * All CLI commands (`sync`, `validate`, `list`, `doctor`, `init`, `credentials`) replaced `Console.log` / `Console.error` calls with `Effect.log` / `Effect.logError`. A `CliLogger` is installed at the root entrypoint that routes `Effect.log` to `console.log` and log levels at or above `Error` to `console.error`, keeping observable output identical while flowing through the structured Effect logging pipeline.
  * The `generate-json-schema.ts` build script now uses the singular `generate` / `validate` / `write` API from `xdg-effect` v1.0.0 instead of the previous multi-step pattern.

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
