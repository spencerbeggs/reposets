---
type: Decision
title: Reference checks are functions commands call
description: danglingReferences, undefinedCredentialLabels and orgOnlyViolations are pure functions validate and sync call, not a config-spec validate callback, so decode failures keep one issue shape for @effected/cli's renderers.
status: stable
supersedes: reference-checks-live-on-commands.md
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-27T17:39:49Z
  body_sha256: 7a1a257678eea4982d546dda34c4bdaadc0b5025c8f4877a4f1f4fc99855470d
sources:
  - id: config-refs
    resource: ../../package/src/lib/config-refs.ts
  - id: org-only
    resource: ../../package/src/lib/org-only.ts
  - id: credential-labels
    resource: ../../package/src/lib/credential-labels.ts
  - id: effected-cli
    resource: npm:@effected/cli@0.9.0
  - id: cli-index
    resource: ../../package/src/cli/index.ts
  - id: validate-command
    resource: ../../package/src/cli/commands/validate.ts
  - id: sync-command
    resource: ../../package/src/cli/commands/sync.ts
verified:
  - by: human:spencer
    at: 2026-09-27T17:38:40Z
---

# Reference checks are functions commands call

## Decision

Keep `danglingReferences` (`package/src/lib/config-refs.ts`),
`undefinedCredentialLabels` (`package/src/lib/credential-labels.ts`) and
`orgOnlyViolations` (`package/src/lib/org-only.ts`) as pure functions of a
decoded `Config` and `Credentials`, called by the commands that need
them.[^config-refs][^credential-labels][^org-only] Do not register them on
`ConfigSchema` or as `@effected/config-file`'s spec-level `validate`
callback.

A decode failure is a `ConfigValidationError` whose `issue` is a
schema-issue tree. `@effected/cli`'s `ConfigIssueRenderer` and
`SchemaIssueRenderer` walk that tree into `unknown key at …` lines and
deduplicate a union's repeated branch lines.[^effected-cli] The entrypoint's
`render` and `doctor` both use them.[^cli-index] A spec-level `validate`
callback returning a plain string or a custom payload would not have that
shape. Restoring it would mean either giving up the kit's renderer for
cross-reference errors or building a second renderer for a second shape.

`validate` runs `danglingReferences` first and stops as soon as it finds
anything. A dangling reference means a group asks for a section that does
not exist, which makes every later check about resources that were never
going to be applied. It then runs `undefinedCredentialLabels`, then
`orgOnlyViolations`, and reports each finding with `CliExit.set(1)`, not by
failing.[^validate-command] `sync` runs `danglingReferences` with the same
stop-early shape before it partitions groups or touches any
credential.[^sync-command]

## Context

This supersedes
[reference-checks-live-on-commands](reference-checks-live-on-commands.md).
The decision is unchanged. That concept justified it by a renderer in this
repository, and schema-issue rendering now lives in `@effected/cli`. A
prior design registered an equivalent check, `validateConfigRefs`, as the
spec's own `validate` callback, so a dangling reference failed the *load*
for every command. That check was dropped during the v4 rebuild, and its
absence became
[dangling-reference-check-dropped](../incidents/dangling-reference-check-dropped.md).

## Alternatives rejected

- **The config spec's `validate` callback.** It would need the kit's
  schema-issue renderer replaced or duplicated for a shape the callback
  does not naturally produce. It would also fail every command's *load*,
  not only the commands that read the result.
- **Checking inside each phase.** Each phase already drops an unresolvable
  reference silently instead of failing on it. Restoring the check per
  phase would mean eight places re-implementing one policy, where one
  function called by two commands suffices.

## Consequences

- Only `validate` and `sync` check. `list`, `doctor` and `history` do not,
  and none of them writes anything, so the gap never hides a mutation. But
  a user who runs only `list` or `doctor` against a broken config gets no
  warning from them.
- The union-line dedupe is upstream behaviour. No test in this repository
  pins it, so a regression would show up in `@effected/cli`, not here.

[^config-refs]: `package/src/lib/config-refs.ts`
[^org-only]: `package/src/lib/org-only.ts`
[^credential-labels]: `package/src/lib/credential-labels.ts`
[^effected-cli]: npm:@effected/cli@0.9.0
[^cli-index]: `package/src/cli/index.ts`
[^validate-command]: `package/src/cli/commands/validate.ts`
[^sync-command]: `package/src/cli/commands/sync.ts`
