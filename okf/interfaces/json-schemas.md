---
title: Published JSON schemas for reposets.config.toml and reposets.credentials.toml
description: The versioned JSON schemas under the root schemas/ directory that editors, the SchemaStore catalog and reposets init's "#:schema" line point at, and how they are built and checked.
type: Interface
kind: config
resource: ../../package/src/schemas/hosted.ts
tags: [docs, dx]
generated:
  by: okfit/claude-code
  at: 2026-10-02T17:48:12Z
  body_sha256: 1bc33422b35794f20e800e851ec9822c897a24508258f67ad4d526430ff20789
sources:
  - id: hosted
    resource: ../../package/src/schemas/hosted.ts
  - id: schemastore-config
    resource: ../../package/lib/configs/schemastore.config.ts
  - id: cli-init
    resource: ../../package/src/cli/commands/init.ts
  - id: annotations
    resource: ../../package/src/schemas/annotations.ts
  - id: turbo-json
    resource: ../../package/turbo.json
  - id: catalog-json
    resource: ../../schemas/catalog.json
  - id: catalog-slice
    resource: ../../schemas/catalogs/reposets.json
---

# Published JSON schemas for reposets.config.toml and reposets.credentials.toml

## Contract

Editor TOML language servers (Taplo, Tombi) and the SchemaStore catalog
consume two versioned JSON Schema documents at the repository root:

| File | `$id` |
| --- | --- |
| `schemas/3.0/config.json` | `https://raw.githubusercontent.com/spencerbeggs/reposets/main/schemas/3.0/config.json` |
| `schemas/3.0/credentials.json` | `https://raw.githubusercontent.com/spencerbeggs/reposets/main/schemas/3.0/credentials.json` |

Each identity is defined once, as a `HostedSchema` in
`package/src/schemas/hosted.ts` (`configSchemaHost`,
`credentialsSchemaHost`)[^hosted]. The schema build keys its entries by
`hosted.name` and passes the value as `hosted`[^schemastore-config], and
`reposets init` writes `#:schema <hosted.$id>` plus a blank line as the
first line of each file it scaffolds[^cli-init] — so the `$id` the build
writes and the URL a fresh file points at cannot disagree. To every TOML
parser the directive is a comment: `validate`, `doctor` and every other
command decode a stamped file exactly as an unstamped one.

The label `3.0` names the TOML contract, not the package version. Once a
label is published its document is never edited in a way that changes the
contract: a contract change appends a new label to the hosts' `versions`,
and the old file stays frozen on disk at its URL. Annotation-only edits
(descriptions, `x-taplo`, `x-tombi-*`) regenerate in place.

The config's `name: "reposets"` names its catalog slice,
`schemas/catalogs/reposets.json`[^catalog-slice]; the CLI merges every
slice in `schemas/catalogs/` into `schemas/catalog.json`[^catalog-json],
whose entries carry each schema's `url` and a `versions` map. An editor
using SchemaStore matches `reposets.config.toml` and
`reposets.credentials.toml` by file name once SchemaStore's own catalog
points at these URLs; a file carrying the `#:schema` directive needs no
catalog at all.

Nothing under `schemas/` ships in the npm tarball: the documents are
served from GitHub raw on `main`.

## Build and check

- `pnpm --filter reposets schema:build` (`schemastore build
  lib/configs/schemastore.config.ts`) writes both documents, the slice and
  the merged catalog. `outputDir: "../../../schemas"` resolves against the
  config file's own directory, so a root-level and a filtered run write the
  same files. Turbo caches the task on `src/schemas/**` plus the config
  file and declares `$TURBO_ROOT$/schemas/**` as its output, so a cache hit
  restores the root files; both `build:dev` and `build:prod` depend on
  it[^turbo-json].
- `pnpm --filter reposets schema:check` is the CI gate: uncached, it
  reports what a build would do and writes nothing[^turbo-json]. `0` when
  every document already matches what a build would write; `1` when a
  schema fails the lint/validation gate, a published schema drifted under
  the default `semantic` policy, or a committed document is stale; `2`
  when the config module cannot be found or fails to load; `64` for a
  usage error.

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
has no `jsonSchema` sub-annotation to nest non-standard keys under.

## The `Json` schema for arbitrary-JSON positions

Schema positions that accept arbitrary JSON-compatible values — the
inline `value`-kind resource group entries in `common.ts`, `resolve.value`
entries in `credentials.ts`, and the settings group's pass-through index
signature in `config.ts` — use Effect's `Schema.Json` rather than
`Schema.Unknown`, so the published JSON Schema emits an open `{}` at that
position instead of an unknown-type `$id` or a rejection.

## What stays stable

- The `3.0` URLs, for as long as `main` serves them; a contract change gets
  a new label, never an in-place edit.
- Both schemas reject unknown keys, because both TOML files decode
  strictly against `ConfigSchema` and `CredentialsSchema` — a schema that
  tolerated an excess property an actual load would reject would validate
  configs that then fail to load. Generated objects are closed by default,
  so nothing pins this.

See [versioned-schemas-at-the-root](../decisions/versioned-schemas-at-the-root.md)
for why the schemas are versioned and live at the root.

[^hosted]: `package/src/schemas/hosted.ts`
[^schemastore-config]: `package/lib/configs/schemastore.config.ts`
[^cli-init]: `package/src/cli/commands/init.ts`
[^annotations]: `package/src/schemas/annotations.ts`
[^turbo-json]: `package/turbo.json`
[^catalog-json]: `schemas/catalog.json`
[^catalog-slice]: `schemas/catalogs/reposets.json`
