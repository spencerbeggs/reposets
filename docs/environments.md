# Environments

## Overview

Deployment environments are defined as `[environments.<name>]` tables in the config and referenced by repo groups via the `environments` array. Environments are synced before secrets and variables so that environment-scoped resources can be attached.

## Fields

- `wait_timer` (integer, 0–43200) — minutes to wait before allowing deployments
- `prevent_self_review` (boolean) — prevent the person who triggered the deployment from approving it
- `reviewers` (array) — list of required reviewers
- `deployment_branches` — branch policy for deployments

## Reviewers

The `reviewers` field is an array of objects with `type` and `id`:

```toml
[environments.production]
reviewers = [
  { type = "User", id = 12345 },
  { type = "Team", id = 67890 }
]
```

Types: `"User"` or `"Team"`. The `id` is the GitHub user or team numeric ID.

## Deployment Branch Policies

The `deployment_branches` field accepts three forms.

Allow deployments from any branch:

```toml
[environments.staging]
deployment_branches = "all"
```

Only protected branches:

```toml
[environments.staging]
deployment_branches = "protected"
```

Custom policies using an array of objects with `name` and an optional `type` field (defaults to `"branch"`):

```toml
[environments.production]
deployment_branches = [
  { name = "main" },
  { name = "release/*", type = "branch" }
]
```

## Referencing Environments

Add environment names to a group's `environments` array:

```toml
[groups.my-projects]
repos = ["repo-one"]
environments = ["staging", "production"]
```

## Environment-Scoped Secrets and Variables

Once an environment is referenced by a group, you can scope secrets and variables to it via the `environments` field in the secrets/variables scopes:

```toml
[groups.my-projects]
repos = ["repo-one"]
environments = ["staging", "production"]
secrets = { actions = ["deploy"], environments = { production = ["api-keys"] } }
variables = { actions = ["turbo"], environments = { staging = ["turbo"] } }
```

See [Secrets and Variables](secrets-and-variables.md) for details on scoping.

## Complete Example

Two environments (staging with minimal config, production with a wait timer, reviewers, and branch policy), referenced by a group:

```toml
[environments.staging]
wait_timer = 0

[environments.production]
wait_timer = 30
prevent_self_review = true
reviewers = [
  { type = "User", id = 12345 }
]
deployment_branches = [
  { name = "main" },
  { name = "release/*", type = "branch" }
]

[groups.my-projects]
repos = ["repo-one", "repo-two"]
environments = ["staging", "production"]
secrets = { environments = { production = ["api-keys"] } }
```
