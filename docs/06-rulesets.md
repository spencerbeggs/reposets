# Rulesets

## Overview

Rulesets are declared as `[rulesets.<name>]` tables and referenced by repository groups through the `rulesets` array. Each is a discriminated union on `type`: `branch` or `tag`, which decides which fields are available.

The table key and the ruleset's `name` are separate. reposets matches an existing ruleset on GitHub by its `name` field, so the table key is free to be more specific than the name you see in the GitHub UI:

```toml
[rulesets.branch-protection-v2]
name = "branch-protection"
```

## Required fields

- `name` (string) — the ruleset name as it appears in GitHub, and the key reposets matches on
- `type` (`"branch"` or `"tag"`) — decides which fields are available
- `enforcement` (`"active"`, `"evaluate"` or `"disabled"`)

`"active"` enforces the rules and `"disabled"` turns the ruleset off while leaving it in place. `"evaluate"` is test mode, where GitHub records what would have been blocked without blocking it — it requires GitHub Enterprise.

## Targets

`targets` sets which refs the ruleset applies to. It takes a preset or a list of patterns:

- `"default"` — the default branch only
- `"all"` — every branch or tag
- an array of `{ include }` and `{ exclude }` patterns

```toml
# Default branch only
targets = "default"

# Custom targeting
targets = [{ include = "refs/heads/main" }, { exclude = "refs/heads/feature/*" }]
```

Patterns accept `~DEFAULT_BRANCH`, `~ALL` and globs. `targets` is shorthand for the underlying `conditions.ref_name` block, which can also be written out in full.

## Field reference

Available on both branch and tag rulesets:

| Field | Type | Description |
| :---- | :--- | :---------- |
| `name` | string | Ruleset name in GitHub |
| `enforcement` | enum | `active`, `evaluate` or `disabled` |
| `targets` | preset or array | Which refs the ruleset applies to |
| `conditions` | table | Full `ref_name` form of `targets` |
| `bypass_actors` | array | Who may bypass the rules |
| `creation` | boolean | Restrict ref creation |
| `update` | boolean | Restrict ref updates |
| `deletion` | boolean | Restrict ref deletion |
| `required_linear_history` | boolean | Require linear history |
| `required_signatures` | boolean | Require signed commits |
| `non_fast_forward` | boolean | Prevent force pushes |
| `deployments` | string[] | Environment names that must have deployed |
| `status_checks` | table | Required status checks |
| `commit_message` | array | Commit message pattern rules |
| `commit_author_email` | array | Commit author email pattern rules |
| `committer_email` | array | Committer email pattern rules |

Branch rulesets add:

| Field | Type | Description |
| :---- | :--- | :---------- |
| `pull_requests` | table | Pull request review requirements |
| `merge_queue` | table | Merge queue configuration |
| `copilot_review` | table | Copilot code review configuration |
| `code_scanning` | array | Code scanning tool thresholds |
| `workflows` | table | Required workflows |
| `branch_name` | array | Branch name pattern rules |

Tag rulesets add:

| Field | Type | Description |
| :---- | :--- | :---------- |
| `tag_name` | array | Tag name pattern rules |

## Boolean rules

These enable a parameterless rule when set to `true`:

```toml
[rulesets.protect]
name = "protect"
type = "branch"
enforcement = "active"
targets = "default"
non_fast_forward = true
deletion = true
required_linear_history = true
required_signatures = true
```

## Bypass actors

`bypass_actors` lists who may bypass the ruleset. Each entry takes an `actor_type`, an optional `actor_id` and a `bypass_mode` that defaults to `"always"`.

| Field | Values |
| :---- | :----- |
| `actor_type` | `Integration`, `OrganizationAdmin`, `RepositoryRole`, `Team`, `DeployKey` |
| `actor_id` | integer, or `{ resolved = "LABEL" }` |
| `bypass_mode` | `always`, `pull_request`, `exempt` |

```toml
bypass_actors = [
  { actor_id = 5, actor_type = "RepositoryRole", bypass_mode = "always" },
  { actor_id = { resolved = "MY_APP_ID" }, actor_type = "Integration", bypass_mode = "always" }
]
```

**A `Team` actor requires an organization.** Assigning a ruleset with one to a group whose profile declares `username` is rejected offline:

```bash
reposets validate
# Invalid: /path/to/reposets.config.toml
#   [my-projects] rulesets.protect.bypass_actors: a Team bypass actor requires an organization, but profile 'personal' is a personal account
```

## Pull requests

Branch rulesets only. Every field has a default, so a bare `pull_requests` table means "require a pull request with no approvals".

| Field | Type | Default | Description |
| :---- | :--- | :------ | :---------- |
| `approvals` | integer 0–10 | `0` | Required approving reviews |
| `dismiss_stale_reviews` | boolean | `false` | Dismiss approvals when new commits are pushed |
| `code_owner_review` | boolean | `false` | Require review from code owners |
| `last_push_approval` | boolean | `false` | Require the most recent push to be approved by someone else |
| `resolve_threads` | boolean | `false` | Require all review conversations resolved |
| `merge_methods` | array | (all) | Allowed methods: `merge`, `squash`, `rebase` |
| `reviewers` | array | (none) | Teams that must approve specific file patterns |

```toml
[rulesets.protect.pull_requests]
approvals = 1
dismiss_stale_reviews = true
resolve_threads = true
merge_methods = ["squash", "rebase"]
```

Each `reviewers` entry takes `file_patterns` (fnmatch syntax), `minimum_approvals` and a `reviewer` of `{ id, type = "Team" }`.

## Status checks

