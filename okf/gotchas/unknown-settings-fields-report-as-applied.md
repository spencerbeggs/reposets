---
type: Gotcha
title: An unrecognised settings field reports as applied
description: A misspelled or unsupported settings field decodes cleanly, gets PATCHed, is silently ignored by GitHub, and the run still reports it as applied.
resource: ../../package/src/schemas/config.ts
stale_after: 2027-03-16T00:00:00Z
tags: [github, dx]
generated:
  by: okfit/claude-code
  at: 2026-10-28T23:43:19Z
sources:
  - id: config-schema
    resource: ../../package/src/schemas/config.ts
  - id: doctor-cmd
    resource: ../../package/src/cli/commands/doctor.ts
  - id: has-discussions-incident
    resource: ../incidents/has-discussions-shipped-inert.md
integrity:
  generated:
    body: e1eeebaafe95272f
---

# An unrecognised settings field reports as applied

**What a reader sees:** a field under `[settings.<name>]` decodes without
error, gets sent in the `PATCH /repos/{owner}/{repo}` request, and the run
logs it under `applied settings` — every visible signal says the field
took effect.

**What is actually true:** `SettingsGroupSchema` is built with
`Schema.StructWithRest`, so any key the schema does not name is absorbed
by the rest schema rather than rejected — strict decoding has no way to
object to it.[^config-schema] GitHub's own `PATCH /repos/{owner}/{repo}`
endpoint answers `200` and silently ignores any field it does not
recognise, and nothing in that response distinguishes "this field changed
the repository" from "this field was never a real field and was thrown
away." A typo like `has_wikkis` therefore passes every gate this codebase
has, is sent, is ignored, and is reported as applied — indistinguishable,
end to end, from a field that actually worked.

The pass-through is deliberate, not an oversight: it is what lets a
setting GitHub adds tomorrow work here without a release, since the rest
schema accepts it and forwards it instead of rejecting an otherwise-valid
config for naming a field this schema does not yet know. The trade is that
a typo and a not-yet-typed field look identical to strict decoding, so the
only defence left is a warning rather than a rejection. `doctor` derives
its known-settings-field set directly from `SettingsGroupSchema`'s own
field list (`Object.keys(SettingsGroupSchema.schema.fields)`) rather than
hand-maintaining a second list, comparing the raw TOML against it and
suggesting the nearest known field by edit distance when one is
close.[^doctor-cmd] Deriving that set from the schema is what stops a
second hand-written list from going stale the way the original
`KNOWN_CONFIG_KEYS`/`KNOWN_GROUP_KEYS` sets already had for removed keys.

`sync` now narrows the trap without closing it. The settings phase calls
`applySettings` with `unknownKeys: "send"`, so a key GitHub's description
does not declare is sent rather than dropped, and `@effected/github` names
it in `AppliedSettings.unverified`; the phase prints one
`unconfirmed: GitHub does not describe this field` line per such key.
That catches a typo like `has_wikkis` during the run. It does not catch a
key GitHub *describes* but ignores, the `has_discussions` shape below,
which still reports as applied; `validate` does not warn at all.

This is the same failure shape that let
[`has_discussions` ship inert](../incidents/has-discussions-shipped-inert.md):
a field this codebase types can still be silently ignored by GitHub for
reasons the response never surfaces, and typing a field only moves the
defense from "not covered at all" to "one more thing `doctor` has to
know to check."

[^config-schema]: `package/src/schemas/config.ts`
[^doctor-cmd]: `package/src/cli/commands/doctor.ts`
</content>
