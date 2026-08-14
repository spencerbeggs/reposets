# Contributing to reposets

## Prerequisites

- Node.js (version declared in the `engines` field of `package/package.json`)
- pnpm (version managed via `packageManager` field — use corepack or install directly)

## Setup

```sh
git clone https://github.com/spencerbeggs/reposets.git
cd reposets
pnpm install
```

## Development commands

| Command | Description |
| :--- | :--- |
| `pnpm run build` | Build all packages |
| `pnpm run test` | Run all tests |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run test:coverage` | Run tests with a coverage report |
| `pnpm run typecheck` | Type-check all workspaces |
| `pnpm run lint` | Check lint errors (Biome) |
| `pnpm run lint:fix` | Auto-fix lint issues |
| `pnpm run lint:md` | Lint markdown files |
| `pnpm cli` | Run the CLI from source |

`pnpm cli` takes the same arguments as the published binary:

```bash
pnpm cli --help
# DESCRIPTION
#   Sync GitHub repository settings across repos from a TOML config
# ...
```

## Code style

Biome handles formatting (tabs, 120 char width). Pre-commit hooks run automatically via Husky + lint-staged.

- Use `.js` extensions for relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins
- Use `import type` for type-only imports

## Commit conventions

Conventional commits are required and enforced by commitlint. Format: `type(scope): subject`.

Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `release`, `revert`, `style`, `test`.

DCO signoff is required, so every commit must end with `Signed-off-by: Your Name <your@email.com>`.

```text
feat(cli): add --group flag to drift command

Signed-off-by: Your Name <your@email.com>
```

## Pull requests

Branch from `main`, keep changes focused, and ensure the following pass before opening a PR:

- `pnpm run test` — all tests pass
- `pnpm run lint` — no lint errors

Open a PR with a clear description of what changed and why.

## Architecture

This project uses Effect for all async work and service composition. See `.claude/design/` for architecture docs if you need deeper context.
