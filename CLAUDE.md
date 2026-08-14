# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Design documentation

Load the relevant doc when working on that subsystem. Do NOT load all of them at once.

- Architecture, layer composition, the phase pipeline, drift detection and local state → `@./.claude/design/reposets/architecture.md`
- Each service's responsibility and the boundaries between them → `@./.claude/design/reposets/services.md`
- TOML config and credentials format, and the 1.0 breaking changes → `@./.claude/design/reposets/config-format.md`
- Command surface, flags and output decisions → `@./.claude/design/reposets/cli.md`
- Build-time JSON schema generation → `@./.claude/design/reposets/json-schema.md`
- Sandbox repositories and live testing → `@./.claude/design/reposets/sandbox.md`
- What running the CLI against real repositories found, wave by wave → `@./.claude/design/reposets/cli-campaign-journal.md`
- Where the current work stands and the traps that cost time → `@./.claude/design/reposets/session-handoff.md`

## Commands

```bash
pnpm run build         # turbo build:dev + build:prod (generate:json-schema runs first)
pnpm run typecheck     # turbo types:check across workspaces
pnpm run types:check   # tsc --noEmit at the repo root
pnpm cli               # run the CLI from source: tsx package/src/cli/index.ts
pnpm run test          # vitest run; coverage is always on
pnpm run test:watch
pnpm run test:coverage
pnpm run lint          # biome check
pnpm run lint:fix
pnpm run lint:md
pnpm run lint:md:fix
pnpm --filter reposets generate:json-schema   # regenerate package/schemas/
```

`pnpm run test` rewrites `package/schemas/*.json`: `vitest.setup.ts` runs `turbo run build:dev` as a global setup and `build:dev` depends on `generate:json-schema`. It writes them unformatted, so `pnpm run lint` fails on formatting after a test run until `lint:fix` folds them back. Expect it — it is not a regression.

## Repository layout

pnpm workspace monorepo orchestrated by Turbo. One package: `package/` (workspace name `reposets`).

```text
package/src/cli/          # entrypoint, the --config global flag, CliLogger
package/src/cli/commands/ # one file per subcommand
package/src/services/     # ConfigFiles, CredentialResolver, OnePasswordClient, SyncLogger
package/src/store/        # AppliedState, SyncJournal, RepoCache, migrations (SQLite via @effected/app)
package/src/sync/         # SyncEngine, the Phase contract, decide(); phases/ holds one module per phase
package/src/schemas/      # Effect Schema: config, credentials, common, environment, ruleset, annotations
package/src/lib/          # config-refs, org-only, credential-labels, fingerprint, schema-issues
package/lib/scripts/      # generate-json-schema.ts
package/__test__/         # tests mirroring src/
lib/configs/              # commitlint, lint-staged, markdownlint
```

There is no `package/src/services/github/` and no `package/src/lib/crypto.ts`. Every GitHub resource service, and the libsodium sealed-box encryption for secrets, is upstream in `@effected/github`. Read that package rather than looking for a wrapper here.

## Build system

`package/` builds with `@savvy-web/bundler`, driven by `package/savvy.build.ts` (`node savvy.build.ts --target dev|prod`). Turbo tasks, with `package/turbo.json` extending the root:

- `generate:json-schema` — `tsx lib/scripts/generate-json-schema.ts`; both build tasks depend on it
- `build:dev` → `dist/dev/pkg/`
- `build:prod` → `dist/prod/npm/pkg/` and `dist/prod/github/pkg/`
- `types:check` → `tsc --noEmit`

Dual registry, from `publishConfig.targets`: npm (`reposets`) and GitHub Packages (`@spencerbeggs/reposets`).

## TypeScript

- TypeScript 7, the native compiler, invoked as `tsc`. No project references.
- Root `tsconfig.json` extends `@savvy-web/silk/tsconfig/node/root.json`; `package/tsconfig.json` extends `@savvy-web/bundler/tsconfig/ecma.json`.
- Target `es2025`, module and resolution `nodenext`, strict, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- The root `skipLibCheck: true` is a **temporary** workaround for a broken declaration in `effect@4.0.0-beta.107`. Remove it once a fixed beta ships.

