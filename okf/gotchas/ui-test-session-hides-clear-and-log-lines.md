---
type: Gotcha
title: CliUiTest.session shows neither a cleared frame nor the lines above a live view
description: "CliUiTest.session renders in Ink's debug mode, so a prompt's clear: true is unobservable, and its frames hold a live view's footer only, not the lines written above it through logConsole."
status: draft
stale_after: 2027-04-02T00:00:00Z
tags: [testing, dx]
generated:
  by: okfit/claude-code
  at: 2026-10-02T15:49:51Z
  body_sha256: 856b0846462e66cf5527ea9fbde9cb5734022c10c9fb4bcfd90be62faf5a5189
sources:
  - id: effected-cli
    resource: npm:@effected/cli@0.11.0
  - id: terminal-util
    resource: ../../package/__test__/utils/terminal.ts
  - id: credentials-test
    resource: ../../package/__test__/cli/credentials.test.ts
---

# CliUiTest.session shows neither a cleared frame nor the lines above a live view

Nothing in this repository produces the misleading signal; it comes from
`@effected/cli/ui`'s test harness, `CliUiTest`.[^effected-cli]

**What you see.** Two things, in tests that drive a screen through
`CliUiTest.session`:

- A prompt mounted with `clear: true`, such as every text prompt in
  `credentials create`, still has its last frame in the session after it
  closes.
- A test of `sync`'s live view finds the footer in the session's frames but
  none of the report lines or error lines the run wrote above it.

**What you will wrongly conclude.** That `clear` is broken and a typed
value stays in the scrollback, or that the report never reached the
terminal while the view was mounted.

**What is true.** `CliUiTest.session` mounts Ink in debug mode, which
writes every frame whole and ignores `clear`. The kit's own documentation
says to test `clear` on the production render path. A session's frames are
also only the frames: the lines a live view writes above its footer
through `handle.logConsole` are not captured there.[^effected-cli]

**What to do instead.** For the clear, assert what the command controls,
as `package/__test__/cli/credentials.test.ts` does: the value is refused
in the screen and absent from both streams and the file, with a comment
that the clearing itself is not observable.[^credentials-test] For lines
above a live view, mount the handler's own view on
`package/__test__/utils/terminal.ts`'s `capturedTerminal`. It is an
in-memory terminal that keeps every byte written, with stderr on the same
stream as stdout, as on a real terminal.[^terminal-util]

[^effected-cli]: npm:@effected/cli@0.11.0
[^terminal-util]: `package/__test__/utils/terminal.ts`
[^credentials-test]: `package/__test__/cli/credentials.test.ts`
