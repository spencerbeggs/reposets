# reposets

[![npm](https://img.shields.io/npm/v/reposets?label=npm&color=cb3837)](https://www.npmjs.com/package/reposets)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Declarative GitHub repository management. Define repository settings, secrets, variables, rulesets, deployment environments, security toggles and CodeQL default setup in a TOML file, then apply them across every repository you own with one command.

## Why reposets

Managing repository settings by hand does not scale. Once a dozen repositories should share the same branch protection, CI secrets and merge settings, clicking through the GitHub UI for each one is slow and easy to get subtly wrong. reposets lets you declare that configuration once and converge every repository onto it, then tells you when someone changes a repository outside the tool.

## Install

```bash
npm install -g reposets
```

Or run it without installing:

```bash
npx reposets <command>
```

Requires the Node.js version shown in the badge above.

## Quick start

Scaffold the config files in the current directory:

```bash
reposets init --project
# Created: ./reposets.config.toml
# Created: ./reposets.credentials.toml
# Created .gitignore with reposets.credentials.toml
```

Add a credential profile. It records *where* your token lives, never the token itself:

```bash
reposets credentials create --profile personal --username your-username --op "op://Private/github/token"
# Created profile 'personal' (username: your-username, github_token: op op://Private/github/token) in ./reposets.credentials.toml.
```

Use `--env REPOSETS_GITHUB_TOKEN` in place of `--op` to read the token from the environment instead of 1Password.

Declare what should apply to which repositories in `reposets.config.toml`:

```toml
[settings.default]
has_wiki = false
delete_branch_on_merge = true

[groups.my-repos]
repos = ["repo-one", "repo-two"]
credentials = "personal"
settings = ["default"]
```

Check it, preview it, then apply it:

```bash
reposets validate
# Valid: ./reposets.config.toml
#   groups: 1

reposets sync --dry-run
reposets sync
```

The owner is not in the config. It belongs to the credential profile, which declares `username` or `org`, and every group names the profile it is synced as.

## Features

- **Config you can commit.** The whole declaration lives in one TOML file that is safe to review and share. No secret value is ever stored in it.
- **References, not secrets.** Tokens and sensitive values are addresses resolved at sync time from 1Password, environment variables or files. The credentials file discloses nothing if it leaks.
- **Multi-account in one run.** Each group names the credential profile it authenticates as, so a single config can span your personal account and an organization.
- **Drift detection.** `reposets drift` reports resources changed outside the tool and exits non-zero, without writing anything, so it gates CI on its own.
- **Multi-scope secrets and variables.** Assign the same group to Actions, Dependabot, Codespaces and deployment environments.
- **Ruleset shorthand.** Branch and tag rulesets written as compact tables instead of raw API payloads, with resolved references for App and integration IDs.
- **Deployment environments.** Wait timers, reviewers and branch policies alongside everything else, synced before the secrets scoped to them.
- **Security and CodeQL.** Secret scanning, push protection, vulnerability alerts, automated fixes, private reporting and CodeQL default setup. License- and ownership-aware: unlicensed GHAS fields warn instead of failing, and organization-only fields are rejected offline for personal accounts.
- **Cleanup policies.** Remove undeclared resources per scope, with preserve lists, so repositories converge on the declared state.
- **Offline validation.** `reposets validate` checks schema, reference integrity, organization-only constructs and undeclared credential labels without a token or a network call.
- **Run history.** Every run is journalled. `reposets history` shows what happened and `history show` lists every resource one run touched.

## Commands

| Command | Description |
| :--- | :--- |
| `reposets sync` | Apply the config. Supports `--dry-run`, `--group`, `--repo`, `--only`, `--skip`, `--no-cleanup`, `--fail-on-drift`, `--debug` |
| `reposets drift` | Report resources changed outside reposets and exit non-zero. Changes nothing |
| `reposets list` | Show a config summary by group |
| `reposets validate` | Validate the config with no API calls |
| `reposets doctor` | Diagnose config, credentials and token, and print required permissions |
| `reposets history` | Show past runs. Subcommands: `show`, `prune`, `clear` |
| `reposets init` | Scaffold the config files. `--project` for the current directory |
| `reposets nuke` | Delete every local reposets file. Nothing on GitHub is touched |
| `reposets credentials` | Manage credential profiles: `create`, `list`, `delete` |

Every command accepts `--config` and the `--log-level` filter Effect core provides. `--log-level error` is quiet on success and loud on failure; `--log-level none` is the CI form.

## Configuration

reposets reads two TOML files:

- `reposets.config.toml` — settings, security, code scanning, environments, secrets, variables, rulesets and the groups tying them to repositories
- `reposets.credentials.toml` — named profiles declaring the account each acts as and where its token lives

Lookup order for the config, first match wins:

1. The `--config` flag, a file path or a directory
2. Walking up from the current directory
3. `~/.config/reposets/reposets.config.toml`, respecting `$XDG_CONFIG_HOME`

## Token permissions

reposets needs a fine-grained personal access token with:

- Repository > Administration (Read and write)
- Repository > Secrets (Read and write)
- Repository > Variables (Read and write)
- Repository > Environments (Read and write)
- Repository > Dependabot secrets (Read and write)
- Repository > Actions (**Read**) — counts workflow files for the `actions` CodeQL language
- Repository > Code scanning alerts (Read and write) — for `[code_scanning.*]`
- Repository > Dependabot alerts (Read and write) — for `[security.*]`
- Repository > Secret scanning alerts (Read and write) — for `security_and_analysis`
- Organization > Members (Read) — resolve team slugs on org-owned repositories

The last five are only needed if you use the matching config sections. No account-level permission is required. `reposets doctor` prints this list and checks that your token resolves and authenticates.

## Documentation

- [Migrating to 1.0](https://github.com/spencerbeggs/reposets/blob/main/docs/01-migrating-to-1.0.md) — before-and-after TOML for every breaking change
- [Commands](https://github.com/spencerbeggs/reposets/blob/main/docs/02-commands.md) — every command and flag, with output
- [Configuration](https://github.com/spencerbeggs/reposets/blob/main/docs/03-configuration.md) — file format, path resolution and the settings reference
- [Credentials](https://github.com/spencerbeggs/reposets/blob/main/docs/04-credentials.md) — profiles, owners, token references and resolve sections
- [Secrets and variables](https://github.com/spencerbeggs/reposets/blob/main/docs/05-secrets-and-variables.md) — the three group kinds and how scoping works
- [Rulesets](https://github.com/spencerbeggs/reposets/blob/main/docs/06-rulesets.md) — branch and tag rulesets, every field and the shorthand forms
- [Environments](https://github.com/spencerbeggs/reposets/blob/main/docs/07-environments.md) — deployment environments, reviewers and branch policies
- [Advanced security](https://github.com/spencerbeggs/reposets/blob/main/docs/03-configuration.md#security-and-analysis-block) — secret scanning, vulnerability alerts and CodeQL default setup
- [Cleanup](https://github.com/spencerbeggs/reposets/blob/main/docs/08-cleanup.md) — removing resources the config no longer declares
- [Token permissions](https://github.com/spencerbeggs/reposets/blob/main/docs/09-token-permissions.md) — which scopes are needed, and why

## Editor support

JSON schemas for both config files are published to [SchemaStore](https://www.schemastore.org/), so editors validate and autocomplete `reposets.config.toml` and `reposets.credentials.toml` with no setup. The schemas carry annotations for the Tombi and Taplo TOML language servers.

## License

[MIT](LICENSE)
