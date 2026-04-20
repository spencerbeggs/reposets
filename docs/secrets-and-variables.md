# Secrets and Variables

## Overview

Secrets and variables are defined as named groups in the config, then assigned to repo groups by scope. Each group is exactly one of three kinds, determined by its sub-key. Secrets are encrypted using NaCl sealed boxes before upload. Variables are plain text. Both use the same three-kind group model but differ in available scopes.

## Three Kinds

Each group is a discriminated union: it must contain exactly one of `file`, `value`, or `resolved` as its sub-key.

### File

Read values from disk. Paths are relative to the directory containing `repo-sync.config.toml`:

```toml
[secrets.deploy.file]
NPM_TOKEN = "./private/NPM_TOKEN"
DEPLOY_KEY = "./private/deploy.key"
```

### Value

Inline values. Strings are used as-is; TOML tables are JSON-stringified before upload:

```toml
[variables.turbo.value]
NODE_ENV = "production"
DO_NOT_TRACK = "1"
```

### Resolved

Map names to credential labels from the active profile's `[resolve]` section. At sync time, repo-sync looks up each label in the credentials file and substitutes the actual value.

```toml
# repo-sync.config.toml
[secrets.app.resolved]
APP_ID = "MY_APP_ID"
APP_PRIVATE_KEY = "MY_APP_PRIVATE_KEY"
NPM_TOKEN = "MY_NPM_TOKEN"
```

The left-hand side (`APP_ID`) is the secret name as it will appear in GitHub. The right-hand side (`MY_APP_ID`) is a label defined in the active credential profile's `[resolve]` section:

```toml
# repo-sync.credentials.toml
[profiles.personal.resolve.op]
MY_APP_ID = "op://vault/github-app/app-id"
MY_APP_PRIVATE_KEY = "op://vault/github-app/private-key"
MY_NPM_TOKEN = "op://vault/npm/token"
```

This keeps sensitive values out of the config file entirely. See [Credentials](credentials.md) for details on defining resolve labels.

## Secret Scopes

Secrets are assigned to repo groups via a `SecretScopes` object with four fields:

- `actions` — array of secret group names for GitHub Actions secrets
- `dependabot` — array of secret group names for Dependabot secrets
- `codespaces` — array of secret group names for Codespaces secrets
- `environments` — record mapping environment names to arrays of secret group names for environment-scoped secrets

```toml
[groups.my-projects]
repos = ["repo-one", "repo-two"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], environments = { production = ["api"] } }
```

The same secret group can appear in multiple scopes.

## Variable Scopes

Variables use a `VariableScopes` object with two fields:

- `actions` — array of variable group names for GitHub Actions variables
- `environments` — record mapping environment names to arrays of variable group names for environment-scoped variables

```toml
[groups.my-projects]
variables = { actions = ["turbo", "bot"], environments = { staging = ["turbo"] } }
```

## Environment-Scoped Resources

Secrets and variables can be scoped to specific deployment environments. The environment must be defined in `[environments.<name>]` and referenced by the group's `environments` array. Environments are synced before secrets and variables to ensure they exist when scoped resources are attached.

```toml
[groups.my-projects]
repos = ["repo-one"]
environments = ["staging", "production"]
secrets = { environments = { production = ["api"] } }
variables = { environments = { staging = ["turbo"] } }
```

See [Environments](environments.md) for environment configuration details.

## Complete Example

The following snippet shows two secret groups (file and resolved kinds), one variable group (value kind), and a group that assigns them across scopes including environment-scoped:

```toml
[secrets.deploy.file]
NPM_TOKEN = "./private/NPM_TOKEN"
DEPLOY_KEY = "./private/deploy.key"

[secrets.api.resolved]
API_KEY = "MY_API_KEY"

[variables.turbo.value]
NODE_ENV = "production"
DO_NOT_TRACK = "1"

[environments.staging]
wait_timer = 0

[environments.production]
wait_timer = 30

[groups.my-projects]
repos = ["repo-one", "repo-two"]
environments = ["staging", "production"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], codespaces = ["deploy"], environments = { production = ["api"] } }
variables = { actions = ["turbo"], environments = { staging = ["turbo"] } }
```
