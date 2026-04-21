# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

**For detailed design documentation:**

- Architecture and data flow:
  `@./.claude/design/repo-sync/architecture.md`
- Effect services API:
  `@./.claude/design/repo-sync/services.md`
- Configuration format and schemas:
  `@./.claude/design/repo-sync/config-format.md`
- CLI commands and options:
  `@./.claude/design/repo-sync/cli.md`

Load the relevant design doc when working on that subsystem. Do NOT load
all of them at once.

## Commands

```bash
# Development
pnpm run build             # Build all packages (types:check + generate:json-schema + dev + prod via Turbo)
pnpm run build:dev         # Build development bundles only
pnpm run build:prod        # Build production bundles only
pnpm run typecheck         # Type-check all workspaces via Turbo

# Run CLI locally
pnpm sync                  # Alias: tsx package/src/cli/index.ts

# Testing
pnpm run test              # Run all tests (186 passing)
pnpm run test:watch        # Run tests in watch mode
pnpm run test:coverage     # Run tests with coverage report

# Linting
pnpm run lint              # Check for lint errors
pnpm run lint:fix          # Auto-fix lint issues
pnpm run lint:md           # Lint markdown files
pnpm run lint:md:fix       # Auto-fix markdown issues
```

## Architecture

### Monorepo Structure

pnpm workspace monorepo using Turbo for orchestration. The CLI package lives
at `package/` (workspace name: `repo-sync`).

```text
package/                   # repo-sync CLI package
package/src/cli/           # CLI entrypoint and commands
package/src/services/      # Effect services (6 services, 19 GitHubClient methods)
package/src/schemas/       # Effect Schema definitions (config, credentials, environment, ruleset) + JSON schema generation
package/src/lib/           # Utilities (XDG paths, config resolution, crypto)
package/__test__/          # Tests mirroring src/ structure
lib/configs/               # Shared config files (commitlint, lint-staged, markdownlint)
```

### Package Build System

`package/` uses Rslib (via `@savvy-web/rslib-builder`) with three Turbo tasks:

- `types:check` - `tsgo --noEmit`
- `generate:json-schema` - runs before builds; outputs to `package/schemas/`
- `build:dev` - depends on `types:check` + `generate:json-schema`; outputs to `dist/dev/`
- `build:prod` - depends on `types:check` + `generate:json-schema`; outputs to `dist/npm/` and `dist/github/`

The `package/package.json` `private: true` is intentional — rslib-builder
transforms it during build. Do not remove it or manually modify export paths.

Publishing targets (dual registry):

- GitHub Packages (`@spencerbeggs/repo-sync`) → `dist/github/`
- npm (`repo-sync`) → `dist/npm/`

### TypeScript Configuration

- Root `tsconfig.json` uses project references to `package/`
- Typecheck uses `tsgo` (TypeScript native preview) instead of `tsc`
- Target: ES2022/ES2023, Module: NodeNext/bundler resolution
- Strict mode enabled

### repo-sync CLI (`package/`)

CLI tool for syncing GitHub repository settings, secrets, variables,
rulesets, and deployment environments across personal repos.

- Built with `@effect/cli` (not Commander.js)
- All async work is modeled as Effect programs
- `package/src/cli/index.ts` - Root command and runtime bootstrap
- `package/src/cli/commands/` - One file per subcommand

#### CLI Commands

Global option: `--log-level silent|info|verbose|debug` (overrides
`log_level` in config, defaults to `info`)

- `sync` - Apply config to all repos in a group (or all groups)
- `list` - Show config summary (groups, repos, settings, credentials,
  secrets, variables, rulesets)
- `validate` - Validate `repo-sync.config.toml` against schema
- `doctor` - Check environment: config file, credentials, token permissions
- `init` - Scaffold `repo-sync.config.toml` in the current or XDG directory
- `credentials create|list|delete` - Manage named credential profiles in
  `repo-sync.credentials.toml`

#### Effect Services

Six services compose the sync pipeline:

- `ConfigLoader` — Parses and validates TOML config/credentials via
  Effect Schema
- `CredentialResolver` — Resolves named values from credential profile
  `[resolve]` sections (value, file, and op sub-groups)
