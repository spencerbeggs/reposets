---
title: The dangling-reference check was dropped and nothing replaced it
description: The v4 rebuild dropped the loader-level cross-reference check; a misspelled section name synced nothing, reported nothing, and validate printed Valid.
type: Incident
status: draft
occurred: 2026-08-14
guard: ../../package/__test__/lib/config-refs.test.ts
tags: [testing, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: ca3011c67aeeeaa4272c34f42ea703ca65d75148c717ad934d46c5a3f6690495
sources:
  - id: config-refs
    resource: ../../package/src/lib/config-refs.ts
  - id: config-refs-test
    resource: ../../package/__test__/lib/config-refs.test.ts
  - id: validate-command
    resource: ../../package/src/cli/commands/validate.ts
  - id: sync-command
    resource: ../../package/src/cli/commands/sync.ts
---

# The dangling-reference check was dropped and nothing replaced it

## What shipped broken

A previous version of reposets checked every `[groups.*]` reference against the top-level section it points into — `settings`, `rulesets`, `environments`, `security`, `code_scanning`, `secrets`, `variables` — at config-load time, for every command. During the Effect v4 rebuild, that check was dropped and nothing took its place: every sync phase kept its own defensive habit of silently dropping a reference it could not resolve, and did so while **citing the deleted check by name** in source comments, as if the check still ran somewhere upstream[^config-refs].

## What it looked like to the consumer

`settings = ["defualt"]` — one misspelled name — synced nothing for that group, reported nothing, and exited 0. Running `reposets validate` against the same config printed `Valid:` and exited 0 as well, because nothing in the load path or the command inspected reference targets at all. This is the same class of failure as a `--repo` filter that matches no repository and is treated as "nothing to do" rather than a typo: a destructive or consequential command silently becomes a no-op that looks like success[^config-refs].

## Root cause

The check had been a callback registered directly on the config spec's `validate` hook, so removing that registration during the rebuild removed the check entirely rather than leaving a smaller, degraded version of it. Nothing in the schema decode path, and nothing in any individual phase, independently verified that a group's reference arrays pointed at sections that actually existed. The gap was invisible under normal testing because every phase's own silent-skip behavior looked, from the outside, exactly like "this group legitimately configures nothing here."

## The guard

The check is restored as `danglingReferences`, a pure function of a decoded `Config` in `package/src/lib/config-refs.ts`[^config-refs]. It covers all seven top-level reference arrays plus both halves of an environment-scoped secret or variable assignment — the environment name keying the record and the group names inside it are checked independently, since either can dangle on its own[^config-refs]. Each finding carries `defined`, the names that do exist for that section, because nearly every dangling reference is a typo and a typo is fixed by seeing the correct spelling[^config-refs]. `validateCommand` calls it first, ahead of `undefinedCredentialLabels` and `orgOnlyViolations`, and reports every hit rather than exiting 0[^validate-command]. `syncHandler` calls the same function before it partitions groups by credential profile or resolves any token, and refuses to sync anything when it finds a hit — so the failure mode changed from "GitHub writes for some groups, then a dangling one is silently skipped" to "sync refuses before writing anything"[^sync-command]. `package/__test__/lib/config-refs.test.ts` pins the behavior, including the both-halves-of-an-environment-assignment case[^config-refs-test].

[^config-refs]: `package/src/lib/config-refs.ts`
[^config-refs-test]: `package/__test__/lib/config-refs.test.ts`
[^validate-command]: `package/src/cli/commands/validate.ts`
[^sync-command]: `package/src/cli/commands/sync.ts`
