---
type: Interface
title: The reposets command line
description: The command tree, flags, prompts, output channels and exit-code promises the reposets CLI makes to the people, agents and CI jobs that run it.
kind: cli
resource: ../../package/src/cli/index.ts
tags: [dx, github, effect]
generated:
  by: okfit/claude-code
  at: 2026-10-02T17:48:12Z
  body_sha256: f4e35312c197c6d7f2e0bcc80f15718485e3e5cde6f67271ea610558fe774a56
sources:
  - id: cli-index
    resource: ../../package/src/cli/index.ts
  - id: cli-flags
    resource: ../../package/src/cli/flags.ts
  - id: effected-cli
    resource: npm:@effected/cli@0.11.0
  - id: effected-env
    resource: npm:@effected/env
  - id: invocation
    resource: ../../package/src/services/Invocation.ts
  - id: core-command
    resource: ../../.repos/effect/packages/effect/src/cli/Command.ts
  - id: bin-e2e
    resource: ../../package/__test__/cli/bin.e2e.test.ts
  - id: cli-sync
    resource: ../../package/src/cli/commands/sync.ts
  - id: cli-drift
    resource: ../../package/src/cli/commands/drift.ts
  - id: cli-validate
    resource: ../../package/src/cli/commands/validate.ts
  - id: cli-doctor
    resource: ../../package/src/cli/commands/doctor.ts
  - id: cli-history
    resource: ../../package/src/cli/commands/history.ts
  - id: config-files
    resource: ../../package/src/services/ConfigFiles.ts
  - id: cli-init
    resource: ../../package/src/cli/commands/init.ts
  - id: cli-nuke
    resource: ../../package/src/cli/commands/nuke.ts
  - id: cli-credentials
    resource: ../../package/src/cli/commands/credentials.ts
  - id: sync-logger
    resource: ../../package/src/services/SyncLogger.ts
  - id: sync-progress
    resource: ../../package/src/cli/views/sync-progress.tsx
  - id: sync-progress-model
    resource: ../../package/src/cli/views/sync-progress-model.ts
  - id: commands-doc
    resource: ../../docs/02-commands.md
---

# The reposets command line

`reposets` is built on `effect/cli` — Effect core's own CLI framework
on the v4 line, where the old `@effect/cli` package does not exist. One
subcommand file lives under `package/src/cli/commands/`, and
[`package/src/cli/index.ts`](../../package/src/cli/index.ts) registers them
on the root command via `Command.withSubcommands`. It runs the tree through
`CliAudience.run(cli, { version })` wrapped in `@effected/cli`'s
`CliRuntime.main`, which owns failure reporting, the logger, the audience
and the exit code.[^cli-index][^effected-cli] How output is drawn for each
audience, and when a command may ask a question, is
[adopt-interactive-cli-kit](../decisions/adopt-interactive-cli-kit.md). For the full flag and argument
reference, see [`docs/02-commands.md`](../../docs/02-commands.md).[^commands-doc]

## Command tree

```text
reposets [--config] [--audience <human|agent|ci> | --human | --agent | --ci]
  sync   [--group] [--repo] [--dry-run] [--no-cleanup] [--fail-on-drift]
         [--debug] [--only <phase>...] [--skip <phase>...]
  drift  [--group] [--repo] [--debug]
  list
  validate
  doctor
  history [--limit] [--repo]
    show  [--run <id-or-prefix>]
    prune [--keep]
    clear
  init [--project | --no-project]
  nuke [--force]
  credentials
    create [--profile] [--username <u> | --org <o>] [--op <ref> | --env <var>]
    list
    delete [--profile]
```

