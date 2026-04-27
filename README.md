# reposets

[![npm version](https://img.shields.io/npm/v/reposets)](https://www.npmjs.com/package/reposets)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)

Declarative GitHub repository management. Define your repo settings, secrets, variables, rulesets, deployment environments, advanced security toggles, and CodeQL default setup in a TOML config file, then apply them across all your repositories with a single command.

## Why reposets

Managing repository settings by hand doesn't scale. When you have dozens of repos that should share the same branch protection rules, CI secrets, and merge settings, clicking through the GitHub UI for each one is slow and error-prone. reposets lets you define that configuration once and sync it everywhere.

## Features

- **Git-committable config templates** — Your entire repo configuration lives in a TOML file that is safe to commit, review, and share. Sensitive values are never stored in the config itself.
- **Resolvable values** — Secrets and integer fields reference named labels that resolve at sync time from 1Password, local files, or inline values in a separate credentials file. One config template works across environments.
- **Multi-scope secret and variable management** — Assign the same secret group to Actions, Dependabot, Codespaces, and deployment environments with scoped targeting.
- **Ruleset shorthand syntax** — Define branch and tag rulesets with compact inline syntax for pull request rules, status checks, and boolean flags instead of verbose API payloads.
- **Deployment environment management** — Configure wait timers, reviewers, and branch policies for deployment environments alongside your other settings.
- **Advanced security and CodeQL** — Toggle secret scanning, push protection, vulnerability alerts, automated security fixes, private vulnerability reporting, and CodeQL default setup. License- and ownership-aware: GHAS-licensed fields warn instead of failing on private repos without a license, and org-only fields are silently skipped on personal accounts.
- **Group-based targeting** — Organize repos into groups that share settings, secrets, variables, rulesets, environments, security toggles, and code scanning configuration. Change the group config, sync once, and every repo updates.
- **Cleanup policies** — Automatically remove undeclared resources per scope with optional preserve lists, so your repos converge to the declared state.
- **Dry-run and validation** — Preview changes before applying, validate config locally without touching the GitHub API, and catch typos with built-in diagnostics.

## Installation

```sh
npm install -g reposets
```

Alternative (no install):

```sh
npx reposets <command>
```

Requires Node.js >= 20.

## Quick Start

1. Run `reposets init` to scaffold config files.
2. Add a credential profile:

   ```sh
   reposets credentials create --profile personal --github-token ghp_...
   ```

3. Edit `reposets.config.toml` with your repos and settings:

   ```toml
   owner = "your-username"

   [settings.default]
   has_wiki = false
   delete_branch_on_merge = true

   [groups.my-repos]
   repos = ["repo-one", "repo-two"]
   settings = ["default"]
   ```

4. Validate your config:

   ```sh
   reposets validate
   ```

5. Preview changes without applying them:

   ```sh
   reposets sync --dry-run
   ```

6. Apply the config:

   ```sh
   reposets sync
   ```

## Commands

| Command | Description |
| :--- | :--- |
| `reposets sync` | Apply config to repos (supports --dry-run, --group, --repo, --no-cleanup) |
| `reposets list` | Show config summary |
| `reposets validate` | Validate config without API calls |
| `reposets doctor` | Deep diagnostics with typo detection |
| `reposets init` | Scaffold config files (--project for local) |
| `reposets credentials` | Manage credential profiles (create, list, delete) |

All commands accept `--log-level silent|info|verbose|debug`.

## Documentation

Full reference guides are in the [docs/](docs/) folder:

- [Commands Reference](docs/commands.md) - all commands, flags, and usage examples
- [Configuration](docs/configuration.md) - config file format, path resolution, and settings reference
- [Credentials](docs/credentials.md) - credential profiles, resolve sections, and 1Password integration
- [Secrets and Variables](docs/secrets-and-variables.md) - resource groups, three kinds (file/value/resolved), and scoping
- [Rulesets](docs/rulesets.md) - branch and tag ruleset configuration
- [Environments](docs/environments.md) - deployment environment setup
- [Advanced Security](docs/configuration.md#security-and-analysis-nested-block) - secret scanning, vulnerability alerts, automated security fixes, private vulnerability reporting, and CodeQL default setup
- [Cleanup](docs/cleanup.md) - automatic cleanup of undeclared resources
- [Token Permissions](docs/token-permissions.md) - GitHub PAT setup guide

## Project Structure

```text
package/               # reposets CLI package (published to npm + GitHub Packages)
  src/cli/             # CLI entrypoint and commands
  src/services/        # Effect services (ConfigLoader, GitHubClient, SyncEngine, etc.)
  src/schemas/         # Effect Schema definitions + JSON schema generation
  src/lib/             # Utilities (XDG paths, config resolution, crypto)
  __test__/            # Tests mirroring src/ structure
lib/configs/           # Shared dev config (commitlint, lint-staged, markdownlint)
```

## Development

Prerequisites: Node.js >= 20, pnpm.

```sh
pnpm install           # Install dependencies
pnpm run build         # Build all packages
pnpm run test          # Run tests
pnpm run typecheck     # Type-check
pnpm run lint          # Lint check
pnpm sync              # Run CLI locally
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](./LICENSE)
