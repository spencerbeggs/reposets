# Credentials

reposets stores credentials in a separate file from your main config so that tokens and secrets are never accidentally committed to version control. The credentials file holds named profiles, each containing a GitHub token and optional resolve sections for pulling values from 1Password, files, or inline strings.

## Credentials File

`reposets.credentials.toml` is stored in the XDG config directory (`~/.config/reposets/` by default). The `$XDG_CONFIG_HOME` environment variable is respected if set.

Running `reposets init` creates the file and automatically adds a `.gitignore` entry for it. Keep `reposets.credentials.toml` out of version control — never commit tokens to git.

### Credential file locations

The credentials file is stored in the XDG config directory by default (`~/.config/reposets/reposets.credentials.toml`, or `~/.reposets/reposets.credentials.toml` if `XDG_CONFIG_HOME` is not set).

The `reposets credentials` subcommands always read and write from the XDG location. The `sync`, `validate`, and other config-loading commands discover the credentials file using the same strategy as the config file: first walking up from the current directory, then falling back to the XDG config directory. This means `reposets init --project` places credentials alongside the config file and both are discovered automatically.

## Profile Structure

Each profile is a `[profiles.<name>]` table. The required field is `github_token`. The optional `op_service_account_token` field enables 1Password resolution for that profile.

```toml
[profiles.personal]
github_token = "ghp_your_token_here"
```

With 1Password resolution enabled:

```toml
[profiles.personal]
github_token = "ghp_your_token_here"
op_service_account_token = "ops_your_service_account_token"
```

See [Token Permissions](token-permissions.md) for the fine-grained personal access token scopes required.

## Implicit vs Named Profiles

If only one profile exists in the credentials file, it is used automatically for every group. When multiple profiles are defined, reference a profile by name in each group:

```toml
# In reposets.config.toml
[groups.work-repos]
repos = ["repo-one"]
credentials = "work"

[groups.personal-repos]
repos = ["repo-two"]
credentials = "personal"
```

## Resolve Sections

`[profiles.<name>.resolve]` defines named labels that can be referenced at sync time. There are three sub-groups: `value`, `file`, and `op`. All three can be used simultaneously within the same profile. They contribute to a flat namespace, so labels must be unique across all sub-groups within a profile.

### Value

`[profiles.<name>.resolve.value]` defines inline string values or TOML objects. Objects are JSON-stringified before use:

```toml
[profiles.personal.resolve.value]
BOT_NAME = "mybot[bot]"
REGISTRIES = { npm = "https://registry.npmjs.org" }
```

### File

`[profiles.<name>.resolve.file]` reads values from disk. Paths are relative to the directory containing `reposets.credentials.toml` (not the config file or the current working directory):

```toml
[profiles.personal.resolve.file]
DEPLOY_KEY = "./private/deploy.key"
```

### 1Password

`[profiles.<name>.resolve.op]` resolves values via the 1Password SDK. The profile must have `op_service_account_token` set:

```toml
[profiles.personal]
github_token = "ghp_..."
op_service_account_token = "ops_..."

[profiles.personal.resolve.op]
API_KEY = "op://vault/item/field"
MY_APP_ID = "op://vault/item/app-id"
```

## Using Resolved Values

The resolve system works across two files. You define **labels** in the credentials file, then reference those labels in the config file. At sync time, reposets looks up each label and substitutes the actual value.

### How it works

1. In `reposets.credentials.toml`, define labels in the `[resolve]` section of a profile. Each label maps to a source (1Password reference, file path, or inline value):

   ```toml
   [profiles.personal.resolve.op]
   MY_APP_ID = "op://vault/github-app/app-id"
   ```

2. In `reposets.config.toml`, reference those labels. There are two syntaxes depending on context:

   **Secrets and variables** use `resolved`-kind groups where names map to labels:

   ```toml
   [secrets.app.resolved]
   APP_ID = "MY_APP_ID"
   APP_PRIVATE_KEY = "MY_APP_PRIVATE_KEY"
   ```

   This creates a secret named `APP_ID` whose value is resolved from the `MY_APP_ID` label.

   **Rulesets** use inline `{ resolved = "LABEL" }` syntax for integer fields:

   ```toml
   [rulesets.workflow]
   # ...
   status_checks = {
     default_integration_id = { resolved = "MY_APP_ID" },
     required = [{ context = "CI" }]
   }
   ```

   This resolves `MY_APP_ID` at sync time and coerces it to an integer for the GitHub API.

### End-to-end example

The same label can be used in multiple places. Here `MY_APP_ID` resolves a GitHub App's numeric ID from 1Password, then that value is used as both a secret, a variable, a status check integration ID, and a bypass actor:

```toml
# reposets.credentials.toml
[profiles.personal.resolve.op]
MY_APP_ID = "op://vault/github-app/app-id"
```

```toml
# reposets.config.toml

# As a secret (the repo gets a secret named APP_ID)
[secrets.app.resolved]
APP_ID = "MY_APP_ID"

# As a variable (the repo gets a variable named APP_BOT_ID)
[variables.app.resolved]
APP_BOT_ID = "MY_APP_ID"

# As a status check integration ID (coerced to integer)
[rulesets.workflow]
name = "workflow"
type = "branch"
enforcement = "active"
targets = "default"
status_checks = {
  default_integration_id = { resolved = "MY_APP_ID" },
  required = [{ context = "CI" }]
}

# As a bypass actor ID (coerced to integer)
[rulesets.release]
name = "release"
type = "branch"
enforcement = "active"
targets = [{ include = "refs/heads/changesets-release/main" }]
bypass_actors = [
  {
    actor_id = { resolved = "MY_APP_ID" },
    actor_type = "Integration",
    bypass_mode = "always"
  }
]
```

See [Secrets and Variables](secrets-and-variables.md) and [Rulesets](rulesets.md) for more on each context.

## Managing Profiles

Use the `credentials` subcommand to create, list, and delete profiles. See [Commands](commands.md) for full details.

```sh
# Create a profile
reposets credentials create --profile personal --github-token ghp_...

# List profiles (tokens redacted)
reposets credentials list

# Delete a profile
reposets credentials delete --profile old-profile
```

## Security Notes

- Keep `reposets.credentials.toml` out of version control
- `reposets init` automatically creates a `.gitignore` entry for the credentials file
- Never commit tokens to git
- Use 1Password resolve sections to avoid storing sensitive values in the credentials file itself
