---
title: Reference checks live on commands, not the config loader
description: danglingReferences, orgOnlyViolations and undefinedCredentialLabels are pure functions commands call, not a config-spec validate callback.
type: Decision
status: stable
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 1cdfc683cf03f0497f919c4b75b440fdf1576d32432088c714f51dc1dabb8a72
sources:
  - id: config-refs
    resource: ../../package/src/lib/config-refs.ts
  - id: org-only
    resource: ../../package/src/lib/org-only.ts
  - id: credential-labels
    resource: ../../package/src/lib/credential-labels.ts
  - id: schema-issues
    resource: ../../package/src/lib/schema-issues.ts
  - id: validate-command
    resource: ../../package/src/cli/commands/validate.ts
  - id: sync-command
    resource: ../../package/src/cli/commands/sync.ts
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:26Z
---

# Reference checks live on commands, not the config loader

## Context

`danglingReferences` (`package/src/lib/config-refs.ts`), `orgOnlyViolations` (`package/src/lib/org-only.ts`) and `undefinedCredentialLabels` (`package/src/lib/credential-labels.ts`) are pure functions of a decoded `Config` and `Credentials`[^config-refs][^org-only][^credential-labels]. None is registered anywhere on `ConfigSchema` or `@effected/config-file`'s spec; each is imported and called directly by the commands that need it. `validateCommand` calls all three, in that order, after `configFile.discover` and `configFile.load` succeed[^validate-command]. `syncHandler` calls `danglingReferences` on the decoded config before it partitions groups or resolves any token, and refuses to sync anything when it finds a hit[^sync-command]. A prior design registered an equivalent check, `validateConfigRefs`, as the config spec's own `validate` callback, so a dangling reference failed the *load* for every command; that check was dropped during the v4 rebuild and its absence became `../incidents/dangling-reference-check-dropped.md`.

## Decision

Keep these checks as plain functions called by the commands that need them, rather than restoring a spec-level `validate` callback. `ConfigValidationError.issue` — the shape a decode failure carries — is a schema-issue tree, and `formatSchemaIssue` is built specifically to walk that tree with `SchemaIssue.makeFormatterStandardSchemaV1()`, flattening it to `{ message, path }` entries and deduplicating repeated union-branch lines[^schema-issues]. A spec-level `validate` callback returning a plain string or a custom payload would not fit `formatSchemaIssue`'s expected shape, so restoring the v3 form would mean either abandoning that formatter for cross-reference errors or building a second renderer for a second issue shape.

`validateCommand` runs `danglingReferences` first, ahead of `undefinedCredentialLabels` and `orgOnlyViolations`, and returns as soon as it finds anything: a dangling reference means a group is asking for a section that does not exist, which makes every later check about resources that were never going to be applied[^validate-command]. `syncHandler` runs the same check, with the same early-return shape, before it computes `partitionByProfile` or touches any credential[^sync-command].

## Alternatives rejected

- **The config spec's `validate` callback.** Would need `formatSchemaIssue`'s schema-issue-tree renderer replaced or duplicated for a shape the callback does not naturally produce, and would fail every command's *load* rather than only the commands that read the result.
- **Checking inside each phase.** Each phase already silently drops an unresolvable reference rather than failing on it — restoring the check per phase would mean eight separate places re-implementing the same policy, rather than one function three commands call.

## Consequences

- Only the commands that call these functions check for anything: `validate` and `sync` do; `list`, `doctor` and `history` do not. None of the three that skip it writes anything, so the gap is not silent about a mutation — but a user running only `list` or `doctor` against a broken config gets no warning from those commands.

[^config-refs]: `package/src/lib/config-refs.ts`
[^org-only]: `package/src/lib/org-only.ts`
[^credential-labels]: `package/src/lib/credential-labels.ts`
[^schema-issues]: `package/src/lib/schema-issues.ts`
[^validate-command]: `package/src/cli/commands/validate.ts`
[^sync-command]: `package/src/cli/commands/sync.ts`