## reposets CLI

CLI for syncing GitHub repository settings, secrets, variables, rulesets, deployment environments, repository security features and CodeQL default setup across personal and organization repos.

- Built on **`effect/unstable/cli`, from core**. `@effect/cli` does not exist on the Effect v4 line — do not reach for it.
- `package/src/cli/index.ts` bootstraps `App.layer` (`@effected/app`) and provides `ConfigLive`, `CredentialsFilesLive` and `SyncJournalLive` once at the root command.
- All async work is modeled as Effect programs.

### CLI commands

Global flag: `--config` (a path to `reposets.config.toml`, or a directory containing it). Core contributes `--help`, `--version`, `--wizard` and `--log-level`.

`--log-level` is **core's own severity filter** (`all|trace|debug|…|none`) and it is the per-run silencer. There is no `log_level` config key and no verbosity tiers — 1.0 deleted both. Output is one level, plus `--debug` on `sync` and `drift` for two diagnostic suffixes.

- `sync` — apply the config to every repo in a group, or all groups. `--dry-run`, `--no-cleanup`, `--fail-on-drift`, `--group`, `--repo`, `--debug`, and `--only`/`--skip` to select phases by name (`--only` wins over `--skip`)
- `drift` — report resources changed outside reposets and change nothing; exits non-zero when drift is found. It is `sync --dry-run --no-cleanup --fail-on-drift` through the same handler, deliberately
- `list`, `validate`, `doctor`
- `history` [`--limit`, `--repo`], with `show --run <id-or-prefix>`, `prune --keep <n>` and `clear`. Both deletions leave applied state and the cache alone, so drift detection still works
- `init [--project]` — scaffold both TOML files into the XDG config dir, or into cwd with `--project`
- `nuke [--force]` — delete every reposets file on this machine. Nothing on GitHub is touched, and it refuses a non-interactive shell without `--force`
- `credentials create|list|delete` — manage named profiles; `create` takes exactly one of `--username`/`--org` and one of `--op`/`--env`

`validate` and `doctor` run offline and check reference integrity (`danglingReferences`), organization-only constructs (`orgOnlyViolations`) and undeclared credential labels (`undefinedCredentialLabels`) — pure functions in `package/src/lib/`, called by the commands. They are **not** registered on the config spec's `validate` callback: v3's `validateConfigRefs` is gone, and the rebuild's loss of it made a misspelled section name sync nothing, report nothing and exit 0. `sync` runs `danglingReferences` before it writes.

`doctor` prints migration hints for the keys 1.0 removed (`owner`, `owner` inside a group, `log_level`) rather than reporting them as unknown keys.

### Services

Four services live here: `ConfigFiles` (`ReposetsConfigFile` + `ReposetsCredentialsFile` over `@effected/config-file`, both decoding strictly), `CredentialResolver`, `OnePasswordClient` and `SyncLogger`. Three store services — `AppliedState`, `SyncJournal`, `RepoCache` — are wired by `App.layer`.

`SyncEngine` walks a list of `Phase` values, which are **data** rather than a hardcoded sequence — that is what lets `--only`/`--skip` select a subset. `PHASE_NAMES` is the order and the array is the contract: settings → security → code-scanning → environments → secrets → variables → rulesets → cleanup. Environments must exist before environment-scoped secrets, and `cleanup` runs last because every other phase's writes define what "declared" means.

`sync` merges eight `@effected/github` services over `GitHubClient.layerFromToken({ token })`. A token is fixed at client construction, so `sync` partitions groups by credential profile and runs one engine per partition, while providing journal, logger, cache and resolver **once** around the whole loop.

### Configuration files

Lookup order, first match wins: `--config`, then an upward walk from cwd for `reposets.config.toml`, then `~/.config/reposets/` (respecting `$XDG_CONFIG_HOME`). `--config` **replaces** the walk rather than preceding it, and a `--config` path that does not exist fails instead of falling through.

