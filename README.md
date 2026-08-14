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

Use `--env REPOSETS_GITHUB_TOKEN` in place of `--op` to read the token from the environment instead of 1Password. Resolving `op://` references needs `OP_SERVICE_ACCOUNT_TOKEN` in your environment.

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

Check it:

```bash
reposets validate
# Valid: ./reposets.config.toml
#   groups: 1
```

Preview the changes, then apply them:

```bash
reposets sync --dry-run
reposets sync
```

The owner is not in the config. It belongs to the credential profile, which declares `username` or `org`, and every group names the profile it is synced as. That is what lets one config span a personal account and an organization.

## Features

- **Config you can commit.** The whole declaration lives in one TOML file that is safe to review and share. No secret value is ever stored in it.
- **References, not secrets.** Tokens and sensitive values are addresses resolved at sync time from 1Password, environment variables or files. Neither file reposets writes ever holds a credential — see [Credentials and blast radius](#credentials-and-blast-radius).
- **Multi-account in one run.** Each group names the credential profile it authenticates as, and groups are partitioned by profile within a single `sync`.
- **Drift detection.** `reposets drift` reports resources changed outside the tool and exits non-zero, without writing anything, so it gates CI on its own.
- **Multi-scope secrets and variables.** Assign the same group to Actions, Dependabot, Codespaces and deployment environments.
- **Ruleset shorthand.** Branch and tag rulesets written as compact tables instead of raw API payloads, with resolved references for App and integration IDs.
- **Deployment environments.** Wait timers, reviewers and branch policies alongside everything else, synced before the secrets scoped to them.
- **Security and CodeQL.** Secret scanning, push protection, vulnerability alerts, automated fixes, private reporting and CodeQL default setup, aware of both GHAS licensing and account type.
- **Cleanup policies.** Remove undeclared resources per scope, with preserve lists, so repositories converge on the declared state.
- **Offline validation.** `reposets validate` checks schema, reference integrity, organization-only constructs and undeclared credential labels without a token or a network call.
- **Run history.** Every run is journalled. `reposets history` shows what happened and `history show` lists every resource one run touched.

## Credentials and blast radius

reposets is built so that **the files it writes contain no credentials at all** — only addresses. That is the design, not a convention you have to maintain.

A profile stores where a token lives, never the token:

```toml
[profiles.personal]
username = "your-username"
github_token = { op = "op://Private/github/token" }
```

There is no field to put a secret in. `credentials create` rejects anything that looks like a token value, and the schema has no variant that accepts one. The same is true of secrets in the config: a `resolved` group names a label, and the label names a vault item.

### One live credential, in the environment

Resolving `op://` references needs `OP_SERVICE_ACCOUNT_TOKEN`, and that is the **only** live credential in the system. It lives in your environment — deliberately never in a reposets file, because it unlocks everything the addresses point at, and storing it beside them would defeat the whole arrangement.

**Scope the service account to a single vault.** One credential, one grant, bounded blast radius: if it leaks, the exposure is that vault, not every secret on every machine that runs the tool. Without this you are back to N live tokens spread across shell profiles and CI settings, each with its own lifetime and no way to revoke them together.

### What actually leaks if a file leaks

| If this leaks | What an attacker learns |
| :--- | :--- |
| `reposets.config.toml` | which repositories you manage and what settings you apply |
| `reposets.credentials.toml` | which vault items and environment variables you read — the addresses, not the contents |
| `OP_SERVICE_ACCOUNT_TOKEN` | everything in the one vault it is scoped to |

The credentials file is gitignored anyway — it names your vault layout, which is worth keeping private even though it is not sensitive on its own — but a leak is a disclosure of structure rather than of secrets.

### After resolution

A resolved value is `Redacted`, which renders as `<redacted>` through `toString`, template interpolation and `JSON.stringify` — so the ordinary ways a secret escapes into a log line or an error message are closed structurally rather than by remembering. `reposets doctor` prints references and never resolved values, which the test suite asserts on every stream.

Secrets are sealed with libsodium's crypto box against the repository's public key **before they leave the process**, so a value is ciphertext by the time it reaches the network.

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

Every command accepts `--config` and the `--log-level` filter Effect core provides. `--log-level error` is quiet on success and loud on failure; `--log-level none` is the CI form. See [Commands](docs/02-commands.md) for every flag.

## Upgrading

Configs written before 1.0 will not load: `owner` and `log_level` were removed, `credentials` became required on every group and the credentials file now holds token references rather than tokens. [Migrating to 1.0](docs/01-migrating-to-1.0.md) has before-and-after TOML for each change, and `reposets doctor` names every removed key it finds in your file.

## Documentation

- [Migrating to 1.0](docs/01-migrating-to-1.0.md) — before-and-after TOML for every breaking change
- [Commands](docs/02-commands.md) — every command and flag, with output
- [Configuration](docs/03-configuration.md) — file format, path resolution and the settings reference
- [Credentials](docs/04-credentials.md) — profiles, owners, token references and resolve sections
- [Secrets and variables](docs/05-secrets-and-variables.md) — the three group kinds and how scoping works
- [Rulesets](docs/06-rulesets.md) — branch and tag rulesets, every field and the shorthand forms
- [Environments](docs/07-environments.md) — deployment environments, reviewers and branch policies
- [Advanced security](docs/03-configuration.md#security-and-analysis-block) — secret scanning, vulnerability alerts and CodeQL default setup
- [Cleanup](docs/08-cleanup.md) — removing resources the config no longer declares
- [Token permissions](docs/09-token-permissions.md) — which scopes are needed, and why

## Packages

| Package | Purpose |
| :--- | :--- |
| [`reposets`](package/) | The CLI, published to npm and to GitHub Packages as `@spencerbeggs/reposets` |

## Repository layout

```text
package/               # the reposets CLI package
  src/cli/             # entrypoint and one file per command
  src/services/        # Effect services (config files, credentials, 1Password, logging)
  src/sync/            # the sync engine and its phases
  src/schemas/         # Effect Schema definitions and JSON schema generation
  src/store/           # SQLite-backed journal, applied state and cache
  __test__/            # tests mirroring src/
lib/configs/           # shared dev config (commitlint, lint-staged, markdownlint)
docs/                  # user documentation
```

## Development

Requires Node.js at the version in [`package/package.json`](package/package.json) and pnpm.

```bash
pnpm install         # install dependencies
pnpm run build       # build all packages
pnpm run test        # run tests
pnpm run typecheck   # type-check
pnpm run lint        # lint
pnpm cli --help      # run the CLI from source
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
