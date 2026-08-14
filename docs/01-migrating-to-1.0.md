# Migrating to 1.0

Every config written before 1.0 needs edits. The changes are small, mechanical and all in the same direction: the account a group writes to is now a property of the credential profile rather than of the config file. This page shows the before and after for each one.

`reposets doctor` names every removed key it finds and says where the key went, so you can work through this page with the tool open beside it.

## What changed

| Change | Where | What to do |
| :----- | :---- | :--------- |
| `owner` removed | `reposets.config.toml`, top level and per group | Move it to the credential profile as `username` or `org` |
| `credentials` now required | every `[groups.*]` | Add the profile name, even with only one profile |
| `log_level` removed | `reposets.config.toml` top level | Delete it; use `--log-level` on the command line |
| `github_token` is a reference | `reposets.credentials.toml` | Replace the token value with `{ op = ... }` or `{ env = ... }` |
| `op_service_account_token` removed | `reposets.credentials.toml` | Delete it; export `OP_SERVICE_ACCOUNT_TOKEN` instead |

## The whole migration, side by side

Before, in `reposets.config.toml`:

```toml
owner = "your-username"
log_level = "info"

[settings.default]
has_wiki = false
delete_branch_on_merge = true

[groups.my-repos]
repos = ["repo-one", "repo-two"]
settings = ["default"]
```

After:

```toml
[settings.default]
has_wiki = false
delete_branch_on_merge = true

[groups.my-repos]
repos = ["repo-one", "repo-two"]
credentials = "personal"
settings = ["default"]
```

Before, in `reposets.credentials.toml`:

```toml
[profiles.personal]
github_token = "github_pat_your_token_here"
op_service_account_token = "ops_your_service_account_token"
```

After:

```toml
[profiles.personal]
username = "your-username"
github_token = { op = "op://Private/github/token" }
```

The owner has not disappeared. It moved from the config file to the profile, and the group now points at the profile by name.

## 1. `owner` moved to the credential profile

A token authenticates *as* an account, so the account is a property of the credential rather than of the repositories being configured. `owner` is gone from the top level of `reposets.config.toml` and from every `[groups.*]` section. A profile declares exactly one of `username` or `org` instead.

```toml
# reposets.credentials.toml
[profiles.personal]
username = "your-username"
github_token = { op = "op://Private/github/token" }

[profiles.work]
org = "your-org"
github_token = { op = "op://Private/github/work-token" }
```

Two keys rather than an `owner` plus an `owner_type` means an owner without a type cannot be written down. A profile that declares both `username` and `org` is rejected.

If a group used to override the top-level `owner`, it now names a different profile. One profile is one owner, so a token that reaches both your account and an organization is declared as two profiles sharing the same token reference.

Declaring the type also buys an offline check. `reposets validate` can now reject organization-only settings assigned to a personal-account group without a token and without a network call, where previously they surfaced as an HTTP 422 partway through a sync.

## 2. `credentials` is required on every group

Add `credentials = "<profile-name>"` to every `[groups.*]` section, including in a config with only one profile.

```toml
[groups.my-repos]
repos = ["repo-one", "repo-two"]
credentials = "personal"
settings = ["default"]
```

An optional field would have to mean "the only profile", which stops being well defined the day a second profile is added. Requiring it means adding an unrelated profile can never change which account an existing group writes to.

The field selects the profile's **token** as well as its `[resolve]` values, so one config can now span a personal account and an organization in a single `sync`. Groups are partitioned by profile and each partition runs under its own identity. It is still one run in `reposets history`.

## 3. `log_level` and the verbosity tiers are gone

Delete `log_level` from `reposets.config.toml`. The four tiers (`silent`, `info`, `verbose`, `debug`) no longer exist and `sync` has no `--log-level` of its own. Output is one level.

To quieten a run, use the `--log-level` flag Effect core contributes to every command:

```bash
reposets sync --log-level error
# errors only; the exit code is unchanged
```

