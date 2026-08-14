# Environments

## Overview

Deployment environments are declared as `[environments.<name>]` tables and referenced by repository groups through the `environments` array. They sync before secrets and variables, so environment-scoped resources always have somewhere to attach to.

## Fields

- `wait_timer` (integer, 0–43200) — minutes to wait before allowing deployments
- `prevent_self_review` (boolean) — prevent whoever triggered the deployment from approving it
- `reviewers` (array) — users or teams required to approve deployments
- `deployment_branches` — which branches may deploy

## Reviewers

`reviewers` is an array of tables with `type` and `id`:

```toml
[environments.production]
reviewers = [
  { type = "User", id = 12345 },
  { type = "Team", id = 67890 }
]
```

`type` is `"User"` or `"Team"`, and `id` is the numeric GitHub ID.

**A `Team` reviewer requires an organization.** Assigning an environment with a team reviewer to a group whose profile declares `username` is rejected offline:

```bash
reposets validate
# Invalid: /path/to/reposets.config.toml
#   [my-projects] environments.production.reviewers: a Team reviewer requires an organization, but profile 'personal' is a personal account
```

To look up numeric IDs with the GitHub CLI:

```bash
gh api /users/USERNAME --jq .id
# 12345

gh api /orgs/ORG/teams/TEAM-SLUG --jq .id
# 67890
```

## Deployment branch policies

`deployment_branches` accepts three forms.

Any branch:

```toml
[environments.staging]
deployment_branches = "all"
```

Protected branches only:

```toml
[environments.staging]
deployment_branches = "protected"
```

Custom patterns, as an array of tables with `name` and an optional `type` that defaults to `"branch"`:

```toml
[environments.production]
deployment_branches = [
  { name = "main" },
  { name = "release/*", type = "branch" }
]
```

## Referencing environments

Add the environment names to a group's `environments` array:

```toml
[groups.my-projects]
repos = ["repo-one"]
credentials = "personal"
environments = ["staging", "production"]
```

## Environment-scoped secrets and variables

Once a group references an environment, secrets and variables can be scoped to it:

```toml
[groups.my-projects]
repos = ["repo-one"]
credentials = "personal"
environments = ["staging", "production"]
secrets = { actions = ["deploy"], environments = { production = ["api-keys"] } }
variables = { actions = ["turbo"], environments = { staging = ["turbo"] } }
```

See [Secrets and variables](05-secrets-and-variables.md) for how scoping works.

## Drift and cleanup

An environment removed from the config stays on the repositories it was synced to, unless cleanup is enabled for the `environments` scope in that group. See [Cleanup](08-cleanup.md).

An environment changed outside reposets is reported by [`reposets drift`](02-commands.md#drift) and overwritten on the next `sync`.

## Complete example

Two environments — staging with minimal config, production with a wait timer, a reviewer and a branch policy — referenced by one group:

```toml
[environments.staging]
wait_timer = 0

[environments.production]
wait_timer = 30
prevent_self_review = true
reviewers = [{ type = "User", id = 12345 }]
deployment_branches = [
  { name = "main" },
  { name = "release/*", type = "branch" }
]

[groups.my-projects]
repos = ["repo-one", "repo-two"]
credentials = "personal"
environments = ["staging", "production"]
secrets = { environments = { production = ["api-keys"] } }
```
