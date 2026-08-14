# Configuration

reposets reads two TOML files. `reposets.config.toml` declares the desired state of your repositories: settings, security toggles, code scanning, environments, secrets, variables, rulesets and the groups that tie them to repositories. `reposets.credentials.toml` holds the credential profiles, and it is kept out of version control.

## Config files

| File | Purpose |
| :--- | :------ |
| `reposets.config.toml` | Groups, settings, security, code scanning, environments, secrets, variables, rulesets, cleanup |
| `reposets.credentials.toml` | Credential profiles: who each acts as, and the references it holds (see [Credentials](04-credentials.md)) |

## Config path resolution

Resolution order for `reposets.config.toml`, first match wins:

1. `--config` flag, either a file path or a directory containing the file
2. Walking up from the current directory looking for `reposets.config.toml`
3. XDG fallback: `~/.config/reposets/reposets.config.toml`, respecting `$XDG_CONFIG_HOME`

The flag replaces the upward walk rather than being prepended to it, and a `--config` naming a path that does not exist fails rather than falling through to the XDG file.

The credentials file uses its own chain: the upward walk plus the XDG tier. It does not take `--config`, so `--config` pointed at a directory elsewhere still reads credentials relative to the working directory. `reposets doctor` prints the credentials file the chain actually found.

File paths in `file`-kind secret and variable groups resolve relative to the directory containing `reposets.config.toml`, not the current working directory. If your config is at `~/.config/reposets/reposets.config.toml` and a secret references `./private/NPM_TOKEN`, the file is read from `~/.config/reposets/private/NPM_TOKEN`.

## Top-level keys

There are no top-level scalar keys. Every key at the top level of `reposets.config.toml` is a section: `settings`, `secrets`, `variables`, `rulesets`, `environments`, `security`, `code_scanning` and `groups`. All of them default to empty, so a config declaring only groups is valid.

`owner` and `log_level` were removed in 1.0 and are now rejected rather than ignored. The owner belongs to the credential profile a group names; there are no verbosity tiers. See [Migrating to 1.0](01-migrating-to-1.0.md).

## Settings groups

`[settings.<name>]` tables define repository settings to apply. Known fields are typed and organized by category.

**Repository features:** `is_template`, `has_wiki`, `has_issues`, `has_projects`, `has_discussions`, `has_sponsorships`, `has_pull_requests`

> `has_sponsorships` and `has_pull_requests` are synced via a GraphQL mutation and are not available in the REST API.

**Forking:** `allow_forking`

**Merge strategies:** `allow_merge_commit`, `allow_squash_merge`, `allow_rebase_merge`, `allow_auto_merge`, `allow_update_branch`

**Merge formatting:** `squash_merge_commit_title`, `squash_merge_commit_message`, `merge_commit_title`, `merge_commit_message`

**Branch cleanup:** `delete_branch_on_merge`

**Commit signing:** `web_commit_signoff_required`

