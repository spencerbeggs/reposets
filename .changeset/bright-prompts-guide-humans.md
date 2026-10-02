---
"reposets": minor
---

## Features

### Audience-aware output

Every command now accepts `--audience <human|agent|ci>` plus the shortcuts `--human`, `--agent` and `--ci`. Passing more than one is a usage error (exit 64). When no flag is given, the audience is detected in this order: `REPOSETS_AUDIENCE`, a coding-agent environment, a CI environment, otherwise human. People get colour and glyphs, agents get plain text with no escape sequences, and GitHub Actions gets collapsible `::group::` log sections. Colour follows the usual conventions: `FORCE_COLOR` beats `NO_COLOR`, and `TERM=dumb` turns it off.

Set `REPOSETS_LOG_LEVEL` to opt into diagnostics: pretty for a person, NDJSON for an agent or CI.

### Interactive prompts

On a terminal, commands that used to demand flags now ask. Non-interactive runs (pipes, agents, CI) never prompt and fall back to the previous behavior.

* `reposets nuke` shows a "Delete which files?" checklist (everything pre-selected), then a "Delete N files?" confirmation that defaults to No. `--force` still skips straight to deleting; without `--force` and without a terminal it still refuses with exit 64.
* `reposets credentials create` walks through the profile name, whether it acts as a personal account or an organization, and where the token lives (a 1Password reference or an environment variable). `--profile` is no longer required by the parser; without a terminal, omitting it exits 64 with a message naming the flag. Token-shaped values are refused in the name flags and prompts, so a pasted token is never stored as a name.
* `reposets credentials delete` and `reposets history show` offer a picker when `--profile` / `--run` are omitted. Without a terminal, omitting them exits 64 naming the missing flag.
* `reposets init` asks where to keep its config (the XDG config directory or the current directory) when `--project` is omitted. `--project`, `--no-project` and `--project=false` are all accepted; without a terminal it still defaults to the XDG directory.
* Cancelling a prompt (Esc, q or Ctrl-C) exits with the new code `130` and writes nothing.

### Live sync progress

On a terminal, `reposets sync` and `reposets drift` show a live footer with a spinner, the current repository and running counts, while report lines scroll above it. It closes with the final summary, including when a run fails. Non-interactive runs print the static summary only.

### Richer reports

`list`, `validate`, `doctor`, `history` and `credentials list` render as structured, sectioned reports. `doctor` is organized into Files, Schema, Config keys, Credentials, Token check and Required token permissions, and still always exits 0. Config validation errors now show the rejected keys as a tree.

## Other

### Changed output wording

Human-readable output changed. Exit codes are unchanged (`0`, `1` for a finding, `64` for usage), but scripts that match on text should be reviewed:

* The sync and drift summary line is now `Sync: x/total repos, N changes, N drifted, N errors` (`Dry run:` on a dry run), replacing `N repo(s), N change(s), N drifted, N error(s)`.
* Report lines now start with a status glyph: `✓` applied, `ℹ` would-change, `⚠` delete or drift, `↷` skip, `✗` error.
* `validate` prints `✓ Valid: <path>` on success and `✗ Invalid: <path>` on stderr for findings.
* `doctor` and `list` section layouts and `history` table columns were reorganized.

If you parse output, match on exit codes rather than message text, or pass `--agent` to get plain, glyph-light output without escape sequences.

## Bug Fixes

* Findings that cause exit 1 ("No config found", "No groups configured", dangling references, `✗ Invalid:`) are no longer hidden by `--log-level`; they always reach stderr. Per-resource sync errors are still filtered by the log level.
