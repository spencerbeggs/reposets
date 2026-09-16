---
type: Gotcha
title: A Layer memoizes per provide, not by const identity
description: Two separate Effect.provide calls over the same layer value are two separate builds — for App.layerTest, two separate in-memory databases.
stale_after: 2026-12-16T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 287dd1b2d1903be1d1a80b3a94e03fead6740d4e29082a5d9c5690d966ea1b75
tags: [effect, testing]
---

# A Layer memoizes per provide, not by const identity

## What it looks like

A test binds `App.layerTest({ namespace: ..., store: { migrations } })` to a
single `const` at module scope, expecting that one in-memory SQLite database
backs every test in the file. A value written by one `it()` and read back by
a second appears to have vanished — as though the store silently dropped a
write, or a migration ran twice against the same schema, or a foreign-key
constraint fired against data that "should" already be there.

## What is actually true

Effect's `Layer` memoizes construction **within a single `Effect.provide`
scope**, not by the identity of the layer value. Piping two independent
`Effect.gen(...).pipe(Effect.provide(AppTest), ...)` calls over the *same*
`AppTest` const still builds `AppTest` twice, because each `Effect.provide`
call is its own construction scope. For `App.layerTest`, "build" means
opening a fresh `:memory:` SQLite database — so the second `it()` is reading
from a database the first `it()` never wrote to, and the two never
disagreed about anything; they were never the same database. This is
ordinary `Layer` semantics working exactly as documented, and the reason it
reads as a bug is that the failure mode looks like lost data rather than
like the wiring mistake it actually is.

`package/__test__/sync/phases.test.ts` avoids the trap by building the layer
once per test rather than assuming module-scope sharing: each test's own
pipeline ends in `.pipe(Layer.provideMerge(AppTest), Layer.provideMerge(recorder().layer))`,
so a test that genuinely needs to see another test's writes has to be
written as one `Effect.gen` sharing one `Effect.provide`, not as two
separate tests trusting the same `const` to mean the same running instance.