The audience flags are shared by every command, so they parse on either
side of a subcommand name. Brackets around a flag that a prompt can answer
mean the parser accepts it missing, not that the command does: see
[Prompts](#prompts).

## Global flags

`--config` is the only global flag reposets defines
(`Command.withGlobalFlags([ConfigFlag])`): a path to `reposets.config.toml`,
or a directory containing it. It is declared with `GlobalFlag.Setting`
rather than a plain parent flag specifically so it parses on either side of
the subcommand name — `reposets --config x validate` and
`reposets validate --config x` both work, where a plain parent flag rejects
the trailing form.[^cli-flags] An explicit `--config` never falls through to
the XDG config: a path that does not exist fails with `ConfigFlagNotFound`,
and a directory with no `reposets.config.toml` in it fails with
`ConfigFlagMissingConfig`, whose message names the directory and the file it
looked for. Both are typed failures, so exit 1. Only the file's existence is
checked; a config that is present but invalid is still loaded, so `doctor`
can diagnose it.[^config-files] Core contributes `--help`, `--version`,
`--completions` and `--log-level` on top of it, plus `--wizard` on an
interactive run only: when nobody can answer a prompt, the kit's
`CliPrompt.gateWizard` drops it, and passing it is then an unrecognized
flag (exit 64). `--version`
prints the version the bundler substituted at build time, the same value
`doctor` reports.[^cli-index]

`--audience <human|agent|ci>` and its shorthands `--human`, `--agent` and
`--ci` are shared flags (`Command.withSharedFlags(CliAudience.flags())`).
Passing more than one is a usage error, exit 64.[^cli-index][^effected-cli]

## Environment variables

| Variable | Effect |
| :--- | :--- |
| `REPOSETS_AUDIENCE` | `human`, `agent` or `ci`. Overrides audience detection; an audience flag still wins. An unrecognised value is warned about once and ignored. |
| `REPOSETS_LOG_LEVEL` | Opts into the kit's diagnostics: pretty lines for a person, NDJSON for an agent or CI. |
| `FORCE_COLOR`, `NO_COLOR`, `NODE_DISABLE_COLORS`, `TERM` | Colour follows Node's rules: `FORCE_COLOR` beats `NO_COLOR`, and `NODE_DISABLE_COLORS` or `TERM=dumb` turns colour off. `TERM=dumb` also makes the run non-interactive. |
| `OP_SERVICE_ACCOUNT_TOKEN` | Read when a `1Password` reference is resolved, never stored. See [`interfaces/credentials-file.md`](credentials-file.md). |

The audience is resolved once, in this order: an audience flag, then
`REPOSETS_AUDIENCE`, then agent detection, then CI detection, then
`human`.[^cli-index][^effected-env]

`Command.provide(ConfigLive)` and `Command.provide(CredentialsFilesLive)`
sit on the root command rather than on each subcommand — subcommand
requirements bubble into the parent's `R` through `withSubcommands`, so one
`provide` covers every subcommand.[^cli-index] The databases are the
exception: `sync` and `drift` are each given `store.db` and `cache.db`, and
`history` is given `SyncJournalLive` over `store.db` alone, by a
per-command `Command.provide`. History's provide wraps its own
`withSubcommands`, so it covers `show`, `prune` and `clear`. No other
command opens, and so creates, either file. The platform layer handed to
`CliRuntime.main` supplies Node's services, the directories (`Xdg` and
`AppDirs`, built as `App.layer` builds them, without its databases) and
the `Invocation` service. `main`'s `env` option builds the
rest: the audience, the terminal facts (stdin and stdout from core's
`Stdio`, stderr from `process.stderr.isTTY`), the theme, `CliInteractive`
and the colour-aware help formatter. `Invocation` carries the working
directory and the version. Environment variables are read through Effect's
`Config`, not `process.env`. `index.ts` is the only file under
`package/src` that reads `process`.[^cli-index][^invocation]

## Audience and interactivity

The audience decides how output is drawn. A `human` gets colour and glyphs
when the stream supports them. An `agent` gets the same text with the
glyphs unpainted and never an escape sequence. A `ci` run under GitHub
Actions gets each `Doc` report folded into a `::group::` block.[^effected-cli]

Whether a run may ask a question is `CliInteractive`, decided once by
`CliRuntime.main`: true only for a `human` audience with a terminal on
both stdin and stdout and a `TERM` that is not `dumb`. A non-interactive
run never prompts. It either refuses with exit 64, naming the flag that
would have answered, or takes the default it always took. Nothing
destructive happens because nobody was there to answer.[^effected-cli]

## Prompts

Each prompt answers a missing input. The non-interactive column is what
a pipe, an agent or CI gets instead.

