# Cleanup

## Overview

Cleanup deletes resources that exist on a repository but are not declared in your config. It runs last in the sync, so nothing written earlier in the same run is ever deleted. It is configured per group, and every scope defaults to disabled.

## Cleanup scopes

Each scope takes one of three values:

- `false` — disabled. This is the default, and what an omitted scope means.
- `true` — delete every undeclared resource in this scope.
- `{ preserve = ["NAME_ONE", "NAME_TWO"] }` — delete undeclared resources except the ones named.

## Scope structure

```text
[groups.<name>.cleanup]
  secrets
    actions:      scope
    dependabot:   scope
    codespaces:   scope
    environments: scope
  variables
    actions:      scope
    environments: scope
  rulesets:       scope
  environments:   scope
```

Security features and code scanning have no cleanup scope. Omitting a field there already means "leave alone".

## An enabled scope with nothing declared deletes everything

This is the literal reading of the policy and it is intentional. Enabling `cleanup.secrets.actions` while referencing no secret groups says this repository should have no Actions secrets, and there is no other way to say it.

Check with `--dry-run` before enabling a scope on repositories that matter.

## Examples

Delete undeclared Actions secrets:

```toml
[groups.my-projects]
repos = ["repo-one"]
credentials = "personal"
cleanup = { secrets = { actions = true } }
```

Delete undeclared Dependabot secrets, keeping one legacy entry:

```toml
[groups.my-projects]
repos = ["repo-one"]
credentials = "personal"
cleanup = { secrets = { dependabot = { preserve = ["LEGACY_TOKEN"] } } }
```

A full policy, written as sub-tables:

```toml
[groups.my-projects.cleanup]
rulesets = true
environments = true

[groups.my-projects.cleanup.secrets]
actions = true
dependabot = { preserve = ["LEGACY_TOKEN"] }
codespaces = true
environments = true

[groups.my-projects.cleanup.variables]
actions = true
environments = true
```

## Previewing and skipping

`reposets sync --dry-run` lists every resource cleanup would delete and deletes nothing. This is the safest way to check a cleanup policy before enabling it.

```bash
reposets sync --dry-run
# example output
#     would delete  2 secrets (OLD_TOKEN, STALE_KEY)
```

`reposets sync --no-cleanup` skips the cleanup phase entirely for one run. `reposets drift` also runs with cleanup off, because a resource the config never declared is not drift.

## Notes

- **Inherited rulesets are never deleted.** An organization's rulesets apply to a repository without being defined on it, and cleanup only removes repository-level rulesets.
- Cleanup works at the scope level, not the individual resource. You cannot enable it for one secret and not another in the same scope; use `preserve` for that.
- Cleanup is per group, so different groups can have different policies. There is no global cleanup setting.
- Every deletion is named in the output.