| Field | Type | Description |
| :---- | :--- | :---------- |
| `required` | array | Checks that must pass. Each has a `context` and an optional `integration_id` |
| `update_branch` | boolean | Pull requests must be tested against the latest base |
| `on_creation` | boolean | When `false`, branch creation is allowed even if checks would block it |
| `default_integration_id` | integer or resolved | Applied to required checks that omit their own |

```toml
[rulesets.protect.status_checks]
update_branch = true
on_creation = false
default_integration_id = 12345

[[rulesets.protect.status_checks.required]]
context = "CI"

[[rulesets.protect.status_checks.required]]
context = "DCO Check"
integration_id = 15368
```

A check that specifies its own `integration_id` keeps it; the rest inherit `default_integration_id`.

## Pattern rules

`commit_message`, `commit_author_email`, `committer_email`, `branch_name` and `tag_name` all take an array of pattern entries:

| Field | Type | Description |
| :---- | :--- | :---------- |
| `operator` | enum | `starts_with`, `ends_with`, `contains` or `regex` |
| `pattern` | string | The pattern to match |
| `name` | string | Optional display name for the rule |
| `negate` | boolean | When `true`, the rule fails on a match |

```toml
[[rulesets.protect.commit_message]]
operator = "regex"
pattern = "^(feat|fix|chore)(\\(.+\\))?: .+"
name = "Conventional commits"
```

## Deployments

An array of environment names, which becomes the required-deployments rule:

```toml
deployments = ["staging"]
```

## Merge queue

Branch rulesets only. Every field is required when the table is present.

| Field | Type | Description |
| :---- | :--- | :---------- |
| `check_timeout` | integer 1–360 | Minutes allowed for status checks to report |
| `grouping` | `ALLGREEN` \| `HEADGREEN` | Whether all commits or only the head must pass |
| `max_build` | integer 0–100 | Queued pull requests requesting checks at once |
| `max_merge` | integer 0–100 | Pull requests merged together in a group |
| `min_merge` | integer 0–100 | Minimum group size to merge |
| `min_wait` | integer 0–360 | Minutes to wait for the minimum group size |
| `merge_method` | `MERGE` \| `SQUASH` \| `REBASE` | Method for queued pull requests |

## Workflows

Branch rulesets only. `required` lists workflow files that must pass; `on_creation` set to `false` skips enforcement when a branch is created.

```toml
[rulesets.protect.workflows]
on_creation = false

[[rulesets.protect.workflows.required]]
path = ".github/workflows/ci.yml"
repository_id = 123456
ref = "main"
```

`repository_id` accepts `{ resolved = "LABEL" }`. `sha` is also available to pin an exact commit.

## Code scanning

Branch rulesets only. Each entry names a tool and the severities at which it blocks:

```toml
[[rulesets.protect.code_scanning]]
tool = "CodeQL"
alerts = "errors"
security_alerts = "high_or_higher"
```

`alerts` takes `none`, `errors`, `errors_and_warnings` or `all`. `security_alerts` takes `none`, `critical`, `high_or_higher`, `medium_or_higher` or `all`.

## Copilot review

Branch rulesets only:

```toml
[rulesets.protect.copilot_review]
draft_prs = false
on_push = true
```

## Resolved references

Integer fields accept `{ resolved = "LABEL" }`, where the label is declared in the `[resolve]` section of the profile the group names. At sync time the value is looked up and coerced to an integer.

The fields that support it are `actor_id`, `integration_id`, `default_integration_id` and `repository_id`. This suits values like GitHub App IDs, which differ per installation and should not be committed.

```toml
[rulesets.workflow.status_checks]
default_integration_id = { resolved = "MY_APP_ID" }

[[rulesets.workflow.status_checks.required]]
context = "CI"
```

Static integers and resolved references can be mixed in the same ruleset. See [Credentials](04-credentials.md) for how labels are declared.

### Finding numeric IDs

```bash
gh api /users/USERNAME --jq .id
# 12345

gh api /orgs/ORG/teams/TEAM-SLUG --jq .id
# 67890

gh api /apps/APP-SLUG --jq .id
# 15368
```

## Tag ruleset example

Tag rulesets use `type = "tag"` and support the shared fields plus `tag_name`. They have no `pull_requests`, `merge_queue`, `workflows`, `code_scanning`, `copilot_review` or `branch_name`.

```toml
[rulesets.release-tags]
name = "release-tags"
type = "tag"
enforcement = "active"
targets = [{ include = "refs/tags/v*" }]
deletion = true
non_fast_forward = true
```

## Complete example

```toml
[rulesets.branch-protection]
name = "branch-protection"
type = "branch"
enforcement = "active"
targets = "default"
non_fast_forward = true
deletion = true
required_linear_history = true
bypass_actors = [{ actor_id = 5, actor_type = "RepositoryRole", bypass_mode = "always" }]

[rulesets.branch-protection.pull_requests]
approvals = 1
dismiss_stale_reviews = true
merge_methods = ["squash", "rebase"]

[rulesets.branch-protection.status_checks]
update_branch = true
default_integration_id = { resolved = "CI_APP_ID" }

[[rulesets.branch-protection.status_checks.required]]
context = "CI"

[[rulesets.branch-protection.status_checks.required]]
context = "lint"

[groups.my-projects]
repos = ["repo-one"]
credentials = "personal"
rulesets = ["branch-protection"]
```

## Cleanup

A ruleset removed from the config stays on the repository unless cleanup is enabled for the `rulesets` scope. An organization's inherited rulesets are never deleted, whatever the scope says. See [Cleanup](08-cleanup.md).
