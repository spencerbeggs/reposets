# Commands reference

Every command accepts the global `--config` flag, which takes a path to `reposets.config.toml` or to a directory containing it. Effect core contributes `--help`, `--version`, `--wizard`, `--completions` and `--log-level` to every command.

`--log-level` takes `all|trace|debug|info|warn|warning|error|fatal|none` and sets the minimum severity of log records. It is the way to quieten a run: `--log-level error` prints errors only and leaves the exit code intact, and `--log-level none` prints nothing at all. There is no `log_level` config key and no verbosity tiers — see [Migrating to 1.0](01-migrating-to-1.0.md#3-log_level-and-the-verbosity-tiers-are-gone).

Global flags are accepted on either side of the subcommand name, so `reposets --config ./cfg validate` and `reposets validate --config ./cfg` both parse.

## sync

Apply the config to every repository in a group, or in all groups. Loads both TOML files, partitions groups by the credential profile they name, resolves each profile's token and walks the sync phases per repository.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--group <name>` | string | (all groups) | Sync only this group |
| `--repo <name>` | string | (all repos) | Sync only this repository, by bare name |
| `--dry-run` | boolean | `false` | Report what would change without writing anything |
| `--no-cleanup` | boolean | `false` | Skip deletion of undeclared resources |
| `--fail-on-drift` | boolean | `false` | Exit non-zero when a resource was changed outside reposets |
| `--only <phase>` | string, repeatable | (all phases) | Run only these phases |
| `--skip <phase>` | string, repeatable | (none) | Skip these phases |
| `--debug` | boolean | `false` | Annotate output with value sources and drift fingerprints |

```bash
reposets sync
# example output; counts depend on your config
# group: my-repos (2 repos)
#   repo: your-username/repo-one
#     applied settings (delete_branch_on_merge, has_wiki)
# ...
# Sync complete!
# 2 repo(s), 4 change(s), 0 drifted, 0 error(s)
```

The closing line is always printed, and the run exits non-zero when any error occurred or when `--fail-on-drift` was given and drift was found.

### Selecting phases

Phases run in a fixed order that is a correctness property rather than a preference: `settings`, `security`, `code-scanning`, `environments`, `secrets`, `variables`, `rulesets`, `cleanup`. Environments exist before the secrets scoped to them, and `cleanup` runs last so nothing just written is deleted.

`--only` and `--skip` select by phase name. Both are repeatable flags, one phase name per occurrence:

```bash
reposets sync --only secrets --only variables
# runs the secrets and variables phases only
```

`--only` wins over `--skip` when both name the same phase, and selection preserves the fixed order regardless of the order the flags were given.

Unrecognized phase names are dropped rather than rejected, and comma-separated lists are not supported. `--only settings,secrets` parses, matches no phase, and the run falls back to executing **every** phase. Pass the flag once per phase and check the phase names against the list above.

### Filtering repositories

`--repo` takes a bare repository name as written in a group's `repos` array, not `owner/name`:

```bash
reposets sync --repo repo-one
# group: my-repos (1 of 3 repos)
# ...
```

The group header says both numbers when a filter narrowed the run, so a filter that matched less than intended is visible rather than inferable. A `--repo` matching nothing in any group is an error, not a quiet no-op.

### Dry runs

`--dry-run` reports the same per-resource detail a real run does, with every verb in the "would" form. It writes nothing to GitHub and nothing to the drift baseline, so a dry run cannot quietly accept the drift it just reported.

```bash
reposets sync --dry-run
# example output
# 2 repo(s), 4 change(s), 0 drifted, 0 error(s)
```

Dry runs are recorded in the journal and show as `dry-run` in `reposets history`.

### Failure handling

One repository's failure never aborts the run. A rejected ruleset on the third repository does not cost the remaining seventeen — failures are printed as they happen, listed again at the end and recorded in the journal.

The same holds for credential profiles. A profile whose token cannot be resolved fails its own groups and leaves the rest of the run alone:

```bash
reposets sync
#     error   profile personal: could not resolve the GitHub token for profile 'personal' — environment variable REPOSETS_GITHUB_TOKEN is not set
# Sync complete with 1 error:
#   profile personal — could not resolve the GitHub token for profile 'personal' — environment variable REPOSETS_GITHUB_TOKEN is not set
# 0 repo(s), 0 change(s), 0 drifted, 1 error(s)
```

Errors are written to stderr, so `reposets sync > log.txt` still shows failures on the terminal.

## drift

Report resources changed outside reposets, and change nothing. Exits non-zero when drift is found, so it gates CI without a flag.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--group <name>` | string | (all groups) | Check only this group |
| `--repo <name>` | string | (all repos) | Check only this repository |
| `--debug` | boolean | `false` | Show the applied and live fingerprints behind each drift report |

```bash
reposets drift
# example output
# 3 repo(s), 0 change(s), 1 drifted, 0 error(s)
```

This is `sync --dry-run --no-cleanup --fail-on-drift` under a name that says what it is for, running through the same code path on purpose. Drift is decided by comparing three fingerprints — desired, live and last-applied — and that comparison lives in the phases, so a separate read-only implementation would be free to disagree with the one that actually converges.

It writes nothing to GitHub and nothing to the baseline. Cleanup is off, because a resource the config never declared is not drift; it is undeclared, which is a different question that `sync` answers.

A drift line names the resource, says who changed it and says what the run did about it:

```bash
reposets drift --debug
# adds the applied and live fingerprints to each drift line
```

## list

Print a summary of the config: each group with its owner, credential profile, repositories and every resource it references.

```bash
reposets list
# [my-repos] (owner: your-username, credentials: personal)
#   - your-username/repo-one
#   - your-username/repo-two
#   settings: default
```

The owner comes from the credential profile the group names, so `list` reads both files. A group naming a profile that does not exist is reported inline rather than failing the command:

```bash
reposets list
# [my-repos] (credentials: personal — NOT FOUND)
#   - (unknown)/repo-one
```

Empty collections are omitted rather than printed as `(none)`.

## validate

Check `reposets.config.toml` without touching the GitHub API. Reads the credentials file for its owner declarations only — nothing is resolved and no token is needed.

```bash
reposets validate
# Valid: /path/to/reposets.config.toml
#   groups: 1
```

Four classes of problem are reported, and each exits non-zero.

**Schema errors.** Unknown keys are rejected rather than ignored, and the failure names the file and the offending path:

```bash
reposets validate
# ConfigValidationError: Config validation failed at "/path/to/reposets.config.toml"
#   unknown key at owner
#   Missing key at groups.my-repos.credentials
#   Run 'reposets doctor' for suggested spellings.
```

**Dangling references**, checked first, because a group asking for a section that does not exist makes every later check about resources that were never going to be applied. Every reference array is covered, plus both halves of an environment-scoped assignment. Each finding lists the names that do exist, because nearly every one of these is a typo:

```bash
reposets validate
# Invalid: /path/to/reposets.config.toml
#   groups.my-repos.settings: 'defualt' does not exist — defined: default
```

**Undeclared credential labels**, where a `resolved` secret or variable names a label the group's profile does not declare in `[resolve]`:

```bash
reposets validate
# Invalid: /path/to/reposets.config.toml
#   [my-repos] app.NPM_TOKEN: credential label 'MY_NPM_TOKN' is not declared in profile 'personal'
#
# Add it to that profile's [resolve] section in reposets.credentials.toml, or correct the name.
```

This matters because the sync-time equivalent compares against resolved values, so it cannot fire until a run has authenticated and reached the secrets phase, by which point earlier phases have already written to GitHub.

**Organization-only constructs** assigned to a group whose profile declares `username`. Three constructs need an organization: a `Team` ruleset bypass actor, a `Team` environment reviewer, and delegated bypass:

```bash
reposets validate
# Invalid: /path/to/reposets.config.toml
#   [my-repos] rulesets.protect.bypass_actors: a Team bypass actor requires an organization, but profile 'personal' is a personal account
#
# Either move these repositories to a profile declaring `org`, or drop the settings.
```

Each is reported where it is referenced rather than where it is defined. A ruleset with a team actor is valid sitting in `[rulesets.*]` and only becomes an error when a personal-account group assigns it.

`sync` runs the dangling-reference check itself and refuses to write anything when it fails.

## doctor

Everything `validate` does, plus unknown-key detection, credential posture, file locations and one live check per profile.

```bash
reposets doctor
# Config: /path/to/reposets.config.toml
# Schema validation: passed
#
# Credentials: 1 profile(s)
#   [personal] github_token: env REPOSETS_GITHUB_TOKEN
#
# Version: <version>
# Credentials file: /path/to/reposets.credentials.toml
# State database: /path/to/state/reposets/store.db
# ...
# No unknown keys detected.
```

**Unknown keys** are found by reading the raw TOML rather than the decoded config, because decoding drops what the schema does not know. Nearest-match suggestions come from Levenshtein distance: `unknown key 'has_wikis' — did you mean 'has_wiki'?`. Keys removed in 1.0 get a migration hint instead of a spelling guess.

Misspelled *settings* fields are warned about rather than rejected, because settings groups pass unknown fields through to GitHub on purpose. A warning is the only available signal that `has_wikkis` will be sent and silently ignored.

**File locations** are printed because three files live in three directories under three different rules. The credentials path shown is the one the resolver chain actually found, not a guess from the working directory.

**The live check** resolves each profile's `github_token` and calls `GET /user` with it. Nothing above that line can tell a working setup from a revoked token, an `op://` path pointing at nothing or a service account without vault access. A `username` profile gets the one exact check available: the login GitHub returns must match the declared username.

```text
Token [personal]: resolved, authenticates as your-username — matches username
```

An `org` profile is told the token's owner and its organization without any claim of having verified the pairing, because `GET /user` returns the account that owns the token rather than the organization it acts on.

**The permissions list is a requirement, not a verification.** GitHub reports a permission set for App installation tokens only, so a fine-grained token's own scopes cannot be read through the API, and the output says so. No resolved secret value is ever printed.

## history

Show what previous sync runs did, newest first.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--limit <n>` | integer | `20` | How many runs to show |
| `--repo <owner/name>` | string | (all) | Only runs that touched this repository |

```bash
reposets history
# example output
# RUN       WHEN (UTC)        OUTCOME  MODE     GROUP     CHANGES  TOOK
# 3f9a1c2d  2026-08-12 22:14  success  applied  my-repos        4  2.6s
```

The `RUN` column is the handle every subcommand takes. Timestamps are UTC, unconverted, which the header says. A run that never reached its finish is shown as `interrupted` rather than folded into `failed`, and a run that failed shows its error.

Unlike `sync --repo`, this flag takes the full `owner/name`. It filters to runs that *touched* the repository, joining through the recorded changes rather than through group membership, so a run configured for a repository that changed nothing in it does not appear.

```bash
reposets history --limit 50 --repo your-username/repo-one
```

When the limit is what stopped the list, the output says so rather than truncating silently.

### history show

Every resource one run touched, grouped by repository.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--run <id>` | string | (required) | A run id, or a unique prefix |

```bash
reposets history show --run 3f9a1c
# example output
# run 3f9a1c2d-....
#   2026-08-12 22:14 · applied · success · 2.6s
#
#   your-username/repo-one
#     created            secret NPM_TOKEN
#     updated            settings
```

Each line is the action, then the resource kind and name. The settings phase reports one resource whose kind and name are both `settings`, so it is named once.

The id may be a unique prefix, because nobody retypes a UUID from a table. An ambiguous prefix lists the candidates and refuses rather than picking one. A dry run's resources are shown in the "would" form, since the journal records the decision rather than the write.

### history prune

Delete all but the newest runs.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--keep <n>` | integer | `50` | How many of the newest runs to keep |

```bash
reposets history prune --keep 20
# Pruned 12 runs, keeping the newest 20.
# Applied state and the cache are untouched — drift detection still works.
```

### history clear

Delete every run from the journal.

```bash
reposets history clear
# Cleared 32 runs from the journal.
# Applied state and the cache are untouched — drift detection still works.
```

Both deletions say plainly that applied state and the cache survive, and that sentence is why these exist separately from [`nuke`](#nuke). The journal is history; the applied state is the drift baseline. Conflating them would make trimming a log quietly disable drift detection.

## init

Scaffold `reposets.config.toml` and `reposets.credentials.toml` with commented templates.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--project` | boolean | `false` | Scaffold into the current directory instead of the XDG config directory |

```bash
reposets init --project
# Created: /path/to/reposets.config.toml
# Created: /path/to/reposets.credentials.toml
# Created .gitignore with reposets.credentials.toml
#
# Done. Edit the config, then add a credential reference with:
#   reposets credentials create --profile personal --username YOU --op "op://Vault/item/field"
```

Existing files are reported and never overwritten, so the command is safe to re-run. The credentials file is added to `.gitignore` in both modes: it holds only references, but it still names your vault layout.

## nuke

Delete every reposets file on this machine. **Nothing on GitHub is touched** — every secret, variable, ruleset and setting reposets has applied stays exactly where it is.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--force` | boolean | `false` | Delete without asking. Intended for scripts; there is no undo |

```bash
reposets nuke
# This will delete:
#   /path/to/reposets.config.toml
#     project config — loses your groups and settings
#   /path/to/reposets.credentials.toml
#     project credentials — loses token references, not tokens
#   /path/to/state/reposets/store.db
#     state database — loses run history AND the drift baselines — drift detection restarts from nothing
#
# Nothing on GitHub is touched. Everything reposets applied stays applied.
```

The list is assembled by looking rather than assuming, so it names only paths that exist. The search for project config walks up from the working directory the same way the config resolver does, because the file you are thinking of is the one the CLI would load.

Losing the state database is the only irreversible consequence in the set. Config files can be restored from a backup or rewritten; the drift fingerprints cannot, and without them the next run reports a first sync where a real out-of-band edit happened.

Without `--force`, the command refuses a non-interactive shell rather than assuming an answer:

```bash
reposets nuke < /dev/null
# Refusing: not an interactive terminal, and --force was not given.
```

## credentials

Manage the named profiles in `reposets.credentials.toml`. The file holds references, never token values.

### credentials create

Add a profile. Requires exactly one of `--username` or `--org`, and exactly one of `--op` or `--env`.

| Flag | Type | Required | Description |
| :--- | :--- | :------- | :---------- |
| `--profile <name>` | string | yes | Profile name |
| `--username <name>` | string | one of | The personal account this profile acts as |
| `--org <name>` | string | one of | The organization this profile acts within |
| `--op <ref>` | string | one of | 1Password secret reference, `op://Vault/item/field` |
| `--env <var>` | string | one of | Name of an environment variable holding the token |

```bash
reposets credentials create --profile personal --username your-username --op "op://Private/github/token"
# Created profile 'personal' (username: your-username, github_token: op op://Private/github/token) in /path/to/reposets.credentials.toml.
```

```bash
reposets credentials create --profile ci --org your-org --env REPOSETS_GITHUB_TOKEN
# Created profile 'ci' (org: your-org, github_token: env REPOSETS_GITHUB_TOKEN) in /path/to/reposets.credentials.toml.
```

The owner is required because it is what the profile acts as, and it decides which settings are even valid for the groups that name it.

**This command never accepts a token value.** It rejects anything that looks like a credential and does not echo the value back, on the grounds that a token pasted into the wrong flag is already in your shell history and repeating it into a log would only widen the exposure.

The profile is written back to the file it was read from, so a project-local credentials file is not silently bypassed in favour of the XDG one.

### credentials list

Show every profile, what it acts as and the references it holds.

```bash
reposets credentials list
# [personal]
#   acts as: your-username (user)
#   github_token: op op://Private/github/token
```

There is nothing to redact. The file holds addresses, so printing it in full discloses which vault items and environment variables reposets reads, never their contents.

### credentials delete

Remove a profile by name.

| Flag | Type | Required | Description |
| :--- | :--- | :------- | :---------- |
| `--profile <name>` | string | yes | Profile name to delete |

```bash
reposets credentials delete --profile old-profile
# Deleted profile 'old-profile' from /path/to/reposets.credentials.toml.
```