| Command | Asked when | Interactive | Non-interactive |
| :--- | :--- | :--- | :--- |
| `nuke` | `--force` is absent | "Delete which files?" checklist, every target pre-selected, in sections Project files, User files, State and Cache; then "Delete N files?", default No | Refused, exit 64, naming `--force` |
| `credentials create` | `--profile` is absent | "Profile name" text field | Refused, exit 64: `Provide --profile <name>: …` |
| `credentials create` | neither `--username` nor `--org` | "Who does this profile act as?" (a personal account or an organization), then the name | Refused, exit 64, naming both flags |
| `credentials create` | neither `--op` nor `--env` | "Where is the GitHub token?" (1Password or an environment variable), then the reference | Refused, exit 64, naming both flags |
| `credentials delete` | `--profile` is absent | "Delete which profile?" picker; each row shows the owner and the token reference, never a value | Refused, exit 64: `Provide --profile <name>: the profile to delete.` |
| `history show` | `--run` is absent | "Which run?" picker over the newest 50 runs | Refused, exit 64, naming `--run` |
| `init` | neither `--project` nor `--no-project` | "Where should reposets keep its config?": the XDG config directory, the default, or this directory, each shown with its path | The XDG config directory |

Cancelling any prompt (Esc, `q`, Ctrl-C) prints `cancelled; nothing
written` and exits 130.[^effected-cli] Deselecting every `nuke` target, or
answering No, is a deliberate answer: `Nothing was deleted.`, exit 0.
A `credentials delete` or interactive `history show` with nothing to pick
says so and exits 0.[^cli-nuke][^cli-credentials][^cli-history]

## The live view

An interactive `sync` or `drift` draws a footer that redraws in place: a
spinner, the repository being worked on, and the counts so far. The report
lines and every error line scroll above it. When the run ends, the footer's
last frame, the summary, stays on the terminal. The view also closes, with
the counts of what got done, when the run fails or is
interrupted.[^cli-sync][^sync-progress]

A run that is not interactive draws no view and does not load React or
Ink. It prints the same summary block statically once the run is done.
The summary reads `Sync: 3/3 repos, 4 changes, 0 drifted, 0 errors`, or
`Dry run: …` on a dry run. The denominator is the repositories the run
selected, and every counter shows at zero.[^sync-progress-model]

## stdout is output, stderr is diagnostics and failures

Three kinds of write reach the terminal, and each has fixed rules:

- **Reports** are `Doc` documents printed with `Doc.print`, to stdout:
  `list`, `doctor`, `history` and `show`, `credentials list`, `nuke`'s
  target list, `validate`'s group count, and the static sync
  summary.[^effected-cli]
- **Outcome lines** are `CliMessage` lines with a status glyph. Success
  (`✓`) and info (`ℹ`) go to stdout: `Valid:`, `Created:`,
  `Already exists:`, `removed <path>`, the credentials confirmations,
  `prune` and `clear` results. Warning (`⚠`) and failure (`✗`) go to stderr:
  every finding that exits 1 without a report of its own.
- **Diagnostics** are `Effect.log*`, on stderr, because the kit's logger
  sends every level there: sync's per-resource error lines, `init`'s
  next-steps hint and `Could not write:`, and `nuke`'s
  `could not remove`.[^sync-logger][^cli-init][^cli-nuke]

The `SyncLogger` report streams line by line to stdout rather than as one
document. Each action line leads with a status glyph after its indent: `✓`
applied or synced, `ℹ` a dry run's `would …`, `⚠` a deletion, a cleanup or
a drift, `↷` a skip, and `✗` an error. An error line goes through the
logger, which strips escapes, so its glyph is never painted. A clean run
ends `✓ Sync complete!` on stdout; one with errors ends `✗ Sync complete
with N errors:` and the list, on stderr.[^sync-logger]
`reposets drift > report.txt` captures the report and leaves failures on
the terminal.

## `--log-level` filters diagnostics, not output

`--log-level` is core's own severity filter (`all|trace|debug|…|none`).
Core applies it around the command handler only, so it filters the
handler's `Effect.log*` calls and nothing else.[^core-command] There is no
`log_level` config key and no verbosity tier either:

| | reports and outcome lines | finding lines on stderr | handler diagnostics on stderr | usage errors and escaped failures | exit code |
| :--- | :--- | :--- | :--- | :--- | :--- |
| default | printed | printed | printed | printed | correct |
| `--log-level error` | printed | printed | errors only | printed | correct |
| `--log-level none` | printed | printed | none | printed | correct |

