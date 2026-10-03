---
type: Gotcha
title: CliUiTest.session shows neither a cleared frame nor the lines above a live view
description: "Retired: CliUiTest.session now keeps a transcript of every line above a live frame, and renders on the production path on request, where a prompt's clear: true is observable. Only the default debug render path still ignores clear."
status: deprecated
stale_after: 2027-04-02T00:00:00Z
tags: [testing, dx]
generated:
  by: okfit/claude-code
  at: 2026-10-03T18:04:28Z
  body_sha256: 50a5a3c5935eaaa77bcc66f5d5dcc5f4b0c35c5055702074cbae5f3193f61e0f
sources:
  - id: effected-cli
    resource: npm:@effected/cli@0.12.0
  - id: credentials-test
    resource: ../../package/__test__/cli/credentials.test.ts
  - id: sync-test
    resource: ../../package/__test__/cli/sync.test.ts
---

# CliUiTest.session shows neither a cleared frame nor the lines above a live view

This trap no longer holds, and this concept is kept only so a link to it
does not dangle. Do not act on its title.

**What is true now.** A `CliUiTest.session` exposes `written`, every byte
the in-memory terminal received; `stdoutWritten` and `stderrWritten`, the
same split by stream; and `transcript`, `stdoutTranscript` and
`stderrTranscript`, what stays on the terminal once the renderer's erases
are applied. The lines a live view writes above its frame through
`logConsole` are in the transcript, in order with the
frame.[^effected-cli] `package/__test__/cli/sync.test.ts` asserts the
report, the error lines and the committed summary on it.[^sync-test]

**The one remnant.** A session still renders in Ink's debug mode by
default, where a prompt's `clear: true` does nothing. Pass
`renderPath: "production"` to render as a terminal does, and `clear` is
observable in `transcript`, as every test in
`package/__test__/cli/credentials.test.ts`'s masking block
does.[^effected-cli][^credentials-test] The kit's own documentation on
`session` says so, so it is not a trap a reader meets unwarned.

[^effected-cli]: npm:@effected/cli@0.12.0
[^credentials-test]: `package/__test__/cli/credentials.test.ts`
[^sync-test]: `package/__test__/cli/sync.test.ts`
