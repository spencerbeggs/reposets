# repo-sync Documentation

repo-sync is a CLI tool for syncing GitHub repository settings, secrets, variables, rulesets, and deployment environments across your personal repositories. Define your desired state once in a TOML config file and apply it everywhere with a single command.

Rather than clicking through repository settings one by one, repo-sync lets you manage repository configuration as code. Group repositories together, assign shared secrets and variables to those groups, and let repo-sync reconcile the live state on GitHub against your declared config on every run.

## Installation

```sh
npm install -g repo-sync
# or run without installing:
npx repo-sync <command>
```

Requires Node.js >= 20.

## Getting Started

1. Run `repo-sync init` to scaffold a `repo-sync.config.toml` in your current directory
2. Add a GitHub token with `repo-sync credentials create`
3. Edit `repo-sync.config.toml` to define your repositories, settings, secrets, and variables
4. Run `repo-sync sync` to apply the config to all repositories

## Guides

- [Commands Reference](commands.md) - all commands, flags, and usage examples
- [Configuration](configuration.md) - config file format, path resolution, and settings reference
- [Credentials](credentials.md) - credential profiles, resolve sections, and 1Password integration
- [Secrets and Variables](secrets-and-variables.md) - resource groups, three kinds (file/value/resolved), and scoping
- [Rulesets](rulesets.md) - branch and tag rulesets, shorthand fields, and rule types
- [Environments](environments.md) - deployment environment definitions and configuration
- [Cleanup](cleanup.md) - automatic cleanup of undeclared resources with preserve lists
- [Token Permissions](token-permissions.md) - fine-grained PAT setup guide