A finding is a `CliMessage.failure` line, not a diagnostic, so a run that
exits 1 always says why. Sync's per-resource error lines and its
`Sync complete with N errors:` block are diagnostics and are
filtered.[^cli-sync][^sync-logger] To quiet the report, redirect stdout.
`--log-level` does not do it; see
[`gotchas/log-level-none-still-prints-reports.md`](../gotchas/log-level-none-still-prints-reports.md).
Neither form changes what `sync` or `drift` does, only what reaches the
terminal.

## `--only` wins over `--skip`

`sync` and `drift` select phases from `PHASE_NAMES` with `--only` and
`--skip`. When a name appears in both, `--only` wins: an explicit inclusion
is a stronger statement than an exclusion, and the alternative — running
nothing — is worse than an ambiguous but non-empty result. An unrecognised
phase name in either flag is refused outright rather than filtered out
silently, and refuses the whole invocation with `Unknown phase name(s): …`
rather than running the phases it did recognise. It is checked before the
config is loaded, and it is a usage error (exit 64).[^cli-sync] Phase selection
always preserves `PHASE_NAMES` order regardless of the order the names were
typed in.

## `drift` is `sync` under a different name

`drift` calls the exact same `syncHandler` that backs `sync`, fixing
`dryRun: true`, `noCleanup: true` and `failOnDrift: true` and disabling
`--only`/`--skip`.[^cli-drift] This is deliberate rather than a shortcut:
the three-way comparison between desired, live and last-applied state lives
inside the phases, and a separate read-only implementation of `drift` would
be a second copy of that decision, free to disagree with the one that
actually converges a real sync. Every phase gates its writes — including
recording the applied-state fingerprint — on `dryRun`, so a drift check
cannot quietly adopt the drift it just reported as the new baseline.
Cleanup stays off under `drift` because an undeclared resource is not
drift; that is a different question, and one only `sync` answers. `drift`
exits non-zero when it finds drift, which is what lets it gate CI without
an extra flag.

## `validate` checks three things, in order, offline

`validate` decodes the config against the schema, then runs three checks
that only reading both `reposets.config.toml` and
`reposets.credentials.toml` makes possible without touching
GitHub.[^cli-validate] The order matters:

1. **Reference integrity** (`danglingReferences`) runs first, because a
   group asking for a section that does not exist makes every later check
   about resources that were never going to be applied anyway.
2. **Undeclared credential labels** (`undefinedCredentialLabels`) — a
   `resolved` secret or variable naming a label the group's profile does
   not declare in its `[resolve]` section.
3. **Organization-only constructs** (`orgOnlyViolations`) — a ruleset
   bypass actor, an environment reviewer, or a delegated bypass reviewer
   declared as a `Team`, assigned to a group whose credential profile
   declares `username` rather than `org`.

Each violation is reported where it is *referenced*, not where it is
defined, because "referenced" is where a config author actually needs to
look to fix it. Credentials are read here only for their owner
declarations (`username` versus `org`); nothing is resolved and no network
request is made. On success, `validate` states the outcome first —
`✓ Valid: <path>`, then `groups: N` — on stdout, so a passing run cannot be
misread as a complaint. On a finding it prints `✗ Invalid: <path>` and a
document grouped by `[group]`, each violation a `✗ <where>: …` line and the
fix hint last, all on stderr, and exits 1.[^cli-validate]

## `doctor` — schema posture plus live posture

`doctor` decodes the config against the schema as `validate` does, but it
does not run `validate`'s three reference checks. It adds
Levenshtein-distance typo detection against the raw TOML for unknown keys,
prints migration hints for keys 1.0 removed via a `REMOVED_KEYS` map keyed
by the same `where` suffix the warning uses (`owner`, `owner (in groups)`,
`log_level`), and makes one live `GET /user` call per credential
profile.[^cli-doctor]

That live check exists because everything else `doctor` does reads local
files, and file-reading alone cannot distinguish a working setup from a
revoked token, an `op://` reference pointing at nothing, or a service
account without vault access — all three produce identical local output.
The result is worded per profile kind through `describeIdentity`, because
`GET /user` returns the account that *owns* the token, which is a user
even when the profile's whole purpose is an organization: reporting that
as "authenticates as spencerbeggs" beside `org = "..."` would read as a
contradiction. A `username` profile gets the one exact check available for
free — `login === username`, turning a typo into a named error instead of
a 404 mid-sync; an `org` profile is told the token's owner and declared
org without any claim that the pairing was verified, because nothing in
`GET /user` can prove that.

