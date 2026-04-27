# reposets Documentation

reposets is a CLI tool for syncing GitHub repository settings, secrets, variables, rulesets, deployment environments, advanced security toggles, and CodeQL default setup across your personal and organization repositories. Define your desired state once in a TOML config file and apply it everywhere with a single command.

Rather than clicking through repository settings one by one, reposets lets you manage repository configuration as code. Group repositories together, assign shared secrets and variables to those groups, and let reposets reconcile the live state on GitHub against your declared config on every run.

## Prerequisites

- Node.js >= 20

## Installation

```sh
npm install -g reposets
# or run without installing:
npx reposets <command>
```

## Getting Started

1. Install reposets (see above)
2. Create a GitHub fine-grained personal access token with the [required permissions](token-permissions.md)
3. Run `reposets init` to scaffold config files in your XDG config directory (or pass `--project` for the current directory)
4. Create a credential profile: `reposets credentials create --profile personal --github-token ghp_your_token`
5. Edit `reposets.config.toml` to define your repositories, settings, secrets, and variables (see [Configuration](configuration.md))
6. Run `reposets validate` to check your config for errors
7. Run `reposets sync --dry-run` to preview what changes would be applied
8. Run `reposets sync` to apply the config to all repositories

## Minimal Working Example

Below is a minimal config and credentials pair you can copy-paste and adapt. This example syncs basic settings to a single repository.

`reposets.credentials.toml`:

```toml
[profiles.personal]
github_token = "github_pat_your_token_here"
```

`reposets.config.toml`:

```toml
owner = "your-github-username"
profile = "personal"

[settings.defaults]
has_wiki = false
has_projects = false
delete_branch_on_merge = true

[groups.my-repos]
repos = ["my-repo"]
settings = "defaults"
```

Then run:

```sh
reposets validate
reposets sync --dry-run
reposets sync
```

## Guides

- [Commands Reference](commands.md) - all commands, flags, and usage examples
- [Configuration](configuration.md) - config file format, path resolution, and settings reference
- [Credentials](credentials.md) - credential profiles, resolve sections, and 1Password integration
- [Secrets and Variables](secrets-and-variables.md) - resource groups, three kinds (file/value/resolved), and scoping
- [Rulesets](rulesets.md) - branch and tag rulesets, shorthand fields, and rule types
- [Environments](environments.md) - deployment environment definitions and configuration
- [Advanced Security](configuration.md#security-and-analysis-nested-block) - secret scanning, push protection, vulnerability alerts, automated security fixes, private vulnerability reporting, and CodeQL default setup
- [Cleanup](cleanup.md) - automatic cleanup of undeclared resources with preserve lists
- [Token Permissions](token-permissions.md) - fine-grained PAT setup guide
