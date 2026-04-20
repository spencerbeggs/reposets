# Credentials

repo-sync stores credentials in a separate file from your main config so that tokens and secrets are never accidentally committed to version control. The credentials file holds named profiles, each containing a GitHub token and optional resolve sections for pulling values from 1Password, files, or inline strings.

## Credentials File

`repo-sync.credentials.toml` is stored in the XDG config directory (`~/.config/repo-sync/` by default). The `$XDG_CONFIG_HOME` environment variable is respected if set.

Running `repo-sync init` creates the file and automatically adds a `.gitignore` entry for it. Keep `repo-sync.credentials.toml` out of version control — never commit tokens to git.

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
# In repo-sync.config.toml
[groups.work-repos]
repos = ["repo-one"]
credentials = "work"

[groups.personal-repos]
repos = ["repo-two"]
credentials = "personal"
```

## Resolve Sections

`[profiles.<name>.resolve]` defines named labels that can be referenced at sync time. There are three sub-groups: `value`, `file`, and `op`. All three contribute to a flat namespace, so labels must be unique across all sub-groups within a profile.

### Value

`[profiles.<name>.resolve.value]` defines inline string values or TOML objects. Objects are JSON-stringified before use:

```toml
[profiles.personal.resolve.value]
BOT_NAME = "mybot[bot]"
REGISTRIES = { npm = "https://registry.npmjs.org" }
```

### File

`[profiles.<name>.resolve.file]` reads values from disk. Paths are relative to the directory containing `repo-sync.credentials.toml`:

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

The resolve system works across two files. You define **labels** in the credentials file, then reference those labels in the config file. At sync time, repo-sync looks up each label and substitutes the actual value.

### How it works

1. In `repo-sync.credentials.toml`, define labels in the `[resolve]` section of a profile. Each label maps to a source (1Password reference, file path, or inline value):

   ```toml
   [profiles.personal.resolve.op]
   MY_APP_ID = "op://vault/github-app/app-id"
   ```

2. In `repo-sync.config.toml`, reference those labels. There are two syntaxes depending on context:

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
# repo-sync.credentials.toml
[profiles.personal.resolve.op]
MY_APP_ID = "op://vault/github-app/app-id"
```

```toml
# repo-sync.config.toml

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
repo-sync credentials create --profile personal --github-token ghp_...

# List profiles (tokens redacted)
repo-sync credentials list

# Delete a profile
repo-sync credentials delete --profile old-profile
```

## Security Notes

- Keep `repo-sync.credentials.toml` out of version control
- `repo-sync init` automatically creates a `.gitignore` entry for the credentials file
- Never commit tokens to git
- Use 1Password resolve sections to avoid storing sensitive values in the credentials file itself
