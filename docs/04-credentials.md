# Credentials

`reposets.credentials.toml` holds named profiles. Each profile declares which GitHub account it acts as, where its token can be found and any named values the config refers to. It contains no token values: every credential in it is an address pointing somewhere else, so the file itself discloses nothing if it leaks.

## Where the file lives

The credentials file is stored in the XDG config directory, `~/.config/reposets/reposets.credentials.toml` by default, respecting `$XDG_CONFIG_HOME`.

Commands that load config discover it by walking up from the current directory and then falling back to the XDG directory. `reposets init --project` places it alongside the config file, and both are found automatically. The `--config` flag applies to the config file only, so it does not redirect credential lookup.

`reposets doctor` prints the file the resolver chain actually found, which is the reliable answer to "which credentials file is in play":

```bash
reposets doctor
# Credentials file: /path/to/reposets.credentials.toml
```

`reposets init` creates the file and adds it to `.gitignore`. Keep it out of version control: it holds no secrets, but it does describe your vault layout.

## Profile structure

Each profile is a `[profiles.<name>]` table with two required fields.

`username` or `org` — exactly one, never both — declares the account the profile acts as. A token authenticates as an identity, so the account belongs to the credential rather than to the repositories being configured.

`github_token` is a reference, not a token. It takes exactly one of `{ op = "op://..." }` or `{ env = "VAR_NAME" }`.

```toml
[profiles.personal]
username = "your-username"
github_token = { op = "op://Private/github/token" }

[profiles.work]
org = "your-org"
github_token = { op = "op://Private/github/work-token" }
```

For CI, where the platform's secret store injects the value:

```toml
[profiles.ci]
org = "your-org"
github_token = { env = "REPOSETS_GITHUB_TOKEN" }
```

Two keys rather than an `owner` plus an `owner_type` means an owner without a type cannot be written down, and a profile declaring both is rejected.

See [Token permissions](09-token-permissions.md) for the fine-grained token scopes reposets needs.

### One owner per profile

A profile acts as exactly one account. A token that reaches both your personal account and an organization is declared as two profiles sharing the same token reference. That is repetitive, and it keeps every group's owner a single lookup with no fallback chain, so a group can never write to one account using another account's token.

### What the declared type buys

The declared type gates organization-only settings offline. Team-based ruleset actors, team environment reviewers and delegated bypass all need an organization, and before the declaration existed the only way to learn the owner's type was to ask GitHub. `reposets validate` now rejects them with no network and no token:

```bash
reposets validate
# Invalid: /path/to/reposets.config.toml
#   [my-repos] rulesets.protect.bypass_actors: a Team bypass actor requires an organization, but profile 'personal' is a personal account
```

The declaration is not proof. `sync` still reads the owner's type from GitHub before writing and fails the repository with a named error on a mismatch.

## Every group names a profile

`credentials` is required on every `[groups.*]` section, including in a config with a single profile:

```toml
# reposets.config.toml
[groups.work-repos]
repos = ["repo-one"]
credentials = "work"

[groups.personal-repos]
repos = ["repo-two"]
credentials = "personal"
```

An optional field would have to mean "the only profile", which stops being well defined the moment a second profile is added: adding an unrelated profile would either change which account an existing group writes to, or turn a working config into an error, with nothing in the group itself having changed.

The field selects the profile's token as well as its `[resolve]` values, so the two groups above sync under different identities within one `sync` invocation and one row in `reposets history`. A profile whose token cannot be resolved fails its own groups and leaves the rest of the run alone.

## The 1Password service account token

`op://` references are resolved through the 1Password SDK, authenticated with the `OP_SERVICE_ACCOUNT_TOKEN` environment variable:

```bash
export OP_SERVICE_ACCOUNT_TOKEN="ops_..."
```

It is deliberately not stored in the credentials file. It unlocks everything the other references point at, so it does not belong in the same file as the addresses of those things. Scope the service account to a single vault: one credential, one grant, bounded blast radius.

`reposets doctor` reports whether the variable is set, whenever any profile uses an `op://` reference:

```bash
reposets doctor
# OP_SERVICE_ACCOUNT_TOKEN: NOT SET — op:// references cannot be resolved
```

A config with no `op` entries never needs it.

## Resolve sections

`[profiles.<name>.resolve]` defines named labels the config file can refer to. There are four sub-groups: `op`, `env`, `file` and `value`. They contribute to one flat namespace, so labels must be unique across all four within a profile.

### op

1Password references, resolved through the SDK:

```toml
[profiles.personal.resolve.op]
MY_APP_ID = "op://Private/github-app/app-id"
MY_NPM_TOKEN = "op://Private/npm/token"
```

### env

Environment variable names. The value is the variable's name, never its contents:

```toml
[profiles.personal.resolve.env]
MY_BOT_NAME = "BOT_NAME"
```

### file

Paths read from disk. They resolve relative to the directory containing `reposets.config.toml`, and absolute paths are used as-is:

```toml
[profiles.personal.resolve.file]
MY_CERT = "./certs/bot.pem"
```

### value

Inline values. Strings are used as-is and tables are JSON-stringified before use:

