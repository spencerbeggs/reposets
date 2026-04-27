# Configuration

reposets uses TOML config files to declare your desired repository state. The main config file defines groups, settings, environments, secrets, variables, and rulesets. A separate credentials file stores tokens and resolve sections and is kept out of version control.

## Config Files

| File | Purpose |
| :--- | :------ |
| `reposets.config.toml` | Groups, settings, environments, secrets, variables, rulesets, cleanup |
| `reposets.credentials.toml` | Credential profiles with tokens and resolve sections (see [Credentials](credentials.md)) |

## Config Path Resolution

Resolution order (first match wins):

1. `--config` flag (directory or file path)
2. Walk up from current directory looking for `reposets.config.toml`
3. XDG fallback: `~/.config/reposets/reposets.config.toml` (respects `$XDG_CONFIG_HOME`)

File paths in `file`-kind secret and variable groups resolve relative to the directory containing `reposets.config.toml`, not the current working directory. For example, if your config is at `~/.config/reposets/reposets.config.toml` and a secret references `./private/NPM_TOKEN`, the file is read from `~/.config/reposets/private/NPM_TOKEN`.

## Top-Level Keys

- `owner` (string) - default GitHub username for all groups. Can be overridden per group.
- `log_level` (string) - `silent`, `info`, `verbose`, or `debug`. Default: `info`. Overridden by the `--log-level` CLI flag.

## Settings Groups

`[settings.<name>]` tables define repository settings to apply. Known fields are organized by category:

**Repository features:** `is_template`, `has_wiki`, `has_issues`, `has_projects`, `has_discussions`, `has_sponsorships`, `has_pull_requests`

> Note: `has_sponsorships` and `has_pull_requests` are synced via GraphQL mutation and are not available in the REST API.

**Forking:** `allow_forking`

**Merge strategies:** `allow_merge_commit`, `allow_squash_merge`, `allow_rebase_merge`, `allow_auto_merge`, `allow_update_branch`

**Merge formatting:** `squash_merge_commit_title`, `squash_merge_commit_message`, `merge_commit_title`, `merge_commit_message`

**Cleanup:** `delete_branch_on_merge`

**Commit signing:** `web_commit_signoff_required`

