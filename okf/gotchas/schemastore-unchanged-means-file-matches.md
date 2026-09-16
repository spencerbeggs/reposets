---
title: "\"unchanged\" means the file already matches, not that the schema did not change"
description: schemastore build/check report unchanged by content comparison, which is easy to misread as a no-op schema edit.
stale_after: 2027-03-16T00:00:00Z
type: Gotcha
tags: [dx, docs]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 393f33fd2ffe70023a8ba6d52161b8bee3c5d7403120e06316db1a7926e48caf
sources:
  - id: schemastore-cli
    resource: "npm:@effected/schemastore-cli"
---

# "unchanged" means the file already matches, not that the schema did not change

## What it looks like

An Effect Schema field gets a new annotation, or a rule changes shape, and
`schemastore build` (or `check`) is run to confirm the edit took effect.
The tool reports the document `unchanged`. Read at face value, that says
the schema edit had no effect on the published JSON Schema — which reads
as the edit not having landed, a stale build, or the wrong schema file
being edited.

## What is actually true

`@effected/schemastore-cli`'s writes are content-comparing[^schemastore-cli]: a document is
only rewritten when the JSON it would produce differs byte-for-byte from
what is already on disk. `unchanged` reports that the file on disk
**already matches** what the tool would write right now — which is
exactly what happens when the edit changed something the JSON Schema
serialization does not capture (an internal-only TypeScript comment, a
field that was already effectively equivalent under the schema's own
normalization), or when the edit was made to the wrong file. It does not,
on its own, mean the *source* schema is unmodified.

This distinction produced wrong conclusions during this project's initial
adoption of `@effected/schemastore-cli`: `schemastore check` reporting
`unchanged` against a freshly rewritten config was taken, correctly, as
confirmation the derived `$id` matched the SchemaStore catalog's pinned
URL byte-for-byte — the same signal read the other way, against an edit
expected to change output, would have looked like a failed edit instead.

## What to do about it

When an edit is expected to change the published schema and the tool
reports `unchanged`, diff the actual JSON Schema output
(`git diff package/schemas/`) rather than trusting the human-readable
summary line alone — a real no-op leaves `git diff` empty, and an edit
that failed to reach the schema in the way expected shows the file
untouched for a specific, inspectable reason.

[^schemastore-cli]: `npm:@effected/schemastore-cli`