- `OnePasswordClient` — Wraps `@1password/sdk` for 1Password secret references
- `GitHubClient` — Octokit wrapper (19 methods); handles settings
  (REST + GraphQL mutation), secrets by scope
  (actions/dependabot/codespaces/environments), variables by scope
  (actions/environments), rulesets, and deployment environments
- `SyncEngine` — Orchestrates the full sync lifecycle: environments synced
  before secrets/variables so scoped resources can attach; per-group cleanup
  using three-way `CleanupScope` union
- `SyncLogger` — Tiered output (silent/info/verbose/debug) with dry-run
  awareness; all sync output flows through this service

#### Configuration Files

Config lookup order (first match wins):

1. `--config` flag (explicit path or directory)
2. Walk up from `cwd` looking for `repo-sync.config.toml`
3. XDG fallback: `~/.config/repo-sync/repo-sync.config.toml`
   (respects `$XDG_CONFIG_HOME`)

| File | Purpose |
| :--- | :------ |
| `repo-sync.config.toml` | Owner, `log_level`, typed `[settings.*]` groups (20+ known fields + pass-through; `has_sponsorships`/`has_pull_requests` via GraphQL), secret groups (file/value/resolved kinds), variable groups, `[rulesets.*]` (discriminated union by `type`: branch/tag, 22 rule types, shorthand fields normalized via `normalizeRuleset()`), `[environments.*]` deployment environment definitions, per-group `cleanup` config, and `[groups.*]` sections mapping repos to resources |
| `repo-sync.credentials.toml` | Named credential profiles (`[profiles.<name>]`) with `github_token`, optional `op_service_account_token`, and optional `[resolve]` section (op/file/value sub-groups for named values) |

Credentials are stored in the XDG config dir (`~/.config/repo-sync/`) by
default. Keep `repo-sync.credentials.toml` out of version control.

Key naming: config top-level uses `[groups.<name>]` (not `repos`) and
`[environments.<name>]` for deployment environment definitions. Each group
has a `repos` array (not `names`). Secrets are assigned via a `SecretScopes`
struct: `actions`, `dependabot`, `codespaces` (arrays of group names), and
`environments` (record mapping env names to group name arrays). Variables
use a `VariableScopes` struct: `actions` and `environments`. Secret/variable
groups themselves are discriminated unions of exactly one kind: `{ file }`,
`{ value }`, or `{ resolved }`. Resolved entries map names to credential
labels from the active profile's `[resolve]` section. Cleanup config is
per-group (inside `[groups.<name>]`), not global; each scope uses a
three-way `CleanupScope` union: `false` (disabled), `true` (delete all
undeclared), or `{ preserve = [...] }`.

#### JSON Schema

Run `pnpm --filter repo-sync generate:json-schema` to regenerate
`package/schemas/`. Schema files use `x-tombi-*` annotations for
[Tombi](https://tombi-toml.github.io/tombi/) TOML language server support.

#### Fine-Grained Token Permissions

The CLI requires a fine-grained personal access token with:

- **Repository permissions > Administration** (Read and write) — settings sync
- **Repository permissions > Secrets** (Read and write) — Actions secrets
- **Repository permissions > Variables** (Read and write) — Actions variables
- **Repository permissions > Environments** (Read and write) — environment sync
- **Account permissions > GPG keys** (Read and write) — secrets encryption key

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement, enforced by Biome)
- Use `node:` protocol for Node.js built-ins (`useNodejsImportProtocol`)
- Use `import type` for type-only imports with separate type specifiers

### Code Style (Biome)

- Tabs for indentation, 120 character line width
- Import extensions enforced via `useImportExtensions`
- No unused variables, no import cycles
- Explicit return types required (`useExplicitType`)

### Effect Patterns

- Services use `Context.Tag` + `Layer.succeed` / `Layer.effect`
- Errors are tagged data classes extending `Data.TaggedError`
- All I/O wrapped in `Effect.try` / `Effect.tryPromise`
- Provide layers at the CLI entrypoint, not inside service implementations

### Commits

- Conventional commit format required (commitlint)
- Types: build, chore, ci, docs, feat, fix, perf, refactor, release, revert,
  style, test
- DCO signoff required: `Signed-off-by: Name <email>`