**Advanced security:** `security_and_analysis`, a nested table (see [Security and analysis block](#security-and-analysis-block))

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

Settings groups accept fields beyond the typed ones above, and forward them to the GitHub repository update API unchanged. A setting GitHub adds tomorrow works without waiting for a reposets release.

The cost is that a typo is indistinguishable from a new field. `has_wikkis` decodes cleanly, is sent, is ignored by GitHub and is then reported as applied. `reposets doctor` warns about settings fields it does not recognize, which is the only signal available:

```bash
reposets doctor
# Warning: unrecognised setting 'has_wikkis' in settings.default — did you mean 'has_wiki'?
```

### Security and analysis block

Settings groups accept a nested `security_and_analysis` table, folded into the same `PATCH /repos/{owner}/{repo}` call as the rest of the settings. Each scalar field takes `"enabled"` or `"disabled"`.

| Field | Notes |
| :---- | :---- |
| `advanced_security` | (GHAS-licensed) Master toggle for GitHub Advanced Security features on the repository |
| `code_security` | (GHAS-licensed) Toggle GitHub Code Security functionality |
| `secret_scanning` | Detect committed credentials and sensitive data |
| `secret_scanning_push_protection` | Block git pushes containing detected secrets |
| `secret_scanning_ai_detection` | (GHAS-licensed) AI-powered detection of generic secrets |
| `secret_scanning_non_provider_patterns` | (GHAS-licensed) Detect custom non-provider patterns |
| `secret_scanning_delegated_alert_dismissal` | (org-only) Allow delegated dismissal of alerts |
| `secret_scanning_delegated_bypass` | (org-only) Allow delegated approval of push-protection bypass |
| `dependabot_security_updates` | Open pull requests to patch known dependency vulnerabilities |
| `delegated_bypass_reviewers` | (org-only) Array of `{ team, mode }` or `{ role, mode }` entries |

**(GHAS-licensed)** fields need a GitHub Advanced Security license on private repositories and are free on public ones. Applied to an unlicensed private repository, reposets logs a warning and carries on.

**(org-only)** fields need an organization. `reposets validate` rejects them offline when the group's profile declares `username`, so they no longer surface as an HTTP 422 partway through a sync.

Omitting a field means "leave it alone". There is no cleanup scope for this block.

```toml
[settings.oss-defaults.security_and_analysis]
secret_scanning = "enabled"
secret_scanning_push_protection = "enabled"
secret_scanning_ai_detection = "enabled"
dependabot_security_updates = "enabled"
```

#### Delegated bypass reviewers

`delegated_bypass_reviewers` is an array of tables, each specifying exactly one of `team` (a GitHub team slug) or `role` (an organization role name), plus an optional `mode` of `"ALWAYS"` or `"EXEMPT"`:

```toml
[[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
team = "security-team"
mode = "ALWAYS"

[[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
role = "all_repo_admin"
mode = "EXEMPT"
```

Both forms resolve to numeric reviewer IDs at sync time and are cached per organization. Role names come from `GET /orgs/{org}/organization-roles` and include the predefined `all_repo_*` family (`all_repo_admin`, `all_repo_maintain`, `all_repo_write`, `all_repo_triage`, `all_repo_read`) plus any custom roles. Role IDs are per-organization even for predefined roles, so hard-coded numeric IDs are not portable between organizations.

Resolving team slugs and role names needs the `Organization > Members (Read)` token permission.

## Security groups

`[security.<name>]` tables toggle repository security features that have dedicated `PUT`/`DELETE` endpoints, separate from the main settings call. reposets diffs each field against the current state and only writes on a difference.

| Field | Type | Description |
| :---- | :--- | :---------- |
| `vulnerability_alerts` | boolean | Enable Dependabot vulnerability alerts |
| `automated_security_fixes` | boolean | Enable Dependabot security pull requests. Requires `vulnerability_alerts = true` |
| `private_vulnerability_reporting` | boolean | Enable the private vulnerability reporting inbox |

Omitted keys are left untouched on the repository.

```toml
[security.oss-defaults]
vulnerability_alerts = true
automated_security_fixes = true
private_vulnerability_reporting = true
```

Reference these from a group via its `security` array (see [Groups](#groups)).

### Validation

The schema rejects `automated_security_fixes = true` paired with `vulnerability_alerts = false` in the same group, so `reposets validate` fails before any sync runs:

```text
automated_security_fixes = true requires vulnerability_alerts to be enabled
(or omitted to leave the existing setting in place)
```

Omitting `vulnerability_alerts` entirely is allowed. The repository may already have it on, and "leave alone" stays available.

A group referencing several `[security.*]` groups merges them last-write-wins. If the merge recreates the contradiction — one group setting `vulnerability_alerts = false` and another setting `automated_security_fixes = true` — reposets catches it at sync time, logs an error and skips the security phase for the affected repositories rather than letting GitHub answer 422.

## Code scanning groups

`[code_scanning.<name>]` tables configure CodeQL default setup, applied via `PATCH /repos/{owner}/{repo}/code-scanning/default-setup`. That endpoint returns `202 Accepted` and configures asynchronously; reposets sends the request and does not poll for completion.

| Field | Type | Description |
| :---- | :--- | :---------- |
| `state` | `"configured"` \| `"not-configured"` | Enable or disable default setup |
| `languages` | array | Which default-setup languages to analyze |
| `query_suite` | `"default"` \| `"extended"` | Standard query set, or extended security queries |
| `threat_model` | `"remote"` \| `"remote_and_local"` | Network sources only, or filesystem and environment access too |
| `runner_type` | `"standard"` \| `"labeled"` | GitHub-hosted runners, or self-hosted runners by label |
| `runner_label` | string | Self-hosted runner label. Required when `runner_type = "labeled"` |

`languages` accepts a subset of GitHub's nine default-setup languages: `actions`, `c-cpp`, `csharp`, `go`, `java-kotlin`, `javascript-typescript`, `python`, `ruby` and `swift`. This list is narrower than the CodeQL analyzer itself, which supports Rust and others that default setup does not.

At sync time, configured languages are filtered against the languages GitHub detects in the repository. Undetected languages are dropped with a warning and the rest are applied, so an unusable language never fails the run.

`actions` is filtered differently, because it is not a repository language. It is checked against a count of workflow files under `.github/workflows/`, which is why the token needs `Repository > Actions (Read)`.

```toml
[code_scanning.oss-defaults]
state = "configured"
languages = ["javascript-typescript", "python"]
query_suite = "extended"
threat_model = "remote"
```

The schema rejects `runner_type = "labeled"` without a `runner_label`:

```text
runner_label is required when runner_type = "labeled"
```

Reference these from a group via its `code_scanning` array (see [Groups](#groups)).

## Groups

`[groups.<name>]` tables tie repositories to resources. Each group lists repositories, names the credential profile it is synced as, and references the sections that should be applied to them.

| Field | Type | Required | Description |
| :---- | :--- | :------- | :---------- |
| `repos` | string[] | yes | Repository names, without the owner prefix |
| `credentials` | string | yes | Credential profile name. Supplies both the token and the owner |
| `settings` | string[] | no | Settings group names to apply |
| `environments` | string[] | no | Environment names to sync |
| `secrets` | SecretScopes | no | Secret assignments by scope (see [Secrets and variables](05-secrets-and-variables.md)) |
| `variables` | VariableScopes | no | Variable assignments by scope (see [Secrets and variables](05-secrets-and-variables.md)) |
| `rulesets` | string[] | no | Ruleset names to apply |
| `security` | string[] | no | Security group names to apply (see [Security groups](#security-groups)) |
| `code_scanning` | string[] | no | Code scanning group names to apply (see [Code scanning groups](#code-scanning-groups)) |
| `cleanup` | table | no | Per-group cleanup policy (see [Cleanup](08-cleanup.md)) |

```toml
[groups.my-projects]
repos = ["repo-one", "repo-two"]
credentials = "personal"
settings = ["default"]
environments = ["staging", "production"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], environments = { production = ["api"] } }
variables = { actions = ["turbo", "bot"], environments = { staging = ["turbo"] } }
rulesets = ["branch-protection"]
security = ["oss-defaults"]
code_scanning = ["oss-defaults"]
```

There is no `owner` field. The repositories in a group belong to whatever account the named profile declares, and a group cannot override it. To sync repositories under a different account, add a second profile and a second group.

### The credentials field

`credentials` is required on every group, including in a config with a single profile. It selects the profile's GitHub token as well as its `[resolve]` values, which is what lets one config span several accounts: groups are partitioned by profile and each partition runs under its own identity, still as one run in `reposets history`.

A group naming a profile that does not exist is an error rather than an empty credential set, because the latter syncs the group with every resolved secret missing and reads in the output as "nothing to do".

### Reference integrity

Every reference array points into the matching top-level table, and a reference that resolves to nothing is reported by `reposets validate` with the names that do exist:

```bash
reposets validate
# Invalid: /path/to/reposets.config.toml
#   groups.my-repos.settings: 'defualt' does not exist — defined: default
```

Both halves of an environment-scoped assignment are checked independently: the environment name keying the record and the group names inside it. `sync` runs the same check and refuses to write anything when it fails.

A reference is checked where it is used, not where a section is defined. An unreferenced `[settings.*]` section is dead config rather than an error.

## Editor support

reposets publishes JSON schemas for both config files to [SchemaStore](https://www.schemastore.org/). Editors that support SchemaStore, including VS Code, IntelliJ and Neovim, detect `reposets.config.toml` and `reposets.credentials.toml` and provide validation, completion and inline documentation with no setup.

The schemas also carry annotations for two TOML language servers:

- [Tombi](https://tombi-toml.github.io/tombi/) reads `x-tombi-*` annotations for key ordering, additional key labels and array value ordering.
- [Taplo](https://taplo.tamasfe.dev/) reads `x-taplo` annotations for documentation links and key scaffolding.

Field descriptions carry the same `(GHAS-licensed)` and `(org-only)` markers used here, so editors that show schema descriptions on hover surface the licensing and ownership requirements as you type.

## Complete example

```toml
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
reviewers = [{ type = "User", id = 12345 }]

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

[rulesets.branch-protection.pull_requests]
approvals = 1
dismiss_stale_reviews = false

[rulesets.branch-protection.status_checks]
update_branch = true
default_integration_id = { resolved = "MY_APP_ID" }

[[rulesets.branch-protection.status_checks.required]]
context = "CI"

[groups.my-projects]
repos = ["repo-one", "repo-two"]
credentials = "personal"
settings = ["default"]
environments = ["staging", "production"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], environments = { production = ["api"] } }
variables = { actions = ["turbo", "bot"], environments = { staging = ["turbo"] } }
rulesets = ["branch-protection"]
security = ["oss-defaults"]
code_scanning = ["oss-defaults"]

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

The matching credentials file:

```toml
[profiles.personal]
username = "your-username"
github_token = { op = "op://Private/github/token" }

[profiles.personal.resolve.op]
MY_API_KEY = "op://Private/api/key"
MY_APP_ID = "op://Private/github-app/app-id"
```
