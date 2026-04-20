# Configuration

repo-sync uses TOML config files to declare your desired repository state. The main config file defines groups, settings, environments, secrets, variables, and rulesets. A separate credentials file stores tokens and resolve sections and is kept out of version control.

## Config Files

| File | Purpose |
| :--- | :------ |
| `repo-sync.config.toml` | Groups, settings, environments, secrets, variables, rulesets, cleanup |
| `repo-sync.credentials.toml` | Credential profiles with tokens and resolve sections (see [Credentials](credentials.md)) |

## Config Path Resolution

Resolution order (first match wins):

1. `--config` flag (directory or file path)
2. Walk up from current directory looking for `repo-sync.config.toml`
3. XDG fallback: `~/.config/repo-sync/repo-sync.config.toml` (respects `$XDG_CONFIG_HOME`)

File references in `file`-kind groups resolve relative to the directory containing `repo-sync.config.toml`.

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

**Security:** `web_commit_signoff_required`

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
| `cleanup` | object | no | Per-group cleanup config (see [Cleanup](cleanup.md)) |

```toml
[groups.my-projects]
repos = ["repo-one", "repo-two"]
settings = ["default"]
environments = ["staging", "production"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], environments = { production = ["api"] } }
variables = { actions = ["turbo", "bot"], environments = { staging = ["turbo"] } }
rulesets = ["branch-protection"]
```

## Editor Support

JSON schemas are generated for [Tombi](https://tombi-toml.github.io/tombi/) TOML language server support. Schema files include `x-tombi-*` annotations for inline documentation and completion.

Run `pnpm --filter repo-sync generate:json-schema` to regenerate schemas after config schema changes.

## Complete Example

```toml
owner = "spencerbeggs"
log_level = "info"

[settings.default]
has_wiki = false
has_discussions = false
delete_branch_on_merge = true

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
variables = { actions = ["turbo"], environments = { staging = ["turbo"] } }
rulesets = ["branch-protection"]
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
