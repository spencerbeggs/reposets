# Rulesets

## Overview

Rulesets are defined as `[rulesets.<name>]` tables in the config. Each is a discriminated union by `type` field: `branch` or `tag`. repo-sync creates or updates rulesets by matching on name.

## Required Fields

- `name` (string) — ruleset name as it appears in GitHub
- `type` (`"branch"` or `"tag"`) — determines which rules are available
- `enforcement` (`"active"`, `"evaluate"`, or `"disabled"`)

## Targets

The `targets` shorthand field sets which branches or tags the ruleset applies to:

- `"default"` — the default branch only
- `"all"` — all branches/tags
- Array of `{ include }` / `{ exclude }` patterns for custom targeting

```toml
# Default branch only
targets = "default"

# Custom targeting
targets = [{ include = "refs/heads/main" }, { exclude = "refs/heads/feature/*" }]
```

## Boolean Rule Shorthands

These flags enable parameterless rules when set to `true`:

- `creation` — restrict branch/tag creation
- `update` — restrict branch/tag updates
- `deletion` — restrict branch/tag deletion
- `required_linear_history` — require linear history
- `required_signatures` — require signed commits
- `non_fast_forward` — prevent force pushes

```toml
[rulesets.protect]
name = "protect"
type = "branch"
enforcement = "active"
targets = "default"
non_fast_forward = true
deletion = true
```

## Pull Request Shorthand

Branch rulesets only. The `pull_requests` table is a shorthand for the `pull_request` rule:

```toml
[rulesets.protect]
# ...
pull_requests = {
  approvals = 1,
  dismiss_stale_reviews = false,
  code_owner_review = false,
  last_push_approval = false,
  resolve_threads = false,
  merge_methods = ["squash", "merge"]
}
```

Available fields:

- `approvals` (integer) — number of required approving reviews
- `dismiss_stale_reviews` (boolean) — dismiss approvals when new commits are pushed
- `code_owner_review` (boolean) — require review from code owners
- `last_push_approval` (boolean) — require approval of the most recent push
- `resolve_threads` (boolean) — require all conversation threads to be resolved
- `merge_methods` (array of strings) — allowed merge methods (e.g. `["squash", "merge"]`)

## Status Checks Shorthand

The `status_checks` table is a shorthand for `required_status_checks`:

```toml
[rulesets.protect]
# ...
status_checks = {
  update_branch = true,
  on_creation = false,
  default_integration_id = 12345,
  required = [
    { context = "CI" },
    { context = "lint" }
  ]
}
```

`default_integration_id` is applied to required checks that omit their own `integration_id`.

## Deployments Shorthand

Array of environment names for the `required_deployments` rule:

```toml
deployments = ["staging"]
```

## Resolved References

Integer fields in rulesets accept `{ resolved = "LABEL" }` for runtime substitution. The label references a named value defined in the active credential profile's `[resolve]` section. At sync time, repo-sync looks up the label, retrieves the value, and coerces it to an integer for the GitHub API.

Fields that support resolved references: `actor_id`, `integration_id`, `repository_id`, `default_integration_id`.

This is useful for values like GitHub App installation IDs that differ per environment or should not be hardcoded in the config.

**As a status check integration ID:**

```toml
[rulesets.workflow]
# ...
status_checks = {
  default_integration_id = { resolved = "MY_APP_ID" },
  required = [
    { context = "CI" },
    { context = "DCO Check", integration_id = 15368 }
  ]
}
```

Checks that omit their own `integration_id` inherit the `default_integration_id`. Checks that specify a static integer (like `DCO Check` above) keep their own value.

**As a bypass actor ID:**

```toml
[rulesets.release]
# ...
bypass_actors = [
  {
    actor_id = { resolved = "MY_APP_ID" },
    actor_type = "Integration",
    bypass_mode = "always"
  }
]
```

You can mix static integers and resolved references in the same ruleset. See [Credentials](credentials.md) for how to define resolved labels.

## Rule Types

| Rule Type | Branch | Tag |
| :--- | :---: | :---: |
| creation | yes | yes |
| update | yes | yes |
| deletion | yes | yes |
| required_linear_history | yes | yes |
| required_signatures | yes | yes |
| non_fast_forward | yes | yes |
| pull_request | yes | no |
| required_status_checks | yes | yes |
| required_deployments | yes | yes |
| merge_queue | yes | no |
| commit_message_pattern | yes | yes |
| commit_author_email_pattern | yes | yes |
| committer_email_pattern | yes | yes |
| branch_name_pattern | yes | no |
| tag_name_pattern | yes | yes |
| file_path_restriction | yes | yes |
| file_extension_restriction | yes | yes |
| max_file_path_length | yes | yes |
| max_file_size | yes | yes |
| workflows | yes | no |
| code_scanning | yes | no |
| copilot_code_review | yes | no |

## Complete Example

Full branch ruleset with targets, boolean flags, pull_requests, and status_checks:

```toml
[rulesets.branch-protection]
name = "branch-protection"
type = "branch"
enforcement = "active"
targets = "default"
non_fast_forward = true
deletion = true
required_linear_history = true
bypass_actors = [
  { actor_id = 5, actor_type = "RepositoryRole", bypass_mode = "always" }
]
pull_requests = {
  approvals = 1,
  dismiss_stale_reviews = true,
  code_owner_review = false,
  last_push_approval = false
}
status_checks = {
  update_branch = true,
  default_integration_id = { resolved = "CI_APP_ID" },
  required = [
    { context = "CI" },
    { context = "lint" }
  ]
}
```
