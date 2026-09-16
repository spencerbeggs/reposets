---
type: Gotcha
title: An unrecognised settings field reports as applied
description: A misspelled or unsupported settings field decodes cleanly, gets PATCHed, is silently ignored by GitHub, and the run still reports it as applied.
resource: ../../package/src/schemas/config.ts
stale_after: 2027-03-16T00:00:00Z
tags: [github, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 05e55e884a3adccc295d2f7845c1430419c5a3e1b0dc2726aaeeeb5c19dede43
sources:
  - id: config-schema
    resource: ../../package/src/schemas/config.ts
  - id: doctor-cmd
    resource: ../../package/src/cli/commands/doctor.ts
  - id: has-discussions-incident
    resource: ../incidents/has-discussions-shipped-inert.md
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
`KNOWN_CONFIG_KEYS`/`KNOWN_GROUP_KEYS` sets already had for removed keys —
`doctor` only catches this by running as a separate, explicit step; `sync`
and `validate` do not warn about it on their own.

This is the same failure shape that let
[`has_discussions` ship inert](../incidents/has-discussions-shipped-inert.md):
a field this codebase types can still be silently ignored by GitHub for
reasons the response never surfaces, and typing a field only moves the
defense from "not covered at all" to "one more thing `doctor` has to
know to check."

[^config-schema]: `package/src/schemas/config.ts`
[^doctor-cmd]: `package/src/cli/commands/doctor.ts`
</content>