**Advanced security (nested):** `security_and_analysis` (see [Security and Analysis](#security-and-analysis-nested-block) below)

Unknown fields are forwarded to the GitHub API as pass-through, so new GitHub settings can be used before the schema is updated.

```toml
[settings.default]
has_wiki = false
has_discussions = false
delete_branch_on_merge = true
allow_squash_merge = true
allow_merge_commit = false
allow_rebase_merge = false
```

### Pass-through fields

Settings groups accept any additional fields beyond the typed ones listed above. Unknown fields are forwarded directly to the GitHub repository update API. This means new GitHub API fields work immediately without waiting for a reposets update.

Be careful with pass-through fields -- typos are silently forwarded to the API. Use `reposets doctor` to detect unknown keys.

### Security and Analysis (nested block)

Settings groups accept a nested `security_and_analysis` block that is folded into the same `PATCH /repos/{owner}/{repo}` call as the rest of the settings. Each scalar field accepts `"enabled"` or `"disabled"`.

| Field | Notes |
| :---- | :---- |
| `advanced_security` | (GHAS-licensed) Master toggle for GitHub Advanced Security features on the repository. |
| `code_security` | (GHAS-licensed) Toggle GitHub Code Security functionality. |
| `secret_scanning` | Detect committed credentials and sensitive data. |
| `secret_scanning_push_protection` | Block git pushes containing detected secrets. |
| `secret_scanning_ai_detection` | (GHAS-licensed) AI-powered detection of generic secrets. |
| `secret_scanning_non_provider_patterns` | (GHAS-licensed) Detect custom non-provider patterns. |
| `secret_scanning_delegated_alert_dismissal` | (org-only) Allow delegated dismissal of alerts. |
| `secret_scanning_delegated_bypass` | (org-only) Allow delegated approval of push-protection bypass. |
| `dependabot_security_updates` | Open PRs to patch known dependency vulnerabilities. |
| `delegated_bypass_reviewers` | (org-only) Array of `{ team, mode }` or `{ role, mode }` entries (see below). |

Annotations:

- **(GHAS-licensed)** -- requires a GitHub Advanced Security license on private repos. Free on public repos. If applied to a private repo without a license, reposets logs a warning and continues; the run does not fail.
- **(org-only)** -- silently skipped on personal accounts with a logged warning. Owner type is detected once per group via the GitHub API.

```toml
[settings.oss-defaults.security_and_analysis]
secret_scanning = "enabled"
secret_scanning_push_protection = "enabled"
secret_scanning_ai_detection = "enabled"
dependabot_security_updates = "enabled"
```

#### Delegated bypass reviewers

`delegated_bypass_reviewers` is an array of objects, each specifying exactly one of `team` (a GitHub team slug) or `role` (an organization role name from `GET /orgs/{org}/organization-roles`, e.g. `"all_repo_admin"`, `"all_repo_maintain"`, or a custom role like `"security_manager"`), plus an optional `mode` (`"ALWAYS"` or `"EXEMPT"`):

```toml
[[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
team = "security-team"
mode = "ALWAYS"

[[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
role = "all_repo_admin"
mode = "EXEMPT"
```

Both team slugs and role names are resolved to numeric reviewer IDs at sync time using the GitHub API and cached per `org:slug` and `org:name`. The exact role names available to your org are visible at `GET /orgs/{org}/organization-roles`; they include the predefined `all_repo_*` family (`all_repo_admin`, `all_repo_maintain`, `all_repo_write`, `all_repo_triage`, `all_repo_read`) plus any custom organization roles defined for the org. Note that role IDs are per-org even for predefined roles, so a config that works against one org cannot reuse hard-coded numeric IDs against another. Resolving teams and roles requires the `Organization > Members (Read)` token permission.

## Security Groups

`[security.<name>]` tables toggle repository-level security features that have dedicated `PUT`/`DELETE` endpoints, separate from the main repo settings call. reposets diffs each field against the current state and only applies changes.

| Field | Type | Description |
| :---- | :--- | :---------- |
| `vulnerability_alerts` | boolean | Enable Dependabot vulnerability alerts. |
| `automated_security_fixes` | boolean | Enable Dependabot security pull requests. Requires `vulnerability_alerts = true`. |
| `private_vulnerability_reporting` | boolean | Enable the private vulnerability reporting inbox. |

Omitted keys are left untouched on the repo.

```toml
[security.oss-defaults]
vulnerability_alerts = true
automated_security_fixes = true
private_vulnerability_reporting = true
```

Reference security groups from a repo group via the `security` array (see [Groups](#groups)).

### Validation

The schema rejects `automated_security_fixes = true` paired with `vulnerability_alerts = false` in the same group at config-load time (so `reposets validate` fails before any sync runs):

```text
automated_security_fixes = true requires vulnerability_alerts to be enabled
(or omitted to leave the existing setting in place)
```

Omitting `vulnerability_alerts` entirely is permitted -- the existing repo state may already satisfy the requirement, and the "leave alone" semantic is preserved.

When a repo references multiple `[security.*]` groups, reposets merges them with last-write-wins semantics. If the merge produces the same contradiction (for example, one group sets `vulnerability_alerts = false` and another sets `automated_security_fixes = true`), reposets detects this at sync time, logs an error, and skips the security stage for the affected repos rather than failing at the GitHub API. Restructure your security groups so the contradiction cannot arise on merge.

## Code Scanning Groups

`[code_scanning.<name>]` tables configure CodeQL default setup. The settings are applied via `PATCH /repos/{owner}/{repo}/code-scanning/default-setup`. The endpoint returns `202 Accepted` and configures asynchronously; reposets sends the request and does not poll for completion.

| Field | Type | Description |
| :---- | :--- | :---------- |
| `state` | `"configured"` \| `"not-configured"` | Enable or disable default setup. |
| `languages` | array | Subset of CodeQL default-setup languages to analyze (see below). |
| `query_suite` | `"default"` \| `"extended"` | Standard query set or extended security queries. |
| `threat_model` | `"remote"` \| `"remote_and_local"` | Network sources only, or include filesystem and environment access. |
| `runner_type` | `"standard"` \| `"labeled"` | GitHub-hosted runners or self-hosted runners by label. |
| `runner_label` | string | Self-hosted runner label. Required when `runner_type = "labeled"`. |

The `languages` array accepts a subset of GitHub's nine default-setup languages: `actions`, `c-cpp`, `csharp`, `go`, `java-kotlin`, `javascript-typescript`, `python`, `ruby`, `swift`. (Note: this is narrower than the CodeQL analyzer itself -- Rust is supported by CodeQL but not yet by default setup.)

At sync time, reposets filters configured languages against the languages GitHub detects in the repository. Languages not detected are dropped with a warning; the rest are applied without failing the run.

```toml
[code_scanning.oss-defaults]
state = "configured"
languages = ["javascript-typescript", "python"]
query_suite = "extended"
threat_model = "remote"
```

The schema rejects `runner_type = "labeled"` without a corresponding `runner_label` at config-load time:

```text
runner_label is required when runner_type = "labeled"
```

Reference code scanning groups from a repo group via the `code_scanning` array (see [Groups](#groups)).

## Groups

`[groups.<name>]` tables tie repositories to resources. Each group maps a list of repos to the settings, environments, secrets, variables, and rulesets that should be applied to them.

| Field | Type | Required | Description |
| :---- | :--- | :------- | :---------- |
| `repos` | string[] | yes | Repository names (without owner prefix) |
| `owner` | string | no | Overrides the top-level `owner` for this group |
| `credentials` | string | no | Credential profile name; defaults to the sole profile if only one exists |
| `settings` | string[] | no | Settings group names to apply |
| `environments` | string[] | no | Environment names to sync |
| `secrets` | SecretScopes | no | Secret assignments by scope (see [Secrets and Variables](secrets-and-variables.md)) |
| `variables` | VariableScopes | no | Variable assignments by scope (see [Secrets and Variables](secrets-and-variables.md)) |
| `rulesets` | string[] | no | Ruleset names to apply |
| `security` | string[] | no | Security group names to apply (see [Security Groups](#security-groups)) |
| `code_scanning` | string[] | no | Code scanning group names to apply (see [Code Scanning Groups](#code-scanning-groups)) |
| `cleanup` | object | no | Per-group cleanup config (see [Cleanup](cleanup.md)) |

```toml
[groups.my-projects]
repos = ["repo-one", "repo-two"]
settings = ["default"]
environments = ["staging", "production"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], environments = { production = ["api"] } }
variables = { actions = ["turbo", "bot"], environments = { staging = ["turbo"] } }
rulesets = ["branch-protection"]
security = ["oss-defaults"]
code_scanning = ["oss-defaults"]
```

## Editor Support

reposets publishes JSON schemas for both config files to [SchemaStore](https://www.schemastore.org/). Editors that support SchemaStore (VS Code, IntelliJ, Neovim, and others) will automatically detect `reposets.config.toml` and `reposets.credentials.toml` and provide validation, completion, and inline documentation with no manual setup required.

The schemas also include annotations for two TOML-specific language servers:

- [Tombi](https://tombi-toml.github.io/tombi/) -- `x-tombi-*` annotations for key ordering, additional key labels, and array value ordering
- [Taplo](https://taplo.tamasfe.dev/) -- `x-taplo` annotations for documentation links and key scaffolding via `initKeys`

If you use Tombi or Taplo as your TOML language server, you get richer editor integration including contextual documentation links that point to the relevant section of this documentation.

Field-level descriptions in the schema include the same `(GHAS-licensed)` and `(org-only)` annotations used in this documentation, so editors that surface schema descriptions on hover (VS Code, IntelliJ, Neovim with a TOML LSP) show the licensing and ownership requirements for each field as you write the config.

## Complete Example

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

[security.oss-defaults]
vulnerability_alerts = true
automated_security_fixes = true
private_vulnerability_reporting = true

[code_scanning.oss-defaults]
state = "configured"
languages = ["javascript-typescript"]
query_suite = "default"

[environments.staging]
wait_timer = 0

[environments.production]
wait_timer = 30
prevent_self_review = true
reviewers = [
  { type = "User", id = 12345 }
]

[secrets.deploy.file]
NPM_TOKEN = "./private/NPM_TOKEN"

[secrets.api.resolved]
API_KEY = "MY_API_KEY"

[variables.turbo.value]
NODE_ENV = "production"
DO_NOT_TRACK = "1"

[variables.bot.value]
BOT_NAME = "mybot[bot]"

[rulesets.branch-protection]
name = "branch-protection"
type = "branch"
enforcement = "active"
targets = "default"
non_fast_forward = true
pull_requests = {
  approvals = 1,
  dismiss_stale_reviews = false
}
status_checks = {
  update_branch = true,
  default_integration_id = { resolved = "MY_APP_ID" },
  required = [
    { context = "CI" }
  ]
}

[groups.my-projects]
repos = ["repo-one", "repo-two"]
settings = ["default"]
environments = ["staging", "production"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], environments = { production = ["api"] } }
variables = { actions = ["turbo", "bot"], environments = { staging = ["turbo"] } }
rulesets = ["branch-protection"]
security = ["oss-defaults"]
code_scanning = ["oss-defaults"]
cleanup = {
  rulesets = true,
  environments = true,
  secrets = {
    actions = true,
    dependabot = { preserve = ["LEGACY_TOKEN"] },
    environments = true
  },
  variables = {
    actions = true,
    environments = true
  }
}
```
