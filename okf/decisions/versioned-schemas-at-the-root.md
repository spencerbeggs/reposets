---
title: Versioned JSON schemas at the repository root
description: Why the two published JSON schemas moved from flat, unversioned files under package/schemas/ to schemas/<version>/<name>.json at the root, with one HostedSchema identity shared by the build and init.
type: Decision
status: draft
supersedes: schemastore-config-not-a-script.md
tags: [dx, release, docs]
generated:
  by: okfit/claude-code
  at: 2026-10-02T17:48:12Z
  body_sha256: bc61a1ada6fa46d8452acb5cfaec5888d3dd6608a95b6decce138486d36e82dc
sources:
  - id: hosted
    resource: ../../package/src/schemas/hosted.ts
  - id: schemastore-config
    resource: ../../package/lib/configs/schemastore.config.ts
  - id: cli-init
    resource: ../../package/src/cli/commands/init.ts
  - id: turbo-json
    resource: ../../package/turbo.json
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-10-02T00:00:00Z
---

# Versioned JSON schemas at the repository root

## Context

Up to reposets 2.x the two JSON schemas were flat and unversioned:
`package/schemas/reposets.config.schema.json` and
`reposets.credentials.schema.json`, served from `main`, under
`published: true` with `drift: "allow"` because there was no version label
a contract change could move to. Every edit — a renamed key included — was
rewritten in place under a URL editors already pinned.

## Decision

For the 3.0.0 major the owner chose versioned schemas at the root[^owner]:

- **Layout.** `schemas/3.0/config.json` and `schemas/3.0/credentials.json`
  at the repository root, with the merged `schemas/catalog.json` and the
  `schemas/catalogs/reposets.json` slice beside them. `$id`s are
  `https://raw.githubusercontent.com/spencerbeggs/reposets/main/schemas/3.0/<name>.json`.
- **One identity, two consumers.** `src/schemas/hosted.ts` builds each
  identity once as a `HostedSchema.github({ repo, path: "schemas", name,
  versions: ["3.0"], appendVersion: false })`[^hosted]. The schema config
  keys each entry by `hosted.name` and passes `hosted`[^schemastore-config];
  `init` stamps `#:schema <hosted.$id>` as the first line of the file it
  scaffolds[^cli-init]. No URL is spelled by hand in `src/`.
- **`published: true` from day one, default `semantic` drift.** `init`
  writes these URLs into every new config, so editors depend on them from
  the release that introduces them. Annotation-only edits regenerate in
  place; a contract change is refused (`DRIFT contract`) and is answered by
  appending a new label to `versions`, leaving `3.0` frozen on disk.
  `drift: "allow"` was dropped: it existed only because there was no label
  to bump into, and keeping it would let a contract change silently rewrite
  a URL `init` has already stamped into people's files.
- **Turbo.** `schema:build` outputs `$TURBO_ROOT$/schemas/**`, so a cache
  hit restores the root files like any package-local output[^turbo-json].
- **No shipping.** The schemas are served from GitHub raw, not from the npm
  tarball; nothing under `schemas/` is in the published package.

## Why

- **Versioned:** a contract change gets a new label and a new URL instead
  of moving the document behind a URL consumers already pin. A file
  stamped against `3.0` keeps validating against the contract it was
  written for.
- **Root `schemas/`:** the served path is independent of the package's
  location in the workspace. Moving or renaming `package/` no longer moves
  a URL.
- **Delete the flat files now:** a major is the one release where a clean
  break is expected. Frozen copies under `package/schemas/` would be a
  second, unmaintained contract that nothing regenerates or gates.

## Alternatives rejected

- **Keep the flat files beside the new ones.** Two URLs per schema with
  only one gated; the old ones would rot silently.
- **Version label tracking the package version (`3.0.0`).** The label
  names the TOML contract, not the release; a 3.1.0 that leaves both file
  shapes alone keeps `3.0`.
- **`appendVersion: true` (`3.0/config-3.0.json`).** SchemaStore's own
  convention, but redundant under a version directory; this matches the
  okfit repository's layout.

## Consequences

- SchemaStore's upstream catalog entry still points at the old
  `package/schemas/` URLs, which no longer exist on `main`. Editors that
  resolve through SchemaStore lose completion until the owner's upstream
  catalog update lands; files scaffolded by `init` are unaffected because
  their `#:schema` line binds the schema directly.
- A future contract change is a config edit (a new label, made current)
  plus a new frozen file, never `--force`.

[^owner]: conversation with the repository owner
[^hosted]: `package/src/schemas/hosted.ts`
[^schemastore-config]: `package/lib/configs/schemastore.config.ts`
[^cli-init]: `package/src/cli/commands/init.ts`
[^turbo-json]: `package/turbo.json`
