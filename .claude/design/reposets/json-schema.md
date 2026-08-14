---
module: reposets
title: JSON Schema Generation
category: other
status: current
completeness: 90
created: 2026-06-12
updated: 2026-08-14
last-synced: 2026-08-14
related:
  - config-format.md
  - services.md
  - architecture.md
dependencies: []
---

## Overview

The Effect Schema definitions that validate `reposets.config.toml` and `reposets.credentials.toml` also generate JSON schemas for editor TOML language servers. This is a build-time subsystem, separate from runtime config loading. The generation script is `package/lib/scripts/generate-json-schema.ts`; output lands in `package/schemas/` and runs ahead of the package builds via the `generate:json-schema` Turbo task. The config TOML format itself is documented in `config-format.md`.

## Generation pipeline

The script loops over one entry per config file, in a build -> validate -> write sequence, using `@effected/schemastore`'s `StoreDocument`, `SchemaValidator` and `SchemaFile`:

1. `StoreDocument.fromSchema(schema, { $id })` builds the document from an Effect Schema.
2. Validation runs in strict mode (Ajv strict plus annotation-placement checks); the language-server keyword families (`x-tombi-*`, `x-taplo`) are declared by `KeywordFamilies` and carried through the Draft-07 lowering, so a *misplaced* annotation is caught here rather than silently degrading someone's editor. **`SchemaValidator.validate` takes the flat JSON — `toJson()` — not the document**, because its finding paths are pointers into that shape. `SchemaFile.write` is the opposite and takes the document, so it can serialize canonically. The two are easy to swap and the failure is silent.
3. Writing is content-comparing: files under `package/schemas/` are rewritten only when the content changed. Its `unchanged` result means "the file already matches what I would write", not "the schema did not change" — a distinction that cost three wrong conclusions during the campaign.

Both files get a schema. Withholding one costs nothing at build time and shows up only as an editor that silently stops completing a file people edit by hand.

The `$id` of each schema points at the raw GitHub hosting URL for the corresponding file under `package/schemas/`, so editors can fetch the published schema.

## Annotations

Two typed helpers attach language-server annotations. **They live in `package/src/schemas/annotations.ts`, not in the kit.** v3 imported them from `xdg-effect`, which re-exported them from `json-schema-effect`; both are gone and `@effected/schemastore` ships the other half of the mechanism — `KeywordFamilies` and `StoreDocument.fromSchema` — but no constructors. They are local rather than inlined because they have roughly fifty call sites, which is where the exact key spellings would otherwise drift.

- `tombi({ ... })` builds `x-tombi-*` keys for the Tombi TOML LSP (key ordering, array ordering, string formats, TOML version and similar). These are separate top-level keys.
- `taplo({ ... })` builds one `x-taplo` object for the Taplo TOML LSP (scaffolding `initKeys` and documentation `links.key`). Taplo ignores `x-taplo` on a node that also carries `$ref`, and the helper does not work around it.
- `docs(page)` returns the URL of a page under the repository's `docs/`, for a `links.key` annotation. It returns a URL rather than a finished `x-taplo` object on purpose: two `taplo()` results spread into one `annotate` would overwrite each other's `x-taplo`.

**The results go at the top level of `.annotate({ ... })`.** v3 nested them under a `jsonSchema` annotation; v4 has no such annotation, so spread them in: `.annotate({ ...taplo({ ... }), title: "..." })`. Standard annotations (`title`, `description`, `examples`, `default`) are set directly.

## Jsonifiable type

Schema positions that accept arbitrary JSON-compatible values (settings pass-through and inline credential values) use a `Json` schema rather than `Schema.Unknown`, so generated schemas emit `{}` instead of an unknown-schema `$id`. The positions that use it are the resource value kind in `common.ts`, resolve value entries in `credentials.ts` and the settings group index signature in `config.ts`.

## Dependencies

`@effected/schemastore` provides `StoreDocument`, `SchemaValidator` and `SchemaFile`. The `tombi()` / `taplo()` / `docs()` annotation helpers are local to this repository.

Running `pnpm run test` regenerates `package/schemas/*.json`: `vitest.setup.ts` runs `turbo run build:dev` as a global setup, and `build:dev` depends on `generate:json-schema`. So the test suite mutates tracked files and writes them unformatted — `pnpm test` followed by `pnpm lint` fails on formatting until `lint:fix` folds them back.
