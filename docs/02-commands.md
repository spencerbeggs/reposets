# Commands reference

Every command accepts the global `--config` flag, which takes a path to `reposets.config.toml` or to a directory containing it. Effect core contributes `--help`, `--version`, `--completions` and `--log-level` to every command (and `--wizard` when a person is at a terminal: it is not accepted in a pipe, CI, or with `--agent`), and every command also takes the audience flags `--audience`, `--human`, `--agent` and `--ci` described [below](#interactive-use-and-output).

Command output — a report, a table, a summary — goes to stdout. Diagnostics, progress and errors go to stderr. `--log-level` takes `all|trace|debug|info|warn|warning|error|fatal|none` and sets the minimum severity of the logged stderr diagnostics only. It never silences command output, and it never silences a finding: the `✗` line that explains an exit code of `1` is printed whatever the level. To quieten a run, redirect stdout: `reposets sync > /dev/null` is quiet on success and still prints errors. There is no `log_level` config key and no verbosity tiers — see [Migrating to 1.0](01-migrating-to-1.0.md#3-log_level-and-the-verbosity-tiers-are-gone).

Exit codes: `0` success, `1` a finding (invalid config, sync errors, drift, a file `init` or `nuke` could not write or remove), `64` a usage error (an unknown flag, subcommand, phase or group, a missing value nobody could be asked for, or a refused `nuke`), `130` a person cancelled a prompt.

Global flags are accepted on either side of the subcommand name, so `reposets --config ./cfg validate` and `reposets validate --config ./cfg` both parse.

A usage error is printed on stderr under an `ERROR` heading. When the parser rejected the command line — an unknown flag, say — the command's help follows it:

```bash
reposets credentials delete < /dev/null
#
# ERROR
#   Provide --profile <name>: the profile to delete.
```

## Interactive use and output

reposets writes differently for a person at a terminal, a coding agent and a CI job. It decides which one it is talking to once, at startup, and every prompt, report and failure line in the run follows that decision.

### Audience

| Flag | Description |
| :--- | :---------- |
| `--audience <human\|agent\|ci>` | Who the output is for |
| `--human` | Shorthand for `--audience human` |
| `--agent` | Shorthand for `--audience agent` |
| `--ci` | Shorthand for `--audience ci` |

Give at most one. Two of them, or the same one twice, is a usage error (exit `64`).

Without a flag, the `REPOSETS_AUDIENCE` environment variable decides (`human`, `agent` or `ci`). An invalid value is reported once on stderr and ignored. Without either, reposets detects a coding agent from the environment, then a CI system, and otherwise assumes a person. The order of precedence is therefore flag, then `REPOSETS_AUDIENCE`, then agent detection, then CI detection, then `human`.

An agent gets plain text and never receives a terminal escape, whatever the terminal could draw. That is what the examples in these docs show. A person gets the same content styled; under GitHub Actions, a report's sections become collapsible log groups.

### Prompts

reposets asks a question only when **all** of these hold: the audience is `human`, both stdin and stdout are terminals, and `TERM` is not `dumb`. An agent, a CI job, a pipe or a redirect is never prompted. Where a prompt would have asked for something, a non-interactive run either takes a documented default or is refused with a usage error naming the flag that supplies the answer:

| Command | Asks a person | Without a terminal |
| :------ | :------------ | :----------------- |
| [`init`](#init) without `--project` / `--no-project` | where to put the files | the XDG config directory |
| [`nuke`](#nuke) without `--force` | which files, then "Delete N files?" | refused, exit `64` |
| [`credentials create`](#credentials-create) with values missing | each missing value | refused, exit `64`, naming the flag |
| [`credentials delete`](#credentials-delete) without `--profile` | which profile | refused, exit `64` |
| [`history show`](#history-show) without `--run` | which run | refused, exit `64` |

Pressing Esc, `q` or Ctrl-C at any prompt cancels the command. It prints `cancelled; nothing written` and exits `130`, which is deliberately not the same outcome as answering "no".

### Colour and glyphs

Colour follows Node's rules: `NO_COLOR` turns it off, `FORCE_COLOR` turns it on and beats `NO_COLOR`, and `NODE_DISABLE_COLORS` or `TERM=dumb` turn it off. Output piped to a file carries no escapes.

Status lines lead with a glyph: `✓` success, `ℹ` information, `⚠` a warning, `↷` a skip and `✗` a failure. Success and information lines go to stdout, warnings and failures to stderr. Under `TERM=dumb` the glyphs become ASCII words — `[ok]`, `[info]`, `[warn]`, `[skip]`, `[FAIL]`.

### Diagnostics

`REPOSETS_LOG_LEVEL` turns on reposets' extra diagnostics, at the level it names — `debug`, for example. It is unset, and those diagnostics are off, by default. A person gets readable lines; an agent or a CI job gets NDJSON, one JSON object per line. `--log-level` wins when both are given.

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
#     ✓ applied settings (delete_branch_on_merge, has_wiki)
#   repo: your-username/repo-two
#     ✓ applied settings (delete_branch_on_merge, has_wiki)
# ✓ Sync complete!
# Sync: 2/2 repos, 2 changes, 0 drifted, 0 errors
```

Every action line leads with a status glyph after its indent: `✓` a change made, `ℹ` a dry run's "would" line, `⚠` a deletion, a cleanup or a drift, `↷` a skip and `✗` an error. The `group:` and `repo:` headers take none.

The closing summary line is always printed. It reads `Sync:` on a real run and `Dry run:` on a dry run, and counts the repositories finished against the repositories the run selected, so `1/2 repos` means one of the two never completed. The run exits non-zero when any error occurred or when `--fail-on-drift` was given and drift was found.

### Live progress

On a terminal, for a person, `sync` and `drift` draw a live footer under the report: a spinner, the repository being worked on and the counts so far. Report lines and error lines scroll above it as they happen. When the run ends the footer is replaced by the same summary line a non-interactive run prints. A run that fails or is interrupted closes the footer too, keeping the counts it had reached.

Anywhere else — an agent, CI, output piped or redirected — there is no footer and only the static summary is printed.

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
# group: my-repos (1 of 2 repos)
# ...
# Sync: 1/1 repo, 1 change, 0 drifted, 0 errors
```

The group header says both numbers when a filter narrowed the run, so a filter that matched less than intended is visible rather than inferable. A `--repo` matching nothing in any group is an error, not a quiet no-op:

```bash
reposets sync --repo nope
# group: my-repos (0 of 2 repos)
#     ✗ error   --repo nope: no repository named 'nope' in any configured group (has: repo-one, repo-two)
# ✗ Sync complete with 1 error:
#   --repo nope — no repository named 'nope' in any configured group (has: repo-one, repo-two)
# Sync: 0/0 repos, 0 changes, 0 drifted, 1 error
```

### Dry runs

`--dry-run` reports the same per-resource detail a real run does, with every verb in the "would" form. It writes nothing to GitHub and nothing to the drift baseline, so a dry run cannot quietly accept the drift it just reported.

```bash
reposets sync --dry-run
# group: my-repos (2 repos)
#   repo: your-username/repo-one
#     ℹ would apply   settings (delete_branch_on_merge, has_wiki)
#   repo: your-username/repo-two
#     ℹ would apply   settings (delete_branch_on_merge, has_wiki)
# ✓ Sync complete!
# Dry run: 2/2 repos, 2 changes, 0 drifted, 0 errors
```

Dry runs are recorded in the journal and show as `dry-run` in `reposets history`.

### Failure handling

One repository's failure never aborts the run. A rejected ruleset on the third repository does not cost the remaining seventeen — failures are printed as they happen, listed again at the end and recorded in the journal.

The same holds for credential profiles. A profile whose token cannot be resolved fails its own groups and leaves the rest of the run alone:

```bash
reposets sync
#     ✗ error   profile personal: could not resolve the GitHub token for profile 'personal' — environment variable REPOSETS_GITHUB_TOKEN is not set
# ✗ Sync complete with 1 error:
#   profile personal — could not resolve the GitHub token for profile 'personal' — environment variable REPOSETS_GITHUB_TOKEN is not set
# Sync: 0/2 repos, 0 changes, 0 drifted, 1 error
```

The report is written to stdout and errors to stderr, so `reposets sync > log.txt` captures the report while failures still show on the terminal. The per-resource error lines and the `Sync complete with N errors` block are logged diagnostics, so `--log-level none` hides them; the summary line on stdout and the exit code still tell you the run failed.

A config that names a section that does not exist is refused before anything is written, and that refusal is a finding, printed whatever the log level:

```bash
reposets sync
# ✗ Config references sections that do not exist:
# - groups.my-repos.settings: 'defualt' does not exist — defined: default
# Nothing was synced. Fix the references or run 'reposets validate' for the full list.
```

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
# ...
# Dry run: 3/3 repos, 0 changes, 1 drifted, 0 errors
```

This is `sync --dry-run --no-cleanup --fail-on-drift` under a name that says what it is for, running through the same code path on purpose — which is why its summary line reads `Dry run:`. Drift is decided by comparing three fingerprints — desired, live and last-applied — and that comparison lives in the phases, so a separate read-only implementation would be free to disagree with the one that actually converges.

It writes nothing to GitHub and nothing to the baseline. Cleanup is off, because a resource the config never declared is not drift; it is undeclared, which is a different question that `sync` answers.

A drift line leads with `⚠`, names the resource, says who changed it and says what the run did about it:

```bash
reposets drift --debug
# adds the applied and live fingerprints to each drift line
```

## list

Print a summary of the config: each group with its owner, credential profile, repositories and every resource it references.

```bash
reposets list
# [my-repos] (owner: your-username, credentials: personal)
#
# - your-username/repo-one
# - your-username/repo-two
#
# settings: default
```

The owner comes from the credential profile the group names, so `list` reads both files. A group naming a profile that does not exist is reported inline, marked as a failure, rather than failing the command:

```bash
reposets list
# [my-repos] (credentials: personal — NOT FOUND)
#
# - (unknown)/repo-one
```

Empty collections are omitted rather than printed as `(none)`. With no config file at all, `list` says so and exits `1`:

```bash
reposets list
# ✗ No config found. Run 'reposets init' to create one.
```

## validate

Check `reposets.config.toml` without touching the GitHub API. Reads the credentials file for its owner declarations only — nothing is resolved and no token is needed.

```bash
reposets validate
# ✓ Valid: /path/to/reposets.config.toml
#   groups: 1
```

Five classes of problem are reported, and each exits `1`.

**Schema errors.** Unknown keys are rejected rather than ignored. The failure names the file and draws the rejected keys as a tree:

```bash
reposets validate
# ✗ Config validation failed at "/path/to/reposets.config.toml"
# ├─ owner: unknown key
# └─ groups
#    └─ my-repos
#       └─ credentials: Missing key
# in: ConfigFile.discover (definition) > ConfigFile.discover > ConfigFile.loadFrom (definition) > ConfigFile.loadFrom
# Run 'reposets doctor' for suggested spellings.
```

The pointer to `doctor` is added only when a key is unknown, since a missing key has no near-match to suggest.

**TOML syntax errors** carry the parser's position under the failure line:

```bash
reposets validate
# ✗ ConfigCodecError: toml parse failed
# in: ConfigFile.discover (definition) > ConfigFile.discover > ConfigFile.loadFrom (definition) > ConfigFile.loadFrom
#   TomlParseError: TOML parse failed with 1 error: ExpectedTableHeaderClose at 0:16 expected ] to close the table header
```

The remaining three are reported as findings: a `✗ Invalid:` line naming the file, then each finding grouped under the group it belongs to, then a hint for fixing it. All of it goes to stderr.

**Dangling references**, checked first, because a group asking for a section that does not exist makes every later check about resources that were never going to be applied. Every reference array is covered, plus both halves of an environment-scoped assignment. Each finding lists the names that do exist, because nearly every one of these is a typo:

```bash
reposets validate
# ✗ Invalid: /path/to/reposets.config.toml
# [my-repos]
#
# - ✗ groups.my-repos.settings: 'defualt' does not exist — defined: default
```

**Undeclared credential labels**, where a `resolved` secret or variable names a label the group's profile does not declare in `[resolve]`:

```bash
reposets validate
# ✗ Invalid: /path/to/reposets.config.toml
# [my-repos]
#
# - ✗ app.NPM_TOKEN: credential label 'MY_NPM_TOKN' is not declared in profile 'personal'
#
# Add it to that profile's [resolve] section in reposets.credentials.toml, or correct the name.
```

This matters because the sync-time equivalent compares against resolved values, so it cannot fire until a run has authenticated and reached the secrets phase, by which point earlier phases have already written to GitHub.

**Organization-only constructs** assigned to a group whose profile declares `username`. Three constructs need an organization: a `Team` ruleset bypass actor, a `Team` environment reviewer, and delegated bypass:

```bash
reposets validate
# ✗ Invalid: /path/to/reposets.config.toml
# [my-repos]
#
# - ✗ rulesets.protect.bypass_actors: a Team bypass actor requires an organization, but profile 'personal' is a personal account
#
# Either move these repositories to a profile declaring `org`, or drop the settings.
```

Each is reported where it is referenced rather than where it is defined. A ruleset with a team actor is valid sitting in `[rulesets.*]` and only becomes an error when a personal-account group assigns it.

`sync` runs the dangling-reference check itself and refuses to write anything when it fails.

## doctor

Everything `validate` does, plus unknown-key detection, credential posture, file locations and one live check per profile.

```bash
reposets doctor
# Files
#
# Version: <version>
# Config: /path/to/reposets.config.toml
# Credentials file: /path/to/reposets.credentials.toml
# State database: /path/to/state/reposets/store.db
#
# Schema
#
# ✓ Schema validation: passed
#
# Config keys
#
# ✓ No unknown keys detected.
#
# Credentials
#
# Credentials: 1 profile(s)
#
# - [personal] github_token: env REPOSETS_GITHUB_TOKEN
#
# Token check
#
# ✓ Token [personal]: resolved, authenticates as your-username — matches username
#
# Required fine-grained token permissions
#
# - Repository > Administration (Read and write) — settings sync
# ...
#
# (Metadata: Read is mandatory and granted automatically)
#
# NOTE: These are NOT verified — GitHub does not expose a fine-grained token's own scopes.
```

The sections always appear in this order: Files, Schema, Config keys, Credentials, Token check, and the required permissions. The file diagnosis is printed before the live token check starts, so a slow GitHub never holds it back.

**`doctor` always exits `0`.** It reports; `validate` gates. A `✗` line in its output is a status, not an exit code, so use `validate` in CI and `doctor` when you want to know why.

**Unknown keys** are found by reading the raw TOML rather than the decoded config, because decoding drops what the schema does not know. Nearest-match suggestions come from Levenshtein distance, and keys removed in 1.0 get a migration hint instead of a spelling guess:

```bash
reposets doctor
# ...
# Schema
#
# ✗ Schema validation: FAILED — these values are rejected, not ignored
#
#   unknown key at owner
#   Missing key at groups.my-repos.credentials
#
# Config keys
#
# - ⚠ 'owner' removed in 1.0 — the owner now belongs to the credential profile, which declares `username` or `org`
#
# 1 warning(s) found.
```

Misspelled *settings* fields are warned about rather than rejected, because settings groups pass unknown fields through to GitHub on purpose. A warning is the only available signal that `has_wikis` will be sent and silently ignored:

```text
- ⚠ unrecognised setting 'has_wikis' in settings.default — did you mean 'has_wiki'?
```

**File locations** are printed because three files live in three directories under three different rules. The credentials path shown is the one the resolver chain actually found, not a guess from the working directory.

**The live check** resolves each profile's `github_token` and calls `GET /user` with it. Nothing above that line can tell a working setup from a revoked token, an `op://` path pointing at nothing or a service account without vault access. A `username` profile gets the one exact check available: the login GitHub returns must match the declared username.

```text
✓ Token [personal]: resolved, authenticates as your-username — matches username
```

An `org` profile is told the token's owner and its organization without any claim of having verified the pairing, because `GET /user` returns the account that owns the token rather than the organization it acts on. A token that cannot be resolved is a `✗` line naming the cause:

```text
✗ Token [personal]: could not resolve — ResolveError: Failed to resolve 'github_token' from env: environment variable REPOSETS_GITHUB_TOKEN is not set
```

**The permissions list is a requirement, not a verification.** GitHub reports a permission set for App installation tokens only, so a fine-grained token's own scopes cannot be read through the API, and the output says so in its closing note. No resolved secret value is ever printed.

## history

Show what previous sync runs did, newest first.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--limit <n>` | integer | `20` | How many runs to show |
| `--repo <owner/name>` | string | (all) | Only runs that touched this repository |

```bash
reposets history
# example output
# RUN       WHEN (UTC)        OUTCOME    MODE     GROUP     CHANGES  TOOK
# --------  ----------------  ---------  -------  --------  -------  ----
# 3f9a1c2d  2026-08-12 22:14  ✓ success  applied  my-repos        4  2.6s
# 2b81e07a  2026-08-12 22:10  ✓ success  dry-run  my-repos        4  2.1s
# 1c4d5e6f  2026-08-11 09:02  ⚠ partial  applied  (all)           0  1.2s
```

The `RUN` column is the start of the id every subcommand takes. Timestamps are UTC, unconverted, which the header says. The outcome carries a status glyph. A run that never reached its finish is shown as `interrupted` rather than folded into `failed`, and a run that failed shows its error.

Unlike `sync --repo`, this flag takes the full `owner/name`. It filters to runs that *touched* the repository, joining through the recorded changes rather than through group membership, so a run configured for a repository that changed nothing in it does not appear.

```bash
reposets history --limit 50 --repo your-username/repo-one
```

When the limit is what stopped the list, the output says so rather than truncating silently:

```text
Showing the most recent 2. Pass --limit for more.
```

An empty journal is not an error:

```bash
reposets history
# ℹ No runs recorded yet. The journal fills in as you sync.
```

### history show

Every resource one run touched, grouped by repository.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--run <id>` | string | (asked on a terminal) | A run id, or a unique prefix |

```bash
reposets history show --run 3f9a1c
# example output
# run 3f9a1c2d-....
#
# ✓ 2026-08-12 22:14 · dry-run · success · 93ms
#
# - your-username/repo-one
#   would update       settings
# - your-username/repo-two
#   would update       settings
```

Each line is the action, then the resource kind and name. The settings phase reports one resource whose kind and name are both `settings`, so it is named once. A run that failed shows its error before its changes, because on a failed run that is the answer you came for.

The id may be a unique prefix, because nobody retypes a UUID from a table. An ambiguous prefix lists the candidates and refuses (exit `64`) rather than picking one. A dry run's resources are shown in the "would" form, since the journal records the decision rather than the write.

Without `--run`, a person at a terminal picks from the newest 50 runs. The "Which run?" list labels each run the way the table does — short id, when, outcome and group — with its mode, change count and duration as detail. With nothing recorded yet it says so and exits `0`. A non-interactive run without `--run` is always refused, whether or not the journal holds anything:

```bash
reposets history show < /dev/null
#
# ERROR
#   Pass --run <id> (a run id or a unique prefix); `reposets history` lists them.
```

### history prune

Delete all but the newest runs.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--keep <n>` | integer | `50` | How many of the newest runs to keep |

```bash
reposets history prune --keep 20
# ✓ Pruned 12 runs, keeping the newest 20.
# ℹ Applied state and the cache are untouched — drift detection still works.
```

### history clear

Delete every run from the journal.

```bash
reposets history clear
# ✓ Cleared 32 runs from the journal.
# ℹ Applied state and the cache are untouched — drift detection still works.
```

Both deletions say plainly that applied state and the cache survive, and that sentence is why these exist separately from [`nuke`](#nuke). The journal is history; the applied state is the drift baseline. Conflating them would make trimming a log quietly disable drift detection.

## init

Scaffold `reposets.config.toml` and `reposets.credentials.toml` with commented templates.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--project` | boolean | (asked on a terminal) | Scaffold into the current directory. `--no-project` (or `--project=false`) scaffolds into the XDG config directory |

```bash
reposets init --project
# ✓ Created: /path/to/reposets.config.toml
# ✓ Created: /path/to/reposets.credentials.toml
# ✓ Created .gitignore with reposets.credentials.toml
#
# Done. Edit the config, then add a credential reference:
#   reposets credentials create        (on a terminal, asks for each value)
#   reposets credentials create --profile personal --username YOU --op "op://Vault/item/field"
```

With neither `--project` nor `--no-project`, a person at a terminal is asked "Where should reposets keep its config?" and offered the XDG config directory or this directory, each with its full path. Any other run uses the XDG config directory without asking.

Existing files are reported and never overwritten, so the command is safe to re-run:

```bash
reposets init --project
# ℹ Already exists: /path/to/reposets.config.toml
# ℹ Already exists: /path/to/reposets.credentials.toml
# ...
```

The credentials file is added to `.gitignore` in both modes: it holds only references, but it still names your vault layout. A file that cannot be written is reported on stderr as `Could not write: <path>` and the command exits `1`, after trying the rest.

## nuke

Delete every reposets file on this machine. **Nothing on GitHub is touched** — every secret, variable, ruleset and setting reposets has applied stays exactly where it is.

| Flag | Type | Default | Description |
| :--- | :--- | :------ | :---------- |
| `--force` | boolean | `false` | Delete without asking. Intended for scripts; there is no undo |

The command always starts by printing what it found:

```bash
reposets nuke
# This will delete:
#
# - /path/to/project/reposets.config.toml
#   project config — loses your groups and settings
# - /path/to/project/reposets.credentials.toml
#   project credentials — loses token references, not tokens
# - /path/to/config/reposets/reposets.config.toml
#   user config — loses your groups and settings
# - /path/to/config/reposets/reposets.credentials.toml
#   user credentials — loses token references, not tokens
# - /path/to/state/reposets/store.db
#   state database — loses run history AND the drift baselines — drift detection restarts from nothing
# WARNING: Deleting the state database cannot be undone: the drift baselines it holds cannot be rebuilt.
# Nothing on GitHub is touched. Everything reposets applied stays applied.
```

The list is assembled by looking rather than assuming, so it names only paths that exist. The search for project config walks up from the working directory the same way the config resolver does, because the file you are thinking of is the one the CLI would load.

Losing the state database is the only irreversible consequence in the set, which is why it gets its own warning. Config files can be restored from a backup or rewritten; the drift fingerprints cannot, and without them the next run reports a first sync where a real out-of-band edit happened.

What happens next depends on `--force` and on whether anyone can answer:

- **On a terminal, without `--force`**, a "Delete which files?" checklist follows, grouped into Project files, User files and State, with every file selected. Rows are shown as `what: ./path` for project files and `what: ~/path` under your home directory, with the absolute path as detail. Deselect the files you want to keep — the state database, say — then confirm "Delete N files?", which defaults to **no**. Deselecting everything, or answering no, prints `Nothing was deleted.` and exits `0`.
- **With `--force`**, the files are deleted without a prompt.
- **Without `--force`, anywhere else**, the command refuses rather than assuming an answer:

```bash
reposets nuke < /dev/null
# ...
# Nothing on GitHub is touched. Everything reposets applied stays applied.
#
# ERROR
#   Refusing: not an interactive terminal, and --force was not given.
```

Each removal is reported as it happens:

```bash
reposets nuke --force
# ...
# ✓ removed /path/to/config/reposets/reposets.config.toml
# ✓ removed /path/to/config/reposets/reposets.credentials.toml
# ✓ removed /path/to/state/reposets/store.db
# ✓ Done. 3 files removed.
```

A file that cannot be removed is reported on stderr and the run exits `1`, after every other file has been tried.

## credentials

Manage the named profiles in `reposets.credentials.toml`. The file holds references, never token values.

### credentials create

Add a profile. A profile needs a name, exactly one of `--username` or `--org`, and exactly one of `--op` or `--env`. On a terminal, anything the flags leave out is asked for; anywhere else, each is required.

| Flag | Type | Required | Description |
| :--- | :--- | :------- | :---------- |
| `--profile <name>` | string | yes, or asked | Profile name |
| `--username <name>` | string | one of, or asked | The personal account this profile acts as |
| `--org <name>` | string | one of, or asked | The organization this profile acts within |
| `--op <ref>` | string | one of, or asked | 1Password secret reference, `op://Vault/item/field` |
| `--env <var>` | string | one of, or asked | Name of an environment variable holding the token |

```bash
reposets credentials create --profile personal --username your-username --op "op://Private/github/token"
# ✓ Created profile 'personal' (username: your-username, github_token: op op://Private/github/token) in /path/to/reposets.credentials.toml.
```

```bash
reposets credentials create --profile ci --org your-org --env REPOSETS_GITHUB_TOKEN
# ✓ Created profile 'ci' (org: your-org, github_token: env REPOSETS_GITHUB_TOKEN) in /path/to/reposets.credentials.toml.
```

The owner is required because it is what the profile acts as, and it decides which settings are even valid for the groups that name it.

**Asking for missing values.** Run `reposets credentials create` on a terminal with some or none of the flags and it asks for the rest, in order: the profile name; who the profile acts as (a personal account or an organization, then its name); and where the token is (1Password or an environment variable, then the reference). Every flag you did give is checked first, so you are never walked through the questions only to be refused for a flag. Two conflicting flags (`--op` with `--env`, `--username` with `--org`) are refused even on a terminal, since no question resolves them. Each answer is validated as you type: a name cannot be blank or an existing profile, a 1Password reference must start with `op://`, and an environment variable name must be letters, digits and underscores. Each text prompt clears itself from the terminal when it closes.

Without a terminal, a missing value is a usage error naming the flag:

```bash
reposets credentials create --username your-username --env REPOSETS_GITHUB_TOKEN
#
# ERROR
#   Provide --profile <name>: the name a group's 'credentials' field refers to.
```

**This command never accepts a token value.** Every flag value and every typed answer is checked, and anything that looks like a credential is refused without being echoed back. A token pasted into the wrong place is already in your shell history; repeating it into a log, a profile name or the confirmation line would only widen the exposure.

```bash
reposets credentials create --profile personal --username your-username --env ghp_...
#
# ERROR
#   That looks like a credential value, not a reference. This command stores references only — pass --op "op://Vault/item/field" or --env VAR_NAME. Value not echoed.
```

At a prompt the same check says `That looks like a token, not a name. It was not stored.` or `That looks like a token, not a reference — enter where it lives.` One caveat: the prompt does not mask what you type, so a pasted value is visible until you press Enter, after which the refusal and the cleared prompt remove it.

The other refusals, all exit `64` and none echoing the value:

| Problem | Message |
| :------ | :------ |
| Both `--op` and `--env` | `Provide exactly one of --op or --env, not both.` |
| Both `--username` and `--org` | `Provide exactly one of --username or --org, not both.` |
| `--op` not an `op://` reference | `--op must be a 1Password reference starting with "op://". Value not echoed.` |
| The profile already exists | `Profile 'personal' already exists. Delete it first.` |

The profile is written back to the file it was read from, so a project-local credentials file is not silently bypassed in favour of the XDG one.

### credentials list

Show every profile, what it acts as and the references it holds.

```bash
reposets credentials list
# [personal]
#
# acts as: your-username (user)
# github_token: op op://Private/github/token
```

There is nothing to redact. The file holds addresses, so printing it in full discloses which vault items and environment variables reposets reads, never their contents. With no profiles, it prints `ℹ No credential profiles configured.`

### credentials delete

Remove a profile by name.

| Flag | Type | Required | Description |
| :--- | :--- | :------- | :---------- |
| `--profile <name>` | string | yes, or asked | Profile name to delete |

```bash
reposets credentials delete --profile old-profile
# ✓ Deleted profile 'old-profile' from /path/to/reposets.credentials.toml.
```

Without `--profile`, a person at a terminal picks from a "Delete which profile?" list, each profile shown with who it acts as and its token reference — never a value. With no profiles at all there is nothing to pick, which it says and exits `0`. A non-interactive run without `--profile` is refused with `Provide --profile <name>: the profile to delete.` (exit `64`), as is a token-shaped `--profile`. A name that matches no profile is refused with `Profile 'old-profile' not found.`
