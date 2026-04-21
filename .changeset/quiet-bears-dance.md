---
"repo-sync": minor
---

## Features

### Settings parity

`SettingsGroupSchema` now covers 20+ typed, annotated fields replacing the previous untyped passthrough:

- Repository visibility and feature toggles: `is_template`, `has_wiki`, `has_issues`, `has_projects`, `has_discussions`, `allow_forking`
- `has_sponsorships` and `has_pull_requests` are synced via GraphQL mutation (these fields are not available on the REST API)
- Full merge strategy configuration: `allow_merge_commit`, `allow_squash_merge`, `allow_rebase_merge`, `allow_auto_merge`, `allow_update_branch`, `delete_branch_on_merge`
- Merge commit title/message enums: `merge_commit_title`, `merge_commit_message`, `squash_merge_commit_title`, `squash_merge_commit_message`
- `web_commit_signoff_required`
- Merge commit title/message fields are automatically stripped from the API payload when their corresponding strategy is disabled

Unknown fields are still passed through to the API, so any settings not yet typed continue to work without changes.

### Ruleset ergonomic shorthands

Several shorthand fields are now available on both `BranchRulesetSchema` and `TagRulesetSchema` to reduce boilerplate for common rule patterns. All shorthands are normalized to full API format by `normalizeRuleset()` before being sent to GitHub.

**Boolean flags** — set any of these to `true` to enable the corresponding parameterless rule: `creation`, `deletion`, `non_fast_forward`, `required_linear_history`, `required_signatures`, `update`

**`targets` shorthand** — replaces manual `conditions.ref_name` construction:

```toml
# Target only the default branch
targets = "default"

# Target all branches
targets = "all"

# Custom include/exclude patterns
targets = [{ include = "refs/heads/release/*" }, { exclude = "refs/heads/skip-*" }]
```

**`deployments` shorthand** — a string array of environment names that converts to a `required_deployments` rule:

```toml
deployments = ["staging", "production"]
```

**`pull_requests` shorthand** (branch rulesets only) — flattened fields that map to a single `pull_request` rule: `approvals`, `dismiss_stale_reviews`, `code_owner_review`, `last_push_approval`, `resolve_threads`, `merge_methods`, `reviewers`

**`status_checks` shorthand** — simplified required status check configuration with `required` (array of check contexts), `update_branch`, `on_creation`, and `default_integration_id` (applied to all checks that do not specify their own)

### Discriminated ruleset union

`RulesetSchema` is now a discriminated union of `BranchRulesetSchema` and `TagRulesetSchema` keyed on the required `type` field. This replaces the previous single flat schema.

- `type = "branch"` — enables `pull_requests` shorthand, `pull_request`, `merge_queue`, `code_scanning`, `copilot_code_review`, and `branch_name_pattern` rules
- `type = "tag"` — enables `tag_name_pattern` rule; branch-only rules are not available

The `type` field is required in all ruleset definitions. Configs using the previous schema that did not include `type` must add it.

### Deployment environments

A new top-level `[environments]` section allows defining named deployment environment configurations that can be referenced from `[groups.*]`.

```toml
[environments.production]
wait_timer = 10
prevent_self_review = true

[[environments.production.reviewers]]
type = "Team"
id = 12345

deployment_branches = "protected"
```

`EnvironmentSchema` supports `wait_timer` (0–43200 minutes), `prevent_self_review`, `reviewers` (users or teams), and `deployment_branches` (`"all"`, `"protected"`, or an array of custom branch/tag name policies).

Nine new `GitHubClient` methods handle environment CRUD, environment secrets, and environment variables. The `SyncEngine` syncs environments before secrets and variables so that environment scopes are available when secrets and variables are written.

Groups reference environments by name:

```toml
[groups.my-repos]
repos = ["repo-one", "repo-two"]
environments = ["staging", "production"]
```

### Cleanup redesign

Cleanup configuration has moved from a single global block to a per-group `[groups.<name>.cleanup]` section. This allows different cleanup policies for different groups.

The `CleanupScope` type is a three-way union:

- `false` — cleanup disabled for this scope (default)
- `true` — delete all resources not declared in config
- `{ preserve = ["NAME_ONE", "NAME_TWO"] }` — delete undeclared resources except those listed

Scopes are now nested by resource type:

```toml
[groups.my-repos.cleanup]
rulesets = true
environments = false

[groups.my-repos.cleanup.secrets]
actions = true
dependabot = false
codespaces = false
environments = { preserve = ["LEGACY_SECRET"] }

[groups.my-repos.cleanup.variables]
actions = true
environments = false
```

### Expanded secret and variable scoping

`SecretScopesSchema` and `VariableScopesSchema` now support an `environments` map that assigns secret or variable groups to specific named deployment environments:

```toml
[groups.my-repos.secrets]
actions = ["deploy", "app"]

[groups.my-repos.secrets.environments]
staging = ["staging-secrets"]
production = ["prod-secrets"]

[groups.my-repos.variables.environments]
staging = ["staging-vars"]
production = ["prod-vars"]
```
