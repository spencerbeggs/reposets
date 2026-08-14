# reposets documentation

reposets is a CLI that syncs GitHub repository settings, secrets, variables, rulesets, deployment environments, security toggles and CodeQL default setup across your repositories. Declare the desired state once in a TOML file, then apply it everywhere with one command.

Rather than clicking through repository settings one by one, reposets reconciles the live state on GitHub against your declared config on every run, reports what changed outside the tool and converges the rest.

## Install

```bash
npm install -g reposets
# or run it without installing
npx reposets <command>
```

Requires the Node.js version in the package's `engines` field.

## Getting started

1. Create a fine-grained personal access token with the [required permissions](09-token-permissions.md).
2. Scaffold the config files:

   ```bash
   reposets init --project
   # Created: ./reposets.config.toml
   # Created: ./reposets.credentials.toml
   # Created .gitignore with reposets.credentials.toml
   ```

3. Add a credential profile. It stores a *reference* to your token, never the token:

   ```bash
   reposets credentials create --profile personal --username your-username --op "op://Private/github/token"
   # Created profile 'personal' (username: your-username, github_token: op op://Private/github/token) in ./reposets.credentials.toml.
   ```

   Use `--env REPOSETS_GITHUB_TOKEN` instead of `--op` to read the token from the environment.

4. Edit `reposets.config.toml` to declare your repositories and what should apply to them (see [Configuration](03-configuration.md)).
5. Check it:

   ```bash
   reposets validate
   # Valid: ./reposets.config.toml
   #   groups: 1
   ```

6. Preview, then apply:

   ```bash
   reposets sync --dry-run
   reposets sync
   ```

## Minimal working example

A config and credentials pair you can copy and adapt. This syncs two settings to two repositories.

`reposets.credentials.toml`:

```toml
[profiles.personal]
username = "your-github-username"
github_token = { op = "op://Private/github/token" }
```

`reposets.config.toml`:

```toml
[settings.defaults]
has_wiki = false
has_projects = false
delete_branch_on_merge = true

[groups.my-repos]
repos = ["repo-one", "repo-two"]
credentials = "personal"
settings = ["defaults"]
```

Three things are load-bearing here. The owner lives on the profile as `username` or `org`, not in the config. Every group names a profile through `credentials`, even when there is only one. And `settings` is an array of group names, not a bare string.

Resolving `op://` references needs `OP_SERVICE_ACCOUNT_TOKEN` in your environment. Use an `{ env = "..." }` token reference instead if you do not use 1Password.

Then:

```bash
reposets validate
reposets sync --dry-run
reposets sync
```

## Upgrading from an earlier version

Configs written before 1.0 will not load. [Migrating to 1.0](01-migrating-to-1.0.md) has before-and-after TOML for every change, and `reposets doctor` names each removed key it finds.

## Guides

- [Migrating to 1.0](01-migrating-to-1.0.md) — what changed, with before-and-after TOML for each breaking change
- [Commands](02-commands.md) — every command and flag, with output
- [Configuration](03-configuration.md) — config file format, path resolution and the settings reference
- [Credentials](04-credentials.md) — profiles, owners, token references and resolve sections
- [Secrets and variables](05-secrets-and-variables.md) — the three group kinds and how scoping works
- [Rulesets](06-rulesets.md) — branch and tag rulesets, every field and the shorthand forms
- [Environments](07-environments.md) — deployment environments, reviewers and branch policies
- [Advanced security](03-configuration.md#security-and-analysis-block) — secret scanning, vulnerability alerts, private reporting and CodeQL default setup
- [Cleanup](08-cleanup.md) — removing resources the config no longer declares
- [Token permissions](09-token-permissions.md) — which fine-grained token scopes are needed, and why