`doctor` prints `REQUIRED_PERMISSIONS` as a requirement, never a
verification: GitHub exposes a permission set for GitHub App installation
tokens only, so a fine-grained personal access token's own scopes are not
readable through the API, and the output says so explicitly. `doctor` also
answers "which files?" — it prints the version, the credentials file the
resolver chain actually found via `discover` (marked `(not created yet)`
when the chain finds nothing, never guessed from cwd), and the state
database path.

The report runs in sections, in order: Files (version, config,
credentials file, state database), Schema, Config keys (unknown keys as
`⚠` lines), Credentials, Token check, and Required fine-grained token
permissions, whose not-verified sentence is a note callout. It is printed
in two parts, so the file diagnosis appears before the live `GET /user`
calls return. When `doctor` cannot get that far, because there is no
config or the TOML does not parse, it prints the Files section and a
`CliMessage.failure` line.[^cli-doctor]

`doctor` always exits 0: it reports, and `validate` gates. Its `✗` lines
are status, not an exit code. See [Exit codes](#exit-codes).

## `history`, `show`, `prune`, `clear`

`history` lists past runs newest first as a table: `RUN` (the id cut to the
shortest prefix no other run in the journal shares, never fewer than eight
characters, the way git abbreviates a hash), `WHEN` (UTC), `OUTCOME` with its glyph, `MODE`,
`GROUP`, `CHANGES` and `TOOK`. An empty journal is an info line and exit
0.[^cli-history] `show --run <prefix>` accepts
any unique prefix of a run id rather than the full id: an ambiguous prefix
lists the candidates instead of guessing, and no match says so plainly,
both exit 64.

Without `--run`, a non-interactive `show` is refused with exit 64 naming
`--run`, always. The refusal comes before the journal is read, so a
script's exit code never depends on whether any run is recorded. Only an
interactive run looks at the journal: it offers a picker over the newest 50
runs, each labelled `id · when · outcome · group` with `mode · N changes ·
took` as detail, or says `No runs recorded yet.` and exits 0 when there is
nothing to pick.[^cli-history] The picker's labels use the same
abbreviation as the table. Run ids are UUIDv7, whose leading digits are a
millisecond timestamp, so the first eight change only about every 65
seconds; a fixed eight-character id would print the same handle for runs a
minute apart, and `show --run` would refuse it as ambiguous. Uniqueness is
computed across every run in the journal, not just the rows printed.
`prune --keep <n>` and `clear` both state, in their own output, that
applied state and the cache are left untouched — the journal is history,
the applied state is the drift baseline, and conflating the two would make
trimming a log quietly disable drift detection.

## `nuke`

`nuke` deletes every reposets file on this machine and touches nothing on
GitHub.[^cli-nuke] Three properties are load-bearing:

- It lists **only paths that exist**, assembled by looking rather than
  assuming, because a prompt that overstates is a prompt people learn to
  skim. With nothing found it prints `Nothing to remove — no reposets
  files found on this machine.` and exits 0. That line is reachable only
  because `nuke` itself opens no database.
- It names what each loss costs, per target, and says of the state
  database specifically that the drift baselines cannot be reconstructed —
  the one irreversible consequence in the set. Config files can be
  restored from a backup or rewritten; fingerprints cannot.
- Without `--force` it refuses when the run is not interactive, rather
  than assuming an answer. A destructive command that proceeds because
  nobody was there to answer is the one failure mode worth engineering
  against. The check is `CliInteractive`, the same answer every prompt
  uses. The refusal is a `CliError.UserError` and exits 64.

The targets are: project config and credentials (upward walk), user config
and credentials, the user config directory's `.gitignore` only when every
non-blank line is the credentials filename `init` writes, the state
database and the cache database. A database is one target that covers its
SQLite companions (`-wal`, `-shm`, `-journal`) when present. It is found
when any of those files exists, so companions orphaned by an older version
are cleaned up too. A project directory's `.gitignore` is never a
target.[^cli-nuke]

It always prints what it found first, as a document: each path with
`what — <cost>`, a warning callout when the state database is included,
and `Nothing on GitHub is touched…`. A `--force` run then
deletes without a screen. An interactive run without `--force` asks
through the checklist and confirmation in [Prompts](#prompts); deselecting
everything or answering No deletes nothing and exits 0.[^cli-nuke]

Once confirmed, `nuke` attempts every chosen target even when one fails.
Each removal prints `✓ removed <path>`, and a clean run ends `✓ Done. N
files removed.` A target it could not remove is logged to stderr as
`could not remove <path>`, a `✗ Removed N of M files` line follows, and
the run exits 1 through `CliExit` after the rest were tried. Every count —
the confirmation's "Delete N files?" and both closing lines — is in files,
the unit of the `removed` lines: a database's companions are listed and
chosen with it as one target but counted as the files they are.
After a confirmed or forced run, the `reposets` directories under the XDG
config, state, cache and data homes are removed when empty (`✓ removed
empty directory <path>`). They are never listed as targets, and a
non-empty one is kept.

## `init` and `credentials`

`init` scaffolds `reposets.config.toml` and `reposets.credentials.toml`.
`--project` writes to the current directory and `--no-project` (or
`--project=false`) to the XDG config directory. With neither, an
interactive run asks and anyone else gets the XDG directory. It never
overwrites an existing file — `ℹ Already exists:` rather than `✓ Created:`
— so it stays safe to re-run against an already-configured machine, and it
adds the credentials file to `.gitignore` in both modes.[^cli-init] Each
scaffolded file opens with a `#:schema <url>` directive and a blank line,
naming the versioned JSON Schema it was written against
(`schemas/3.0/config.json` or `schemas/3.0/credentials.json` on `main`) — see
[json-schemas](json-schemas.md). A file
it could not write, the `.gitignore` included, is logged to stderr as
`Could not write: <path>`. The remaining files are still attempted, and
the run exits 1 through `CliExit`. The closing hint offers both a bare
`reposets credentials create`, which asks for each value on a terminal, and
the full flag form.

`credentials create` needs a profile name, exactly one of
`--username`/`--org` (what the profile acts as, which decides which
settings are even valid for it) and exactly one of `--op`/`--env` (a
*reference*, never a token value). Every flag given is validated before
any prompt, so a person is never walked through questions only to be
refused for a flag. Both of `--op` and `--env`, or both of `--username`
and `--org`, an `--op` that does not start with `op://`, and a profile
that already exists are refused with exit 64 even on a terminal, since no
question resolves them.[^cli-credentials]

The command refuses anything token-shaped, by prefix or by length, in
every flag (`--profile`, `--username`, `--org`, `--op`, `--env`) and every
typed answer, and never repeats the value. A refused flag exits 64 with
nothing written. A refused answer is rejected inside the prompt with `That
looks like a token, not a name. It was not stored.` or `That looks like a
token, not a reference — enter where it lives.`, and each text prompt's
frame is cleared when it closes. A value being typed is visible until it is
submitted: see
[`limitations/text-input-shows-a-pasted-token.md`](../limitations/text-input-shows-a-pasted-token.md).[^cli-credentials]

`credentials list` prints one `[name]` section per profile with its owner
and token reference, never a resolved value. `credentials delete` removes
a profile from whichever file `discover` found it in; a token-shaped
`--profile` is refused with exit 64.[^cli-credentials]

## Saying what was selected, not just what was acted on

`groupStart` on `SyncLogger` takes both `selected` and `declared` repo
counts, and prints `group: <name> (1 of 3 repos)` when a `--repo` filter
narrowed the run and `(3 repos)` when it did not.[^sync-logger] A filter
that matched less than intended is therefore visible in the header itself
rather than something a reader has to infer from an unexpectedly short
summary line.

## Reporting a bad config

A config that fails to read or decode is not caught by the command. It
propagates out of the handler, and `CliRuntime.main` renders it through the
entrypoint's `render` callback on stderr, then exits 1.[^cli-index] For a
`ConfigValidationError`, `render` returns the kit's default report, a `✗`
status line and the issue drawn as a tree of rejected keys (for example
`credentals: unknown key`). It adds `Run 'reposets doctor' for suggested
spellings.` only when `ConfigIssueRenderer.render` finds an `unknown key`,
because a missing key has no spelling to suggest. For any other failure with a `cause`, such as a TOML syntax error
whose message is only "toml parse failed", `render` prints the cause, which
carries the line and column, on a second line. `doctor` renders the same
issue through `SchemaIssueRenderer.render`, on stdout as part of its
report.[^cli-doctor]

Both renderers deduplicate a union's repeated branch lines, so one wrong
key in a three-member union prints one `unknown key` line, not three. That
dedupe is the kit's behaviour. No test in this repository pins it any
more, and a regression would surface upstream in `@effected/cli`, not
here.[^effected-cli]

## Exit codes

| Code | Meaning | When |
| :--- | :--- | :--- |
| 0 | Nothing wrong | Every command that finds nothing to report. Also an explicit `--help` or `--version`, and a bare command group. |
| 1 | A finding | A handler that succeeded calls `CliExit.set(1)`. This covers a dangling reference, an undeclared credential label, an org-only violation, no config found (including `list`), a config with no groups, and a `sync` whose partitions produced at least one error. It also covers `sync` with `--fail-on-drift`, and so every `drift`, that found at least one drifted resource. Finally, it covers a `nuke` that could not remove a target and an `init` that could not write a file or the `.gitignore`. |
| 1 | An escaped failure | A config that fails to read or decode, or any other failure a command does not handle. `CliRuntime.main` renders it and exits with its fallback code. |
| 64 | A usage mistake (`EX_USAGE`) | A parse error, an unknown subcommand or flag, more than one audience flag, an unknown `--only`/`--skip` phase, or an unknown `--group`. Also `history show` with no match or an ambiguous prefix, and a non-interactive `history show` without `--run`. Also `nuke` refused in a non-interactive run without `--force`, every `credentials create` refusal, and `credentials delete` of a missing profile, with a token-shaped `--profile`, or without `--profile` in a non-interactive run. |
| 130 | Cancelled | A person cancelled a prompt with Esc, `q` or Ctrl-C. The kit prints `cancelled; nothing written`. |

`doctor` always exits 0, even when its report says schema validation
failed or a token was rejected. It is a report, and `validate` is the gate:
a CI job that wants a non-zero exit on a broken config runs `validate`.
This was a deliberate ruling, not an omission.[^cli-doctor]

A usage mistake fails with `CliError.UserError` or a core parse error.
`Command.runWith` prints the message once on stderr, and any help printed
with it goes to stderr too (`helpOnUsageError: "stderr"`), so a usage
mistake writes nothing to stdout.[^cli-index] A finding is not a failure:
the command ran correctly and reports what it found, which is why it exits
through `CliExit` rather than by failing. No file under `package/src` sets
`process.exitCode`. `package/__test__/cli/bin.e2e.test.ts` runs the built
dev bin and pins these codes and which stream each message lands
on.[^bin-e2e] The reasoning is in
[`cli-runtime-via-effected-cli`](../decisions/cli-runtime-via-effected-cli.md).

[^cli-index]: `package/src/cli/index.ts`
[^cli-flags]: `package/src/cli/flags.ts`
[^cli-sync]: `package/src/cli/commands/sync.ts`
[^cli-drift]: `package/src/cli/commands/drift.ts`
[^cli-validate]: `package/src/cli/commands/validate.ts`
[^cli-doctor]: `package/src/cli/commands/doctor.ts`
[^cli-history]: `package/src/cli/commands/history.ts`
[^config-files]: `package/src/services/ConfigFiles.ts`
[^cli-init]: `package/src/cli/commands/init.ts`
[^cli-nuke]: `package/src/cli/commands/nuke.ts`
[^cli-credentials]: `package/src/cli/commands/credentials.ts`
[^sync-logger]: `package/src/services/SyncLogger.ts`
[^commands-doc]: `docs/02-commands.md`
[^effected-cli]: npm:@effected/cli@0.11.0
[^effected-env]: npm:@effected/env
[^sync-progress]: `package/src/cli/views/sync-progress.tsx`
[^sync-progress-model]: `package/src/cli/views/sync-progress-model.ts`
[^invocation]: `package/src/services/Invocation.ts`
[^core-command]: `.repos/effect/packages/effect/src/cli/Command.ts`
[^bin-e2e]: `package/__test__/cli/bin.e2e.test.ts`
</content>
