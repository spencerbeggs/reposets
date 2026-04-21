# Commands Reference

All `reposets` subcommands accept the global `--log-level silent|info|verbose|debug` option (default: `info`), which overrides the `log_level` value set in `reposets.config.toml`.

## sync

Apply config to all repos in a group, or all groups. Loads `reposets.config.toml` and `reposets.credentials.toml`, resolves the active credential profile, and delegates to the sync engine. This is the core command.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--config <path>` | string | (optional) | Path to config directory or `reposets.config.toml` file |
| `--group <name>` | string | (optional) | Sync only a specific repo group |
| `--repo <name>` | string | (optional) | Sync only a specific repo |
| `--dry-run` | boolean | `false` | Preview changes without making them |
| `--no-cleanup` | boolean | `false` | Skip cleanup of undeclared resources |
| `--log-level` | choice | (optional) | Override output verbosity |

The `--dry-run` flag output is affected by `--log-level`: at `info` level it shows summaries of what would change, while at `verbose` level it shows per-resource "would sync" lines with full detail.

```sh
# Sync all groups
reposets sync

# Preview changes without applying
reposets sync --dry-run

# Dry-run with per-resource detail
reposets sync --dry-run --log-level verbose

# Sync a specific group
reposets sync --group my-projects

# Sync a single repo
reposets sync --repo my-repo

# Sync with verbose output
reposets sync --log-level verbose

# Use a specific config directory
reposets sync --config ./my-config/
```

## list

Show a config summary. Displays repo groups with their referenced settings, environments, secrets (by scope), variables, rulesets, and credential profile name.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--config <path>` | string | (optional) | Path to config directory or `reposets.config.toml` file |

```sh
reposets list
```

## validate

Validate `reposets.config.toml` against its schema without making any API calls. Checks schema compliance and reference integrity: verifies that referenced settings, secret, variable, and ruleset groups exist; that file paths in `file`-kind secret and variable groups exist on disk; that credential profiles referenced by groups exist in `reposets.credentials.toml`; that groups referencing environments point to environments that are actually defined; and that environment-scoped secret and variable group references are valid.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--config <path>` | string | (optional) | Path to config directory or `reposets.config.toml` file |

```sh
reposets validate
```

Example output when validation finds reference errors:

```text
$ reposets validate
Config schema: valid
Group 'my-projects': references unknown settings group 'typo-settings'
Group 'my-projects': references unknown environment 'nonexistent'
```

## doctor

Deep config diagnostics. Runs everything `validate` does, plus Levenshtein-based typo detection for unknown keys at the top level, inside `[groups.*]` sections, and inside `[cleanup]`. This includes typo detection within `[groups.*.cleanup]` sections and their `secrets` and `variables` sub-keys. Reports suggestions such as `unknown key 'has_wikis' -- did you mean 'has_wiki'?`. Also displays the required fine-grained token permissions.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--config <path>` | string | (optional) | Path to config directory or `reposets.config.toml` file |

```sh
reposets doctor
```

## init

Scaffold `reposets.config.toml` and `reposets.credentials.toml` with commented templates.

Without `--project`: creates files in the XDG config directory (`~/.config/reposets/`) and writes a `.gitignore` there containing the credentials filename.

With `--project`: creates files in the current directory and appends the credentials filename to the project's `.gitignore` (creating it if it does not exist).

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--project` | boolean | `false` | Create config in current directory instead of XDG config dir |

```sh
# Scaffold in XDG config directory
reposets init

# Scaffold in current project directory
reposets init --project
```

## credentials

Manage credential profiles stored in `reposets.credentials.toml`. Has three subcommands: `create`, `list`, and `delete`.

### credentials create

Add a new credential profile. At least one of `--github-token` or `--op-token` is required.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--profile <name>` | string | (required) | Profile name |
| `--github-token <token>` | string | (optional) | GitHub personal access token |
| `--op-token <token>` | string | (optional) | 1Password service account token |

```sh
reposets credentials create --profile personal --github-token ghp_abc123
```

### credentials list

Show all credential profiles. Token values are redacted, showing only the first and last four characters.

```sh
reposets credentials list
```

### credentials delete

Remove a credential profile by name.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--profile <name>` | string | (required) | Profile name to delete |

```sh
reposets credentials delete --profile old-profile
```
