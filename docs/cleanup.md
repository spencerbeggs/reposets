# Cleanup

## Overview

Cleanup automatically removes resources from repos that are not declared in your config. It runs after sync, so newly synced items are never deleted. Cleanup is configured per-group — each group has its own `cleanup` field. All scopes default to disabled.

## CleanupScope

Each scope accepts one of three values:

- `false` — cleanup disabled (default)
- `true` — delete all undeclared resources in this scope
- `{ preserve = ["name1", "name2"] }` — delete undeclared except those in the preserve list

## Scope Structure

Cleanup is organized into nested scopes:

```text
[groups.<name>.cleanup]
  secrets
    actions:      CleanupScope
    dependabot:   CleanupScope
    codespaces:   CleanupScope
    environments: CleanupScope
  variables
    actions:      CleanupScope
    environments: CleanupScope
  rulesets:       CleanupScope
  environments:   CleanupScope
```

## Examples

Delete all undeclared Actions secrets:

```toml
[groups.my-projects]
cleanup = { secrets = { actions = true } }
```

Delete undeclared Dependabot secrets except a legacy one:

```toml
[groups.my-projects]
cleanup = { secrets = { dependabot = { preserve = ["LEGACY_TOKEN"] } } }
```

Full cleanup config:

```toml
[groups.my-projects]
# ...
cleanup = {
  rulesets = true,
  environments = true,
  secrets = {
    actions = true,
    dependabot = { preserve = ["LEGACY_TOKEN"] },
    codespaces = true,
    environments = true
  },
  variables = {
    actions = true,
    environments = true
  }
}
```

## Dry Run and Skip

Use `repo-sync sync --dry-run` to preview what would be deleted before applying. Use `repo-sync sync --no-cleanup` to skip cleanup entirely during a sync.

## Notes

- Org-level rulesets (those with `source_type !== "Repository"`) are never deleted by cleanup. Cleanup only removes repo-level rulesets.
- Cleanup runs per-group, not globally. Different groups can have different cleanup policies.
- Newly synced resources are never deleted — cleanup compares against the declared config after sync completes.