| Flag | Output | Errors shown | Exit code |
| :--- | :----- | :----------- | :-------- |
| (none) | everything | yes | correct |
| `--log-level error` | errors only | yes | correct |
| `--log-level none` | nothing | no | correct |

`--log-level error` is what the old `silent` tier should have been: quiet on success, loud on failure. `--log-level none` is the CI form where only the exit code matters. The old `silent` suppressed errors too, so a failing run printed nothing at all.

For diagnostics, `sync` and `drift` take `--debug`, which annotates lines that print either way with where a resolved value came from and with the fingerprints behind a drift report.

## 4. The credentials file holds references, not secrets

`github_token` is now an address rather than a value. It takes exactly one of `{ op = "op://..." }` for a 1Password item or `{ env = "VAR_NAME" }` for an environment variable.

```toml
[profiles.personal]
username = "your-username"
github_token = { op = "op://Private/github/token" }

[profiles.ci]
org = "your-org"
github_token = { env = "REPOSETS_GITHUB_TOKEN" }
```

`op_service_account_token` is no longer accepted anywhere in the file. The 1Password service account token comes from the `OP_SERVICE_ACCOUNT_TOKEN` environment variable:

```bash
export OP_SERVICE_ACCOUNT_TOKEN="ops_..."
```

`reposets credentials create` reflects this. It no longer accepts a token value, and it requires an owner:

```bash
reposets credentials create --profile personal --username your-username --op "op://Private/github/token"
# Created profile 'personal' (username: your-username, github_token: op op://Private/github/token) in <path>.
```

Pass `--env VAR_NAME` instead of `--op` when the token comes from the environment. The command rejects anything that looks like a credential value and does not echo it back.

## Working through it with doctor

Run `reposets doctor` against the old config first. It names each removed key and where it went, before the schema errors:

```bash
reposets doctor
# Config: /path/to/reposets.config.toml
# Warning: 'owner' removed in 1.0 — the owner now belongs to the credential profile, which declares `username` or `org`
# Warning: 'log_level' removed in 1.0 — output is one level; use --debug for diagnostics, or core's --log-level to filter by severity
# Warning: 'owner' in groups.my-repos removed in 1.0 — a group's owner comes from the profile named by its `credentials`, so a group cannot override it
# Schema validation: FAILED — these values are rejected, not ignored
#   unknown key at owner
#   unknown key at log_level
#   unknown key at groups.my-repos.owner
#   Missing key at groups.my-repos.credentials
# ...
```

The credentials file is reported in the same run:

```text
Credentials: FAILED to load — Config validation failed at "/path/to/reposets.credentials.toml"
  Unknown keys are rejected. `op_service_account_token` was removed — that token now comes from OP_SERVICE_ACCOUNT_TOKEN in the environment.
```

These keys are rejected, not ignored. A config carrying any of them fails to load, so there is no window in which a stale key is silently doing nothing.

## Checklist

1. Delete `owner` from the top level of `reposets.config.toml`.
2. Delete `owner` from every `[groups.*]` section.
3. Delete `log_level` from `reposets.config.toml`.
4. Add `username` or `org` to every profile in `reposets.credentials.toml`.
5. Replace each `github_token` value with `{ op = "..." }` or `{ env = "..." }`.
6. Delete `op_service_account_token` and export `OP_SERVICE_ACCOUNT_TOKEN` instead.
7. Add `credentials = "<profile>"` to every `[groups.*]` section.
8. Run `reposets validate`, then `reposets doctor`, then `reposets sync --dry-run`.

## What you get after migrating

- `reposets drift` reports resources changed outside reposets and exits non-zero, without changing anything. See [Commands](02-commands.md#drift).
- `reposets history` shows what past runs did, with `show`, `prune` and `clear` subcommands. See [Commands](02-commands.md#history).
- `reposets nuke` removes every reposets file on the machine. See [Commands](02-commands.md#nuke).
- `sync --only` and `sync --skip` select phases by name, and `--fail-on-drift` turns drift into a CI signal.
- `reposets validate` checks reference integrity, organization-only constructs and undeclared credential labels, all offline.
- One config can span several accounts, because each group names the identity it is synced as.
