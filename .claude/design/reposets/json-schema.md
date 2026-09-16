---
module: reposets
title: JSON Schema Generation
category: other
status: current
completeness: 90
created: 2026-06-12
updated: 2026-09-16
last-synced: 2026-09-16
related:
  - config-format.md
  - services.md
  - architecture.md
  - session-handoff.md
dependencies: []
---

## Overview

The Effect Schema definitions that validate `reposets.config.toml` and `reposets.credentials.toml` also generate JSON schemas for editor TOML language servers. This is a build-time subsystem, separate from runtime config loading. It is declared, not scripted: `package/lib/configs/schemastore.config.ts` is a `defineConfig({ ... })` from `@effected/schemastore`, executed by the `schemastore` bin from `@effected/schemastore-cli`. Output lands in `package/schemas/` ahead of the package builds via the `schema:build` Turbo task. The config TOML format itself is documented in `config-format.md`.

## Why a config and a CLI, not a script

The previous hand-rolled generator (`package/lib/scripts/generate-json-schema.ts`, run by `tsx` as `generate:json-schema`) composed `StoreDocument`, `SchemaValidator` and `SchemaFile` itself. `@effected/schemastore` 0.12 moved the ajv validation engine out of the library into `@effected/schemastore-cli` (`AjvValidator.layer`); the library now ships only the contract, so `SchemaValidator.layer` no longer exists. The script stopped typechecking and, at runtime, threw `Cannot read properties of undefined (reading 'build')` from inside `Layer.mergeAll`. The bump arrived through the `@effected/pnpm-plugin-effect` catalog, which is why it surfaced as a dependency update rather than a code change.

The replacement is the library's intended shape: the config describes the documents, the CLI owns build, validate and write. Two consequences worth knowing:

- The library and CLI are pinned as a fixed pair (both `catalog:effected`, 0.12.0) because the CLI's peer range on the library is exact. Bump them together.
- `tsx` is no longer a package devDependency. Nothing else here needed it.

## Scripts and Turbo wiring

- `schema:build` — `schemastore build lib/configs/schemastore.config.ts`. Cached on `src/schemas/**` plus the config file, outputs `schemas/**`. `build:dev` and `build:prod` depend on it.
- `schema:check` — `schemastore check lib/configs/schemastore.config.ts`. The CI gate; uncached. Exit codes: 0 clean, 1 drift, stale output or gate failure, 2 config problem, 64 usage.

Both are in `package/package.json` and `package/turbo.json`; read those for the current wiring rather than this list.

## Decisions in the config

The config is short; the reasoning behind its values is what is not obvious from reading it.

- **`outputDir: "../../schemas"`.** Relative paths resolve against the config file's directory, never cwd. The config lives two levels down in `package/lib/configs/`.
- **Entry keys are the file base names.** `reposets.config.schema` and `reposets.credentials.schema`, each `layout: "flat"` with no `versions`, under `baseUrl` pointing at the raw GitHub URL for `package/schemas/` on `main`. There is no `$id` override in `defineConfig` — you cannot spell it by hand — so the key, the layout and the base URL are the only levers, and together they derive a `$id` byte-identical to the URLs the SchemaStore catalog already pins. This was verified before anything was rewritten: `schemastore check` reported both documents `unchanged` against the committed files.
- **`published: true` on both, top-level `drift: "allow"`.** The schemas are genuinely in the SchemaStore catalog, but unversioned — the catalog points at `main`, the moving edge — so a `DRIFT contract` gate would have no label to bump into. `drift: "allow"` preserves the old generator's regenerate-in-place behaviour while `published: true` records the truth about who depends on them. If the schemas ever adopt `versions`, revisit this.
- **`catalog: { description, fileMatch }` blocks** are copied from the live SchemaStore catalog entries. They produce a committed artifact, `package/schemas/catalog.json`, whose `name` and `url` derive from the entry key.
- **No `jsonSchema: { onExcessProperty: "error" }` pin.** 0.12 closes generated objects by default. Both TOML files decode strictly, so the published schema must reject unknown keys too, and now it does without pinning.

Strict validation — ajv strict mode plus the annotation-placement checks, with the `x-taplo` and `x-tombi-*` keyword families carried through the Draft-07 lowering — is now the CLI's job. A misplaced annotation still fails the build rather than silently degrading someone's editor.

Writing is content-comparing: files under `package/schemas/` are rewritten only when the content changed. `unchanged` means "the file already matches what I would write", not "the schema did not change" — a distinction that cost three wrong conclusions during the campaign.

Both files get a schema. Withholding one costs nothing at build time and shows up only as an editor that silently stops completing a file people edit by hand.

## Annotations

Two typed helpers attach language-server annotations. **They live in `package/src/schemas/annotations.ts`, not in the kit.** v3 imported them from `xdg-effect`, which re-exported them from `json-schema-effect`; both are gone and `@effected/schemastore` ships the other half of the mechanism — the keyword families and `defineConfig` — but no constructors. They are local rather than inlined because they have roughly fifty call sites, which is where the exact key spellings would otherwise drift. The 0.12 migration did not touch them.

- `tombi({ ... })` builds `x-tombi-*` keys for the Tombi TOML LSP (key ordering, array ordering, string formats, TOML version and similar). These are separate top-level keys.
- `taplo({ ... })` builds one `x-taplo` object for the Taplo TOML LSP (scaffolding `initKeys` and documentation `links.key`). Taplo ignores `x-taplo` on a node that also carries `$ref`, and the helper does not work around it.
- `docs(page)` returns the URL of a page under the repository's `docs/`, for a `links.key` annotation. It returns a URL rather than a finished `x-taplo` object on purpose: two `taplo()` results spread into one `annotate` would overwrite each other's `x-taplo`.

**The results go at the top level of `.annotate({ ... })`.** v3 nested them under a `jsonSchema` annotation; v4 has no such annotation, so spread them in: `.annotate({ ...taplo({ ... }), title: "..." })`. Standard annotations (`title`, `description`, `examples`, `default`) are set directly.

## Jsonifiable type

Schema positions that accept arbitrary JSON-compatible values (settings pass-through and inline credential values) use a `Json` schema rather than `Schema.Unknown`, so generated schemas emit `{}` instead of an unknown-schema `$id`. The positions that use it are the resource value kind in `common.ts`, resolve value entries in `credentials.ts` and the settings group index signature in `config.ts`.

## Dependencies

`@effected/schemastore` provides `defineConfig` and the schema contract; `@effected/schemastore-cli` provides the `schemastore` bin that builds, validates and writes. The `tombi()` / `taplo()` / `docs()` annotation helpers are local to this repository.

Running `pnpm run test` regenerates `package/schemas/*.json`: `vitest.setup.ts` runs `turbo run build:dev` as a global setup, and `build:dev` depends on `schema:build`. So the test suite mutates tracked files and writes them unformatted — `pnpm test` followed by `pnpm lint` fails on formatting until `lint:fix` folds them back.
