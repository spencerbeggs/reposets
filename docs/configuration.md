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

### Pass-through fields

Settings groups accept any additional fields beyond the typed ones listed above. Unknown fields are forwarded directly to the GitHub repository update API. This means new GitHub API fields work immediately without waiting for a reposets update.

Be careful with pass-through fields -- typos are silently forwarded to the API. Use `reposets doctor` to detect unknown keys.

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

reposets publishes JSON schemas for both config files to [SchemaStore](https://www.schemastore.org/). Editors that support SchemaStore (VS Code, IntelliJ, Neovim, and others) will automatically detect `reposets.config.toml` and `reposets.credentials.toml` and provide validation, completion, and inline documentation with no manual setup required.

The schemas also include annotations for two TOML-specific language servers:

- [Tombi](https://tombi-toml.github.io/tombi/) -- `x-tombi-*` annotations for key ordering, additional key labels, and array value ordering
- [Taplo](https://taplo.tamasfe.dev/) -- `x-taplo` annotations for documentation links and key scaffolding via `initKeys`

If you use Tombi or Taplo as your TOML language server, you get richer editor integration including contextual documentation links that point to the relevant section of this documentation.

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
