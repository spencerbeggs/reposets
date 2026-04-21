# Contributing to reposets

## Prerequisites

- Node.js >= 20
- pnpm (version managed via `packageManager` field — use corepack or install directly)

## Setup

```sh
git clone https://github.com/spencerbeggs/reposets.git
cd reposets
pnpm install
```

## Development Commands

| Command | Description |
| :--- | :--- |
| `pnpm run build` | Build all packages |
| `pnpm run test` | Run all tests |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run typecheck` | Type-check all workspaces |
| `pnpm run lint` | Check lint errors (Biome) |
| `pnpm run lint:fix` | Auto-fix lint issues |
| `pnpm run lint:md` | Lint markdown files |
| `pnpm sync` | Run CLI locally |

## Code Style

Biome handles formatting (tabs, 120 char width). Pre-commit hooks run automatically via Husky + lint-staged.

- Use `.js` extensions for relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins
- Use `import type` for type-only imports

## Commit Conventions

Conventional commits are required and enforced by commitlint. Format: `type(scope): subject`.

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

DCO signoff is required — every commit must end with `Signed-off-by: Your Name <your@email.com>`.

```text
feat(cli): add --verbose flag to list command

Signed-off-by: Your Name <your@email.com>
```

## Pull Requests

Branch from `main`, keep changes focused, and ensure the following pass before opening a PR:

- `pnpm run test` — all tests pass
- `pnpm run lint` — no lint errors

Open a PR with a clear description of what changed and why.

## Architecture

This project uses Effect for all async work and service composition. See `.claude/design/` for architecture docs if you need deeper context.
