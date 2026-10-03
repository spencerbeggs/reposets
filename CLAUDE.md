# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Design knowledge lives in the bundle

This repository's design knowledge — architecture, service boundaries, config format, CLI behavior, decisions, gotchas, invariants — is an [OKF](https://github.com/spencerbeggs/okfit) bundle under `okf/`. Start at `okf/index.md`, which lists every subdirectory, and read `okf/project.md` for what this repository is and its non-goals. Load the concept relevant to the subsystem you are touching; do NOT load the whole bundle at once. The `mcp__plugin_okfit_mcp__*` tools (`list_concepts`, `get_concept`, `concept_neighbors`, `describe_vocabulary`, `validate_bundle`, `stale_report`) are the preferred way to browse it; `pnpm exec okfit validate .` is the shell fallback.

A first-turn shortlist:

- `okf/modules/reposets.md` — the one workspace package: CLI, sync engine, phases, services
- `okf/interfaces/cli.md` — the command tree, flags, prompts, output channels, and exit-code promises
- `okf/decisions/adopt-interactive-cli-kit-v2.md` — audience-aware output, prompts with non-interactive answers, the sync live view
- `okf/interfaces/config-file.md` — `reposets.config.toml`'s shape
- `okf/interfaces/credentials-file.md` — `reposets.credentials.toml`'s shape
- `okf/conventions/*` — imports, code style, Effect patterns, commits
- `okf/runbooks/sandbox-campaign.md` — activating the gitignored sandbox config for live testing
- `okf/gotchas/test-run-rewrites-schemas.md` — why `pnpm run lint` fails right after `pnpm run test`
- `okf/gotchas/pnpm-exec-runs-the-dev-build.md` — why a source change looks invisible until rebuilt
- `okf/gotchas/nul-bytes-hide-from-grep.md` — why a plain `grep` can silently miss a match in the store
- `okf/gotchas/log-level-none-still-prints-reports.md` — why `--log-level none` does not silence a report

## Commands

```bash
pnpm run build         # turbo build:dev + build:prod (schema:build runs first)
pnpm run typecheck     # turbo types:check across workspaces — the one that checks package/src and package/__test__
pnpm run types:check   # tsc --noEmit at the repo root: root-level files only (vitest config, lib/configs), none of package/
pnpm exec reposets     # run the CLI from the dev build (node_modules/reposets -> package/dist/dev/pkg)
pnpm run test          # vitest run; coverage is always on
pnpm run test:watch
pnpm run test:coverage
pnpm run lint          # biome check
pnpm run lint:fix
pnpm run lint:md
pnpm run lint:md:fix
pnpm --filter reposets schema:build   # regenerate the root schemas/ (schemas/<version>/<name>.json + catalogs)
pnpm --filter reposets schema:check   # CI gate: 0 clean, 1 drift/stale/gate failure, 2 config problem
```

`pnpm run test` rewrites `schemas/**/*.json` unformatted, which then fails `pnpm run lint` until `lint:fix` runs — see `okf/gotchas/test-run-rewrites-schemas.md`.

## Repository layout

pnpm workspace monorepo orchestrated by Turbo. One package: `package/` (workspace name `reposets`).

```text
package/src/cli/          # entrypoint (CliRuntime.main from @effected/cli), the --config global flag
package/src/cli/commands/ # one file per subcommand
package/src/cli/views/    # the sync live view: a JSX-free model and the one .tsx module, loaded only when drawing
package/src/services/     # ConfigFiles, CredentialResolver, Invocation, OnePasswordClient, SyncLogger
package/src/store/        # AppliedState, SyncJournal, RepoCache, migrations (SQLite via @effected/app)
package/src/sync/         # SyncEngine, the Phase contract, decide(); phases/ holds one module per phase
package/src/schemas/      # Effect Schema: config, credentials, common, environment, ruleset, annotations, hosted (schema URLs)
package/src/lib/          # config-refs, org-only, credential-labels, fingerprint
package/lib/configs/      # schemastore.config.ts (identities in src/schemas/hosted.ts)
package/__test__/         # tests mirroring src/
schemas/                  # generated versioned JSON schemas (<version>/<name>.json), catalog.json, catalogs/
lib/configs/              # commitlint, lint-staged, markdownlint
```

There is no `package/src/services/github/` and no `package/src/lib/crypto.ts`. Every GitHub resource service, and the libsodium sealed-box encryption for secrets, is upstream in `@effected/github` — read that package rather than looking for a wrapper here. Likewise the CLI logger, exit-code handling, audience-aware output, prompts, the live view and schema-issue rendering are upstream in `@effected/cli`; `package/src/cli/index.ts` is the only file that reads `process` (see `okf/conventions/effect-patterns.md`).

## Build system

`package/` builds with `@savvy-web/bundler`, driven by `package/savvy.build.ts` (`node savvy.build.ts --target dev|prod`). Turbo tasks, with `package/turbo.json` extending the root: `schema:build` (cached, both build tasks depend on it), `schema:check` (uncached CI gate), `build:dev` → `dist/dev/pkg/`, `build:prod` → `dist/prod/npm/pkg/` and `dist/prod/github/pkg/`, `types:check` → `tsc --noEmit`. Dual registry publishing (npm `reposets` and GitHub Packages `@spencerbeggs/reposets`) is detailed in `okf/modules/workspace.md`.

## TypeScript

TypeScript 7 (the native compiler, invoked as `tsc`), no project references. Target `es2025`, module/resolution `nodenext`, strict, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. The root `skipLibCheck: true` is a **temporary** workaround: `effect@4.0.0`'s declarations still reference DOM-only types (`TextDecoderOptions` in `Channel.d.ts`, `Transferable` in `rpc/RpcClient.d.ts`) that a Node-only `lib` lacks — remove it once an `effect` release ships without them.

## reposets CLI

CLI for syncing GitHub repository settings, secrets, variables, rulesets, deployment environments, repository security features and CodeQL default setup across personal and organization repos. Built on **`effect/cli`, from core** — see the three warnings below and `okf/interfaces/cli.md` for the full command tree, flags and exit codes; `okf/interfaces/config-file.md` and `okf/interfaces/credentials-file.md` for the two TOML files' shapes; `okf/interfaces/json-schemas.md` for how the versioned `schemas/<version>/*.json` at the repo root are built and how `init` stamps their `#:schema` URLs; `okf/interfaces/token-permissions.md` for the required fine-grained PAT scopes.

## Three early traps

- **`@effect/cli` does not exist on the Effect v4 line.** Use `effect/cli` instead.
- **There is no `package/src/services/github/`.** Every GitHub resource service lives upstream in `@effected/github` — read that package.
- **`blakejs` is CommonJS.** Default-import then destructure: `import { blake2bHex } from "blakejs"` builds cleanly and throws at runtime.

## Conventions

Imports, code style, Effect patterns and commit format are documented in `okf/conventions/*` — load the relevant one rather than duplicating it here.
</content>
