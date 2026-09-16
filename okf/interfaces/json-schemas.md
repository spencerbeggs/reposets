---
title: Published JSON schemas for reposets.config.toml and reposets.credentials.toml
description: The SchemaStore-catalog JSON schemas editors and reposets init use, and how they are built and checked.
type: Interface
kind: config
resource: ../../package/lib/configs/schemastore.config.ts
tags: [docs, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 01e4ae66fb0f0ea1c9d128001726bc5d34b3a49c913ee8a4d61562ebb6bb576d
sources:
  - id: schemastore-config
    resource: ../../package/lib/configs/schemastore.config.ts
  - id: annotations
    resource: ../../package/src/schemas/annotations.ts
  - id: turbo-json
    resource: ../../package/turbo.json
  - id: catalog-json
    resource: ../../package/schemas/catalog.json
---

# Published JSON schemas for reposets.config.toml and reposets.credentials.toml

## Contract

Editor TOML language servers (Taplo, Tombi) and the SchemaStore catalog
consume two published JSON Schema documents under `package/schemas/`:
`reposets.config.schema.json` and `reposets.credentials.schema.json`,
built from the entries named in `schemastore.config.ts`[^schemastore-config],
alongside a generated `catalog.json` listing both[^catalog-json]. Their
`$id`s sit at
`https://raw.githubusercontent.com/spencerbeggs/reposets/main/package/schemas/<name>.schema.json`,
matching the URLs the SchemaStore catalog already pins for this project —
an editor with SchemaStore support associates `reposets.config.toml` and
`reposets.credentials.toml` with these schemas automatically, with no
`# yaml-language-server` or `#:schema` comment required in the TOML file
itself.

## Build and check

- `pnpm --filter reposets schema:build` (`schemastore build
  lib/configs/schemastore.config.ts`) writes both schema files and
  `catalog.json`. Turbo caches this task on `src/schemas/**` plus the
  config file, and both `build:dev` and `build:prod` depend on
  it[^turbo-json].
- `pnpm --filter reposets schema:check` (`schemastore check
  lib/configs/schemastore.config.ts`) is the CI gate: uncached, it reports
  what a build would do and writes nothing[^turbo-json]. Its exit codes,
  read from the installed `@effected/schemastore-cli@0.12.0`: `0` when
  every document already matches what a build would write; `1` when a
  schema fails the lint/validation gate, a published schema drifted under
  `onDrift: "error"`, or (under `check` specifically) a committed document
  is stale against what the config would generate; `2` when the config
  module itself cannot be found or fails to load; `64` for a usage error,
  such as combining `--force` with an explicit `--drift` flag that is not
  `allow`.

## Annotation helpers

`tombi()`, `taplo()` and `docs()` in `package/src/schemas/annotations.ts`
are local to this repository, not part of `@effected/schemastore` — the
library ships the keyword families (`x-taplo`, `x-tombi-*`) that
`StoreDocument` carries through the Draft-07 lowering, but no
constructors for them[^annotations]. They exist as named helpers, used at
roughly forty-five call sites across `package/src/schemas/*.ts`, because
inlining the exact key spellings at every site is where they would drift
apart.

- `tombi({ ... })` returns separate `x-tombi-*` top-level keys — key
  ordering, array ordering, string formats, TOML version and similar —
  for the Tombi TOML language server[^annotations].
- `taplo({ ... })` returns one `x-taplo` object — scaffolding `initKeys`
  and documentation `links` — for the Taplo TOML language server.
  **Taplo ignores `x-taplo` on any node that also carries `$ref`**, and
  the helper does not work around that limitation[^annotations].
- `docs(page)` returns a URL under this repository's `docs/`, for use in
  a `links.key` annotation. It returns a bare URL rather than a finished
  `x-taplo` object specifically so that two `taplo({ links: { key:
  docs(...) } })` results spread into the same `.annotate({...})` call do
  not clobber each other's single `x-taplo` object[^annotations].

Both helpers' results are spread at the **top level** of `.annotate({
...tombi({...}), ...taplo({...}), title: "..." })` — v4's `Schema.annotate`
has no `jsonSchema` sub-annotation to nest non-standard keys under, unlike
the prior generation of this mechanism.

## The `Json` schema for arbitrary-JSON positions

Schema positions that accept arbitrary JSON-compatible values — the
inline `value`-kind resource group entries in `common.ts`, `resolve.value`
entries in `credentials.ts`, and the settings group's pass-through index
signature in `config.ts` — use Effect's `Schema.Json` rather than
`Schema.Unknown`, so the published JSON Schema emits an open `{}` at that
position instead of an unknown-type `$id` or a rejection.

## What stays stable

Both published schemas reject unknown top-level keys, because both
`reposets.config.toml` and `reposets.credentials.toml` decode strictly
against `ConfigSchema` and `CredentialsSchema` — a schema that tolerated
an excess property an actual load would reject would validate configs
that then fail to load. See
[`schemastore-config-not-a-script`](../decisions/schemastore-config-not-a-script.md)
for why the schema declares this rather than pinning it directly.

[^schemastore-config]: `package/lib/configs/schemastore.config.ts`
[^annotations]: `package/src/schemas/annotations.ts`
[^turbo-json]: `package/turbo.json`
[^catalog-json]: `` package/schemas/catalog.json ``
