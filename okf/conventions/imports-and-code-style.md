---
type: Convention
title: Imports and code style
description: Import extension and protocol rules, blakejs's CommonJS trap, and the Biome configuration this codebase is formatted against.
stale_after: 2027-03-16T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 3c864ffb7082f65b061cda75e8d71ca3c551b927dae1bbaf43457abf028aa58b
tags: [dx]
---

# Imports and code style

Use `.js` extensions on every relative import, even though the source is
`.ts` — Biome's `useImportExtensions` rule enforces this and it matches what
Node resolves at runtime under `nodenext`.

Use the `node:` protocol for every Node built-in (`node:fs`, `node:path`,
`node:process`) — Biome's `useNodejsImportProtocol` rule enforces this.

Use `import type` for every type-only import — `verbatimModuleSyntax` in
`tsconfig.json` makes a plain `import` of a type-only binding a compile
error, not just a lint warning.

`blakejs` is CommonJS, and Node resolves only part of its named-export
surface: `blake2b` interops as a named import, but the other nine exports —
`blake2bHex` included — do not, and `import { blake2bHex } from "blakejs"`
throws `"does not provide an export named"` at runtime, after a clean build
(`package/src/lib/fingerprint.ts:1-8`). The fix is a default import
destructured afterward:

```ts
import blakejs from "blakejs";

const { blake2bHex } = blakejs;
```

That the first export you would reach for (`blake2b`) happens to interop
correctly is what makes the ninth one (`blake2bHex`) a surprise rather than an
obvious CommonJS trap.

Biome is configured through `@savvy-web/silk/biome` (`biome.json`): tabs,
120-column lines, no unused variables (rest siblings excepted), and no import
cycles. `useExplicitType` is **off** — writing an explicit return type on
every function is a house convention here, not something the linter
enforces, so its absence on a given function is not itself a defect.

Do not hand-format. `lint-staged` runs `biome check --write` over every
staged JS/TS/JSON file at commit time and re-stages the result, so a
formatting pass performed by hand before committing duplicates work the hook
already does and can disagree with it.
