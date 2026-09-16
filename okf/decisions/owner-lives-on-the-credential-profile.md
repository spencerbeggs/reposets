---
title: The owner lives on the credential profile
description: A credential profile declares its owner as username or org; no group or config-level owner field exists.
type: Decision
status: stable
tags: [architecture, security, github]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: b808bfc3d81d6bbc6a24076da927ea5a548142d4b466d8cdb56304bf3770b86f
sources:
  - id: credentials-schema
    resource: ../../package/src/schemas/credentials.ts
  - id: sync-engine
    resource: ../../package/src/sync/SyncEngine.ts
  - id: sync-command
    resource: ../../package/src/cli/commands/sync.ts
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:24Z
---

# The owner lives on the credential profile

## Context

`reposets.config.toml` has no `owner` field, at the top level or on a `[groups.*]` table[^credentials-schema]. Every group carries a required `credentials` field naming a profile in `reposets.credentials.toml`[^credentials-schema], and that profile declares exactly one of `username` or `org`[^credentials-schema]. `credentials` selects both the profile's token and its `[resolve]` values[^sync-engine]. A previous design put `owner` on the config, both at the top level and per group, with a fallback chain between them, refused to run `sync` at all with more than one credential profile configured, and fell back to `Object.values(profiles)[0]` for a group naming none — an identity chosen by TOML key order.

## Decision

A token authenticates as an identity, so the owner is a property of the credential rather than of the repositories being configured. `profileOwner()` reads the two-key encoding and returns a total `{ owner, ownerType }` value, because the schema guarantees exactly one of `username`/`org` is set[^credentials-schema]. `SyncEngine.syncAll` looks up `credentials.profiles[group.credentials]` for every group — a lookup, never a default — and derives `owner` and `declaredType` from `profileOwner()`[^sync-engine]. Before writing, the engine reads the owner's actual type from GitHub, caches the result per owner, and compares it against the declaration; a mismatch fails that repository with a named error rather than the settings PATCH answering a 422 partway through a run[^sync-engine]. On a failed read the declaration stands rather than the engine assuming `Organization`[^sync-engine].

`sync` partitions groups by credential profile and runs one `SyncEngine` per partition, in the config's order of first appearance[^sync-command]. `partitionByProfile()` builds that map; only profiles named by the selected groups are resolved, so a `--group` run is never held hostage by an unrelated profile whose 1Password item was renamed[^sync-command]. A profile that does not exist, or whose token fails to resolve, fails only the groups that name it — the loop logs the error, increments an error count, and `continue`s to the next partition rather than aborting the run[^sync-command]. The run boundary belongs to the command: the engine records into the `runId` it is given and never opens or closes a run itself, so one `sync` invocation is still one row in `history` however many identities it used[^sync-engine].

## Alternatives rejected

- **Optional `credentials`, defaulting to "the only profile".** Stops being well defined the moment a second profile is added: adding an unrelated profile would either silently change which account an existing group writes to, or turn a working config into an error, with nothing in the group itself having changed[^credentials-schema].
- **An `owner` plus an `owner_type` pair.** A plain union of two structs accepts a profile declaring both `username` and `org` and silently drops the second by branch order, making the contradictory state representable[^credentials-schema]. Two mutually exclusive keys make an owner without a declared type unrepresentable instead.

## Consequences

- Requiring `credentials` on every group costs one line per group in a single-profile config, paid once, in exchange for every group's identity being a single lookup with no fallback chain.
- A group can never end up writing to one account with another account's token, because one profile has exactly one owner; a token that reaches several owners is declared as several profiles sharing a token reference.
- A bad profile — unknown name, or an unresolvable token — fails only its own groups; a four-group sync does not lose three already-written repositories to the fourth group's typo.

[^credentials-schema]: `package/src/schemas/credentials.ts`
[^sync-engine]: `package/src/sync/SyncEngine.ts`
[^sync-command]: `package/src/cli/commands/sync.ts`
