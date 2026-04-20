# repo-sync

[![npm version](https://img.shields.io/npm/v/repo-sync)](https://www.npmjs.com/package/repo-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)

Declarative GitHub repository management. Define your repo settings, secrets, variables, rulesets, and deployment environments in a TOML config file, then apply them across all your repositories with a single command.

## Why repo-sync

Managing repository settings by hand doesn't scale. When you have dozens of repos that should share the same branch protection rules, CI secrets, and merge settings, clicking through the GitHub UI for each one is slow and error-prone. repo-sync lets you define that configuration once and sync it everywhere.

## Features

- **Git-committable config templates** — Your entire repo configuration lives in a TOML file that is safe to commit, review, and share. Sensitive values are never stored in the config itself.
- **Resolvable values** — Secrets and integer fields reference named labels that resolve at sync time from 1Password, local files, or inline values in a separate credentials file. One config template works across environments.
- **Multi-scope secret and variable management** — Assign the same secret group to Actions, Dependabot, Codespaces, and deployment environments with scoped targeting.
- **Ruleset shorthand syntax** — Define branch and tag rulesets with compact inline syntax for pull request rules, status checks, and boolean flags instead of verbose API payloads.
- **Deployment environment management** — Configure wait timers, reviewers, and branch policies for deployment environments alongside your other settings.
- **Group-based targeting** — Organize repos into groups that share settings, secrets, variables, rulesets, and environments. Change the group config, sync once, and every repo updates.
- **Cleanup policies** — Automatically remove undeclared resources per scope with optional preserve lists, so your repos converge to the declared state.
- **Dry-run and validation** — Preview changes before applying, validate config locally without touching the GitHub API, and catch typos with built-in diagnostics.

## Installation

```sh
npm install -g repo-sync
```

Alternative (no install):

```sh
npx repo-sync <command>
```

Requires Node.js >= 20.

## Quick Start

1. Run `repo-sync init` to scaffold config files.
2. Add a credential profile:

   ```sh
   repo-sync credentials create --profile personal --github-token ghp_...
   ```

3. Edit `repo-sync.config.toml` with your repos and settings:

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
   repo-sync validate
   ```

5. Preview changes without applying them:

   ```sh
   repo-sync sync --dry-run
   ```

6. Apply the config:

   ```sh
   repo-sync sync
   ```

## Commands

| Command | Description |
| :--- | :--- |
| `repo-sync sync` | Apply config to repos (supports --dry-run, --group, --repo, --no-cleanup) |
| `repo-sync list` | Show config summary |
| `repo-sync validate` | Validate config without API calls |
| `repo-sync doctor` | Deep diagnostics with typo detection |
| `repo-sync init` | Scaffold config files (--project for local) |
| `repo-sync credentials` | Manage credential profiles (create, list, delete) |

All commands accept `--log-level silent|info|verbose|debug`.

## Configuration

repo-sync uses two TOML files:

- `repo-sync.config.toml` — defines settings, secrets, variables, rulesets, environments, and groups
- `repo-sync.credentials.toml` — stores GitHub tokens and optional resolve sections for named values

Config lookup order (first match wins):

1. `--config` flag (explicit path or directory)
2. Walk up from current directory looking for `repo-sync.config.toml`
3. XDG fallback: `~/.config/repo-sync/repo-sync.config.toml`

See the [docs/](https://github.com/spencerbeggs/repo-sync/tree/main/docs) folder for full reference on configuration, credentials, secrets, rulesets, environments, cleanup, and token setup.

## Token Permissions

repo-sync requires a fine-grained personal access token with:

- Repository > Administration (Read and write)
- Repository > Secrets (Read and write)
- Repository > Variables (Read and write)
- Repository > Environments (Read and write)
- Account > GPG keys (Read and write)

## Documentation

Full guides are available in the [docs/](https://github.com/spencerbeggs/repo-sync/tree/main/docs) folder, covering configuration, credentials, secrets, rulesets, environments, cleanup policies, and token setup.

## License

[MIT](./LICENSE)
