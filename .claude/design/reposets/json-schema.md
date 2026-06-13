---
module: reposets
title: JSON Schema Generation
category: other
status: current
completeness: 90
created: 2026-06-12
updated: 2026-06-12
last-synced: 2026-06-12
related:
  - config-format.md
  - services.md
  - architecture.md
dependencies: []
---

## Overview

The Effect Schema definitions that validate `reposets.config.toml` and `reposets.credentials.toml` also generate JSON schemas for editor TOML language servers. This is a build-time subsystem, separate from runtime config loading. The generation script is `package/lib/scripts/generate-json-schema.ts`; output lands in `package/schemas/` and runs ahead of the package builds via the `generate:json-schema` Turbo task. The config TOML format itself is documented in `config-format.md`.

## Generation pipeline

The script uses xdg-effect's `JsonSchemaExporter` and `JsonSchemaValidator` in a `generateMany` -> `validateMany` -> `writeMany` sequence:

1. `generateMany()` produces schemas from the schema definitions, root def names and `$id` URLs.
2. `validateMany()` runs strict-mode validation; the custom extension keywords (`x-tombi-*`, `x-taplo`) are handled inside the validator service.
3. `writeMany()` writes to `package/schemas/`, only when content changed.

The `$id` of each schema points at the raw GitHub hosting URL for the corresponding file under `package/schemas/`, so editors can fetch the published schema.

## Annotations

Two typed helpers from xdg-effect attach language-server annotations through the `jsonSchema: { ... }` annotation property:

- `tombi({ ... })` generates `x-tombi-*` annotations for the Tombi TOML LSP (key ordering, array ordering, string formats, TOML version and similar).
- `taplo({ ... })` generates `x-taplo` annotations for the Taplo TOML LSP (scaffolding `initKeys` and documentation `links.key`).

When a field needs both, the results are spread together. Standard annotations (`title`, `description`, `examples`, `default`) are set directly on fields.

## Jsonifiable type

Schema positions that accept arbitrary JSON-compatible values (settings pass-through and inline credential values) use xdg-effect's `Jsonifiable` schema rather than `Schema.Unknown`, so generated schemas emit `{}` instead of an unknown-schema `$id`. The positions that use it are the resource value kind in `common.ts`, resolve value entries in `credentials.ts` and the settings group index signature in `config.ts`.

## Dependencies

`xdg-effect` provides `JsonSchemaExporter`, `JsonSchemaValidator`, `Jsonifiable`, `tombi()` and `taplo()`.
