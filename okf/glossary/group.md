---
title: Group
description: '"Group" names both a [groups.*] set of repositories and a reusable secret/variable/settings/ruleset section it references.'
type: Glossary
status: draft
tags: [docs]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 4a910ae0caa1e47c0987323222c4eae9026c671d149f2aa333b47932fca03a43
sources:
  - id: config-schema
    resource: ../../package/src/schemas/config.ts
  - id: config-refs
    resource: ../../package/src/lib/config-refs.ts
---

# Group

"Group" names two unrelated shapes in `reposets.config.toml`, and the collision is a trap because both spellings are common in the same sentence.

A **`[groups.<name>]` group** is a set of repositories synced as one identity: it carries `repos`, a required `credentials` field naming the credential profile it authenticates as, and arrays of references into the top-level resource tables (`settings`, `rulesets`, `environments`, `security`, `code_scanning`, plus the `secrets` and `variables` scope structs)[^config-schema]. This is the kind of group `[groups.<name>.cleanup]` is scoped to: cleanup is per `[groups.*]` group, never global.

A **secret, variable, settings, or ruleset group** is a named, reusable resource section elsewhere in the file — `[secrets.deploy.file]`, `[settings.oss-defaults]`, `[rulesets.branch-protection]` — that a `[groups.*]` group references by name. A `[groups.*]` group's `secrets` field, for example, is `SecretScopes` value naming which secret groups apply to which scope (`actions`, `dependabot`, `codespaces`, `environments`)[^config-schema].

## The trap

"A group's secrets" is ambiguous out of context: it can mean the secret groups a `[groups.*]` group references, or — read the other way — the entries inside one `[secrets.<name>.*]` group. `danglingReferences` disambiguates by checking each reference where it is **used**: a `[groups.*]` group's `secrets.actions` array names secret-group names, and those names are checked against the top-level `[secrets.*]` table, not against anything inside the referencing group itself[^config-refs]. An unreferenced `[secrets.*]` or `[settings.*]` section is dead config, not an error, because a section is defined once and a `[groups.*]` group is what turns a reference into work.

[^config-schema]: `package/src/schemas/config.ts`
[^config-refs]: `package/src/lib/config-refs.ts`