| File | Contents |
| :--- | :------- |
| `reposets.config.toml` | `[settings.*]`, `[secrets.*]`, `[variables.*]`, `[rulesets.*]`, `[environments.*]`, `[security.*]`, `[code_scanning.*]` and `[groups.*]`. Every section defaults to `{}` |
| `reposets.credentials.toml` | `[profiles.<name>]` with exactly one of `username`/`org`, a `github_token` **reference**, an optional `op_service_account`, and an optional `[resolve]` section |

1.0 breaking changes, all load-bearing:

- **No `owner` in the config**, at top level or per group. The owner is a property of the credential profile, which declares exactly one of `username` or `org`. The declared type is what lets `validate` reject org-only constructs offline; `sync` still verifies it against GitHub before writing.
- **`credentials` is required on every `[groups.*]`**, and it selects the profile's **token**, not only its `[resolve]` values.
- **Tokens are never stored on disk.** `github_token` is `{ op = "op://..." }` or `{ env = "VAR" }`. `op_service_account` is an `{ env }` reference; the 1Password service-account token itself comes from `OP_SERVICE_ACCOUNT_TOKEN`.
- **`log_level` and the four verbosity tiers are deleted.**

`[resolve]` has four sub-groups — `op`, `env`, `file` and `value` — contributing to one flat label namespace. Secret and variable groups are discriminated unions of exactly one kind: `{ file }`, `{ value }` or `{ resolved }`. Cleanup is per group, each scope a three-way `CleanupScope`: `false`, `true`, or `{ preserve = [...] }`; security and code scanning have no cleanup scope, so omitted means leave alone. Keep `reposets.credentials.toml` out of version control.

### JSON schema

`package/lib/scripts/generate-json-schema.ts` builds `package/schemas/` from `ConfigSchema` and `CredentialsSchema` using `@effected/schemastore`: `StoreDocument.fromSchema` → `SchemaValidator.validate` in strict mode → `SchemaFile.write`. The `tombi()` / `taplo()` / `docs()` annotation helpers are **local**, in `package/src/schemas/annotations.ts`, and their results spread at the top level of `.annotate({ ... })` — v4 has no `jsonSchema` annotation to nest them under.

### Token permissions

A fine-grained personal access token is required. `REQUIRED_PERMISSIONS` in `package/src/cli/commands/doctor.ts` is the authority and `doctor` prints it — read it there rather than duplicating the list. Two entries are counterintuitive and easy to "fix" wrongly: **Repository > Actions is Read**, because the code-scanning phase only counts workflow files, and there is **no account-level permission** — v3 listed `Account permissions > GPG keys` as the secrets-encryption scope, which was wrong. Secret public keys come from repository-scoped endpoints already covered by Secrets.

## Conventions

### Imports

- `.js` extensions on relative imports (enforced by Biome's `useImportExtensions`)
- `node:` protocol for Node built-ins (`useNodejsImportProtocol`)
- `import type` for type-only imports
- `blakejs` is **CommonJS**: default-import then destructure. `import { blake2bHex } from "blakejs"` builds cleanly and throws at runtime

### Code style (Biome)

`biome.jsonc` extends `@savvy-web/silk/biome`. Tabs, 120-column lines, no unused variables, no import cycles. `useExplicitType` is **off** — explicit return types are a house convention here, not a lint error.

### Effect patterns

- Services are `Context.Service` classes; layers via `Layer.effect` / `Layer.succeed`
- Errors are tagged data classes extending `Data.TaggedError`
- CLI commands use `Effect.log`/`Effect.logError`, never `Console.log`; `CliLogger` routes Error and Fatal to stderr and reads `Console` off the fiber
- All sync output flows through `SyncLogger` rather than direct console calls
- Resolved credentials are `Redacted.Redacted<string>`; unwrap only where a value must physically leave the process
- I/O wrapped in `Effect.try` / `Effect.tryPromise`
- Provide layers at the entrypoint and in per-command handlers, never inside service implementations

### Commits

- Conventional commit format required (commitlint)
- Types: build, chore, ci, docs, feat, fix, perf, refactor, release, revert, style, test
- DCO signoff required: `Signed-off-by: Name <email>`