```toml
[profiles.personal.resolve.value]
BOT_NAME = "mybot[bot]"
REGISTRIES = { npm = "https://registry.npmjs.org" }
```

This sub-group exists for named values generally, not only for secrets. Real configs use it for structured non-secret data such as a registry list, and forcing those into 1Password buys no security. The rule that does hold is narrower: a *credential* is never inlined, and that is enforced on `github_token`.

Every resolved value is redacted internally, so it renders as `<redacted>` through string interpolation, `JSON.stringify` and error messages. Reading the plaintext takes a deliberate unwrap on the write path.

## Using resolved values

Labels are defined in the credentials file and referenced from the config file. At sync time reposets looks up each label and substitutes the value.

1. Define a label in a profile's `[resolve]` section:

   ```toml
   # reposets.credentials.toml
   [profiles.personal.resolve.op]
   MY_APP_ID = "op://Private/github-app/app-id"
   ```

2. Reference it from the config. There are two syntaxes, depending on context.

   **Secrets and variables** use `resolved`-kind groups, where the name on the left is what appears in GitHub and the label on the right is what resolves:

   ```toml
   [secrets.app.resolved]
   APP_ID = "MY_APP_ID"
   ```

   **Rulesets** use inline `{ resolved = "LABEL" }` for integer fields:

   ```toml
   [rulesets.workflow.status_checks]
   default_integration_id = { resolved = "MY_APP_ID" }
   ```

A label the profile does not declare is caught offline:

```bash
reposets validate
# Invalid: /path/to/reposets.config.toml
#   [my-repos] app.APP_ID: credential label 'MY_APP_IDD' is not declared in profile 'personal'
#
# Add it to that profile's [resolve] section in reposets.credentials.toml, or correct the name.
```

### End-to-end example

One label can be used in several places. Here a GitHub App's numeric ID resolves from 1Password once and is used as a secret, a variable, a status check integration ID and a bypass actor:

```toml
# reposets.credentials.toml
[profiles.personal]
username = "your-username"
github_token = { op = "op://Private/github/token" }

[profiles.personal.resolve.op]
MY_APP_ID = "op://Private/github-app/app-id"
```

```toml
# reposets.config.toml

# As a secret: the repo gets a secret named APP_ID
[secrets.app.resolved]
APP_ID = "MY_APP_ID"

# As a variable: the repo gets a variable named APP_BOT_ID
[variables.app.resolved]
APP_BOT_ID = "MY_APP_ID"

# As a status check integration ID, coerced to an integer
[rulesets.workflow]
name = "workflow"
type = "branch"
enforcement = "active"
targets = "default"

[rulesets.workflow.status_checks]
default_integration_id = { resolved = "MY_APP_ID" }

[[rulesets.workflow.status_checks.required]]
context = "CI"

# As a bypass actor ID, coerced to an integer
[rulesets.release]
name = "release"
type = "branch"
enforcement = "active"
targets = [{ include = "refs/heads/changesets-release/main" }]
bypass_actors = [{ actor_id = { resolved = "MY_APP_ID" }, actor_type = "Integration", bypass_mode = "always" }]
```

See [Secrets and variables](05-secrets-and-variables.md) and [Rulesets](06-rulesets.md) for more on each context.

## Managing profiles

```bash
reposets credentials create --profile personal --username your-username --op "op://Private/github/token"
# Created profile 'personal' (username: your-username, github_token: op op://Private/github/token) in /path/to/reposets.credentials.toml.
```

```bash
reposets credentials list
# [personal]
#   acts as: your-username (user)
#   github_token: op op://Private/github/token
```

```bash
reposets credentials delete --profile old-profile
# Deleted profile 'old-profile' from /path/to/reposets.credentials.toml.
```

`create` never accepts a token value. It requires exactly one of `--username` or `--org` and exactly one of `--op` or `--env`, rejects anything that looks like a credential and does not echo the value back. See [Commands](02-commands.md#credentials) for the full flag list.

`list` redacts nothing, because there is nothing to redact. It shows which vault items and environment variables reposets reads, never their contents.

## Checking that a token works

Reading the file cannot tell a working setup from a revoked token, an `op://` path pointing at nothing or a service account without vault access. `reposets doctor` resolves each profile's token and calls `GET /user` with it:

```bash
reposets doctor
# Token [personal]: resolved, authenticates as your-username — matches username
```

For a `username` profile that is an exact check: a typo becomes a named error here instead of a 404 partway through a sync. For an `org` profile, `GET /user` returns the account that owns the token rather than the organization, so doctor reports both without claiming to have verified the pairing.

A failure names the cause rather than listing possibilities:

```bash
reposets doctor
# Token [personal]: could not resolve — ResolveError: Failed to resolve 'github_token' from env: environment variable REPOSETS_GITHUB_TOKEN is not set
```

## Security notes

- Keep `reposets.credentials.toml` out of version control. `reposets init` adds the `.gitignore` entry for you.
- No command writes a token value into the file, and none prints a resolved value.
- Store the 1Password service account token in the environment, scoped to one vault.
- Migrating from an older config? Literal `github_token` values and `op_service_account_token` are rejected, not ignored. See [Migrating to 1.0](01-migrating-to-1.0.md#4-the-credentials-file-holds-references-not-secrets).
