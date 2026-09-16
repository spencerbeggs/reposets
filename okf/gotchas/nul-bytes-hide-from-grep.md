---
title: NUL bytes hide from grep
description: A composite-key separator that is a literal NUL byte makes plain grep report a clean, silent no-match against files that do contain what you searched for
type: Gotcha
status: draft
resource: ../../package/src/store/AppliedState.ts
stale_after: 2027-01-16T00:00:00Z
tags:
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 021d1699a4129c9c6bc59797e797b0708901e14740d9c79bc0e9c4a7af5058f1
sources:
  - id: applied-state
    resource: "../../package/src/store/AppliedState.ts"
---

# NUL bytes hide from grep

`AppliedState`'s composite drift key joins `kind` and `name` with a
literal NUL byte rather than a printable separator, specifically so the
two components can never collide by concatenation. That same byte makes
plain `grep` treat the file as binary.

Run `grep -rlaP '\x00' package/src` and four files come back as
containing a literal NUL byte: `package/src/lib/credential-labels.ts`,
`package/src/sync/phases/secrets.ts`,
`package/src/sync/phases/variables.ts`, and
`package/src/store/AppliedState.ts`.

## What it looks like

A search against one of these files without `-a` — `grep -n "refKey"
package/src/store/AppliedState.ts`, or the equivalent in a plain `rg`
invocation — prints nothing. There is no warning, no "binary file
matches" notice on the standard `-a`-less path in some configurations,
just silence.

## What you would wrongly conclude

That the string being searched for is not in the file — that `refKey`
was renamed, or the separator changed, or the file does not do what a
teammate said it does.

## What is actually true

The file is plain UTF-8 source; it is not binary. `grep` classifies it as
binary purely because it contains one embedded NUL byte (the key
separator itself, spelled `` `${kind}\0${name}` `` in the source and
rendered as a plain space by anything that displays it, terminal
included), and a binary classification makes `grep` refuse to print
matching lines at all rather than warn and print them[^applied-state].

## The fix

Use `grep -a` (force grep to treat the file as text) or `rg -a` — both
print matches normally once binary detection is overridden. The
`-rlaP '\x00'` invocation above is also how to find *which* files carry
this trap before searching them: run it first, and read anything it
lists with `-a` from the start.

[^applied-state]: `../../package/src/store/AppliedState.ts`
