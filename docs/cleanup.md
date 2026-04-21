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

**Important:** Org-level rulesets (those with `source_type !== "Repository"`) are never deleted by cleanup. Cleanup only removes repo-level rulesets.

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

Use `reposets sync --dry-run` to preview what would be deleted before applying. In dry-run mode, cleanup logs every resource it would delete without actually deleting anything. This is the safest way to verify your cleanup config before enabling it.

Use `reposets sync --no-cleanup` to skip cleanup entirely during a sync.

## Notes

- Org-level rulesets (those with `source_type !== "Repository"`) are never deleted by cleanup. Cleanup only removes repo-level rulesets.
- Cleanup operates at the scope level (actions, dependabot, etc.), not at the individual resource level. You cannot selectively enable cleanup for one secret but not another within the same scope. Use `preserve` lists to protect specific resources from deletion.
- Cleanup runs per-group, not globally. Different groups can have different cleanup policies.
- Newly synced resources are never deleted -- cleanup compares against the declared config after sync completes.
