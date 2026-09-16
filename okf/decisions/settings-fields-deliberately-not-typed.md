---
title: Five PATCH fields are deliberately not typed on settings groups
description: name, private/visibility, archived, default_branch and use_squash_pr_title_as_default are left off SettingsGroupSchema because their blast radius exceeds a declarative sync.
type: Decision
status: stable
tags: [security, github]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: afea5261f3f673e8d0febb3fbe4ee73420f8493ea4bb89db8e0abfb231085d1e
sources:
  - id: config-schema
    resource: ../../package/src/schemas/config.ts
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:28Z
---

# Five PATCH fields are deliberately not typed on settings groups

## Context

`SettingsGroupSchema` types a fixed set of known fields as a `Schema.StructWithRest`, with an index signature (`[Schema.Record(Schema.String, Schema.Json)]`) that passes any other key straight through to the API[^config-schema]. `PATCH /repos/{owner}/{repo}` accepts more than that typed set. Every typed field is an optional boolean, literal-enum, or nested `security_and_analysis` block — there is no `name`, `private`, `visibility`, `archived`, `default_branch`, or `use_squash_pr_title_as_default` among them[^config-schema].

## Decision

Five fields are left untyped on purpose, because their blast radius exceeds what a declarative sync should do without a confirmation step this tool does not have:

- **`name`.** Renaming a repository from a config file is destructive with no undo, and the config identifies repositories *by* name — accepting a rename risks the config referring to a repository it just renamed away from under itself.
- **`private` / `visibility`.** Changing visibility can delete forks and break every link into the repository. A config that can silently publish a private repository is a different risk class from one that toggles a merge-button setting.
- **`archived`.** Archiving makes every other phase fail against that repository. Ordering an archive correctly against the rest of a sync — before or after everything else — is a design problem this tool has not solved, not a field to expose ahead of solving it.
- **`default_branch`.** GitHub does not move commits: setting this on a branch that does not exist errors outright, and setting it on one that does exist changes what every ruleset targeting `"default"` applies to, silently rippling into rulesets nothing in the same PATCH touched.
- **`use_squash_pr_title_as_default`.** Deprecated by GitHub in favor of `squash_merge_commit_title`, which `SettingsGroupSchema` does type[^config-schema].

`description` and `homepage` are omitted for a different and much weaker reason: nobody has asked for them, and both are ordinary `PATCH /repos` fields with no comparable blast radius. The real obstacle to adding them is not the field but the value: a settings group applies the same resources to every repository that references it, so a shared group would give every repository in it the identical description — almost never what anyone wants. A per-repository value is a shape the config does not have today; see [subsystems reposets does not manage](../limitations/subsystems-reposets-does-not-manage.md).

## Alternatives rejected

- **Type everything the PATCH accepts.** Would put a repository rename, a visibility flip, and an archive toggle behind the same "one line in a TOML file, applied to every repository in the group on the next `sync`" contract as `has_wiki`, with no distinction in risk.
- **A `--allow-destructive` flag gating all five.** Worth revisiting, but only alongside the first five fields together — a single flag unlocking a rename, a visibility change, an archive, a default-branch move and a deprecated-field write at once would not let an operator opt into one without the others.

## Consequences

- `SettingsGroupSchema`'s `StructWithRest` pass-through still lets a user send any of these five fields anyway, since only the *typed* struct omits them — the rest-schema accepts arbitrary keys as JSON and forwards them unexamined. See [unknown settings fields report as applied](../gotchas/unknown-settings-fields-report-as-applied.md).

[^config-schema]: `package/src/schemas/config.ts`
