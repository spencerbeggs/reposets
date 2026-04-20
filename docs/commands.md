# Commands Reference

All `repo-sync` subcommands accept the global `--log-level silent|info|verbose|debug` option (default: `info`), which overrides the `log_level` value set in `repo-sync.config.toml`.

## sync

Apply config to all repos in a group, or all groups. Loads `repo-sync.config.toml` and `repo-sync.credentials.toml`, resolves the active credential profile, and delegates to the sync engine. This is the core command.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--config <path>` | string | (optional) | Path to config directory or `repo-sync.config.toml` file |
| `--group <name>` | string | (optional) | Sync only a specific repo group |
| `--repo <name>` | string | (optional) | Sync only a specific repo |
| `--dry-run` | boolean | `false` | Preview changes without making them |
| `--no-cleanup` | boolean | `false` | Skip cleanup of undeclared resources |
| `--log-level` | choice | (optional) | Override output verbosity |

```sh
# Sync all groups
repo-sync sync

# Preview changes without applying
repo-sync sync --dry-run

# Sync a specific group
repo-sync sync --group my-projects

# Sync a single repo
repo-sync sync --repo my-repo

# Sync with verbose output
repo-sync sync --log-level verbose

# Use a specific config directory
repo-sync sync --config ./my-config/
```

## list

Show a config summary. Displays repo groups with their referenced settings, environments, secrets (by scope), variables, rulesets, and credential profile name.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--config <path>` | string | (optional) | Path to config directory or `repo-sync.config.toml` file |

```sh
repo-sync list
```

## validate

Validate `repo-sync.config.toml` against its schema without making any API calls. Checks schema compliance and reference integrity: verifies that referenced settings, secret, variable, and ruleset groups exist; that file paths in `file`-kind secret and variable groups exist on disk; and that credential profiles referenced by groups exist in `repo-sync.credentials.toml`.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--config <path>` | string | (optional) | Path to config directory or `repo-sync.config.toml` file |

```sh
repo-sync validate
```

## doctor

Deep config diagnostics. Runs everything `validate` does, plus Levenshtein-based typo detection for unknown keys at the top level, inside `[groups.*]` sections, and inside `[cleanup]`. Reports suggestions such as `unknown key 'has_wikis' -- did you mean 'has_wiki'?`. Also displays the required fine-grained token permissions.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--config <path>` | string | (optional) | Path to config directory or `repo-sync.config.toml` file |

```sh
repo-sync doctor
```

## init

Scaffold `repo-sync.config.toml` and `repo-sync.credentials.toml` with commented templates.

Without `--project`: creates files in the XDG config directory (`~/.config/repo-sync/`) and writes a `.gitignore` there containing the credentials filename.

With `--project`: creates files in the current directory and appends the credentials filename to the project's `.gitignore` (creating it if it does not exist).

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--project` | boolean | `false` | Create config in current directory instead of XDG config dir |

```sh
# Scaffold in XDG config directory
repo-sync init

# Scaffold in current project directory
repo-sync init --project
```

## credentials

Manage credential profiles stored in `repo-sync.credentials.toml`. Has three subcommands: `create`, `list`, and `delete`.

### credentials create

Add a new credential profile. At least one of `--github-token` or `--op-token` is required.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--profile <name>` | string | (required) | Profile name |
| `--github-token <token>` | string | (optional) | GitHub personal access token |
| `--op-token <token>` | string | (optional) | 1Password service account token |

```sh
repo-sync credentials create --profile personal --github-token ghp_abc123
```

### credentials list

Show all credential profiles. Token values are redacted, showing only the first and last four characters.

```sh
repo-sync credentials list
```

### credentials delete

Remove a credential profile by name.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--profile <name>` | string | (required) | Profile name to delete |

```sh
repo-sync credentials delete --profile old-profile
```
