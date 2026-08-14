# Secrets and variables

## Overview

Secrets and variables are declared as named groups in the config, then assigned to repository groups by scope. Each group is exactly one of three kinds, determined by its sub-key. Secrets are sealed with libsodium sealed-box encryption before upload; variables are plain text. Both use the same three-kind model and differ only in the scopes available.

## Choosing a kind

Use `value` groups to get started, where the value is written directly in the config. Use `file` for values kept on disk, which suits large ones like private keys. Use `resolved` when a config is shared across machines, or when values come from 1Password.

**`resolved` is the one to reach for once a config leaves your laptop.** The other two put the value somewhere — in the config, or in a file beside it. `resolved` puts an *address* there and fetches the value at sync time, which is what makes a config safe to commit and review. See [Why resolved changes what you are storing](#why-resolved-changes-what-you-are-storing).

## Three kinds

Each group must contain exactly one of `file`, `value` or `resolved`.

### File

Read values from disk. Paths resolve relative to the directory containing `reposets.config.toml`, and absolute paths are used as-is:

```toml
[secrets.deploy.file]
NPM_TOKEN = "./private/NPM_TOKEN"
DEPLOY_KEY = "./private/deploy.key"
```

Trailing whitespace is trimmed. A file that cannot be read is reported with its path and never its contents.

### Value

Inline values. Strings are used as-is and TOML tables are JSON-stringified before upload:

```toml
[variables.turbo.value]
NODE_ENV = "production"
DO_NOT_TRACK = "1"
```

### Resolved

Map names to credential labels from the profile the group names. At sync time reposets looks up each label and substitutes the value.

```toml
# reposets.config.toml
[secrets.app.resolved]
APP_ID = "MY_APP_ID"
APP_PRIVATE_KEY = "MY_APP_PRIVATE_KEY"
NPM_TOKEN = "MY_NPM_TOKEN"
```

The name on the left is the secret as it appears in GitHub. The label on the right is declared in the `[resolve]` section of the credential profile:

```toml
# reposets.credentials.toml
[profiles.personal.resolve.op]
MY_APP_ID = "op://Private/github-app/app-id"
MY_APP_PRIVATE_KEY = "op://Private/github-app/private-key"
MY_NPM_TOKEN = "op://Private/npm/token"
```

This keeps sensitive values out of the config file entirely. See [Credentials](04-credentials.md) for the four resolve sub-groups.

A label the group's profile does not declare is caught before anything is written:

```bash
reposets validate
# Invalid: /path/to/reposets.config.toml
#   [my-projects] app.APP_ID: credential label 'MY_APP_IDD' is not declared in profile 'personal'
```

## Why `resolved` changes what you are storing

The three kinds differ in where the value lives, and that difference decides what a leak costs you.

With `value` and `file`, the secret is on disk in or beside your config. That is fine for a scratch config on one machine, and it is the reason `reposets.config.toml` is gitignored by default. With `resolved`, what is on disk is a label:

```toml
[secrets.app.resolved]
APP_PRIVATE_KEY = "MY_APP_PRIVATE_KEY"
```

That label points into the profile's `[resolve]` section, which points at 1Password:

```toml
[profiles.personal.resolve.op]
MY_APP_PRIVATE_KEY = "op://Private/github-app/private-key"
```

Two hops, and neither holds a secret. The config names a label; the credentials file names a vault item. **Nothing reposets writes contains a credential.**

### The service account is the whole security boundary

Resolving `op://` references needs `OP_SERVICE_ACCOUNT_TOKEN` in your environment, and it is the only live credential involved. Everything else is an address.

**Scope that service account to one vault.** The point is blast radius: if it is compromised, the exposure is bounded to that vault rather than to every secret the tool has ever touched. That is the trade the `resolved` kind exists to make — one credential to protect and rotate, instead of a scatter of tokens across shell profiles, CI settings and config files, each with its own lifetime and no way to revoke them together.

The token is deliberately not storable in `reposets.credentials.toml`. There is no field for it. It unlocks everything the file's addresses point at, so keeping it in the same file would collapse the two hops back into one.

### What happens to a value after it is resolved

Resolved values are `Redacted`: they render as `<redacted>` through `toString`, template interpolation and `JSON.stringify`, so the usual routes into a log line or an error message are closed by construction rather than by discipline. `reposets doctor` prints references and never resolved values, and the test suite asserts that on every output stream.

Secrets are then sealed with libsodium's crypto box against the repository's public key **before they leave the process**. GitHub never returns a secret, so the encryption is verified from the other side: a workflow decrypts a known secret and reports a digest, which must match the digest of the plaintext.

### Choosing between the kinds

| Kind | On disk | Reach for it when |
| :--- | :--- | :--- |
| `value` | the value | trying something out, or the value is not secret |
| `file` | the value, in a separate file | the value is large or already a file, like a PEM key |
| `resolved` | a label | the config is shared, committed, or run anywhere but your own machine |

## Secret scopes

Secrets are assigned to a repository group through a `secrets` table with four fields:

- `actions` — secret group names to sync as GitHub Actions secrets
- `dependabot` — secret group names to sync as Dependabot secrets
- `codespaces` — secret group names to sync as Codespaces secrets
- `environments` — a table mapping environment names to arrays of secret group names

```toml
[groups.my-projects]
repos = ["repo-one", "repo-two"]
credentials = "personal"
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], environments = { production = ["api"] } }
```

## Variable scopes

Variables use a `variables` table with two fields:

- `actions` — variable group names to sync as GitHub Actions variables
- `environments` — a table mapping environment names to arrays of variable group names

```toml
[groups.my-projects]
repos = ["repo-one", "repo-two"]
credentials = "personal"
variables = { actions = ["turbo", "bot"], environments = { staging = ["turbo"] } }
```

## Scoping interactions

The same group can be assigned to several scopes at once. A `deploy` secrets group can appear in both `actions` and `environments.production`, and its entries sync independently to each — there is no deduplication and no conflict.

When several groups are referenced in one scope, they merge last-write-wins: a name declared in two groups takes the value from the one listed later.

## Environment-scoped resources

Environment-scoped secrets and variables need their environment defined in `[environments.<name>]` and listed in the group's `environments` array. Environments sync before secrets and variables, so a scoped resource always has somewhere to attach to.

```toml
[groups.my-projects]
repos = ["repo-one"]
credentials = "personal"
environments = ["staging", "production"]
secrets = { environments = { production = ["api"] } }
variables = { environments = { staging = ["turbo"] } }
```

Both halves of the assignment are checked. An environment name that is not defined and a group name that is not defined are reported separately, because a checker that looked at only one of them would pass a config that syncs nothing.

See [Environments](07-environments.md) for environment configuration.

## Complete example

Two secret groups (file and resolved), one variable group (value), and a repository group assigning them across scopes:

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
credentials = "personal"
environments = ["staging", "production"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], codespaces = ["deploy"], environments = { production = ["api"] } }
variables = { actions = ["turbo"], environments = { staging = ["turbo"] } }
```

## Removing a secret

Deleting an entry from the config does not delete it from the repository. Undeclared resources are removed only when cleanup is enabled for that scope. See [Cleanup](08-cleanup.md).
