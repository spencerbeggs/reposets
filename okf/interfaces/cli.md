---
type: Interface
title: The reposets command line
description: The command tree, flags and exit-code promises the reposets CLI makes to the people and CI jobs that run it.
kind: cli
resource: ../../package/src/cli/index.ts
tags: [dx, github, effect]
generated:
  by: okfit/claude-code
  at: 2026-09-28T22:03:48Z
  body_sha256: de66c9375cfb80967db932257e6cf11156d5515d9d040b6222e8a707b2dbf74c
sources:
  - id: cli-index
    resource: ../../package/src/cli/index.ts
  - id: cli-flags
    resource: ../../package/src/cli/flags.ts
  - id: effected-cli
    resource: npm:@effected/cli@0.9.0
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
  - id: cli-init
    resource: ../../package/src/cli/commands/init.ts
  - id: cli-nuke
    resource: ../../package/src/cli/commands/nuke.ts
  - id: cli-credentials
    resource: ../../package/src/cli/commands/credentials.ts
  - id: sync-logger
    resource: ../../package/src/services/SyncLogger.ts
  - id: commands-doc
    resource: ../../docs/02-commands.md
---

# The reposets command line

`reposets` is built on `effect/cli` — Effect core's own CLI framework
on the v4 line, where the old `@effect/cli` package does not exist. One
subcommand file lives under `package/src/cli/commands/`, and
[`package/src/cli/index.ts`](../../package/src/cli/index.ts) registers them
on the root command via `Command.withSubcommands`. It runs the tree through
`Command.run(cli, { version })` wrapped in `@effected/cli`'s
`CliRuntime.main`, which owns failure reporting, the logger and the exit
code.[^cli-index][^effected-cli] For the full flag and argument
reference, see [`docs/02-commands.md`](../../docs/02-commands.md).[^commands-doc]

## Command tree

```text
reposets [--config]
  sync   [--group] [--repo] [--dry-run] [--no-cleanup] [--fail-on-drift]
         [--debug] [--only <phase>...] [--skip <phase>...]
  drift  [--group] [--repo] [--debug]
  list
  validate
  doctor
  history [--limit] [--repo]
    show  --run <id-or-prefix>
    prune [--keep]
    clear
  init [--project]
  nuke [--force]
  credentials
    create --profile (--username <u> | --org <o>) (--op <ref> | --env <var>)
    list
    delete --profile
```

## Global flags

`--config` is the only global flag reposets defines
(`Command.withGlobalFlags([ConfigFlag])`): a path to `reposets.config.toml`,
or a directory containing it. It is declared with `GlobalFlag.Setting`
rather than a plain parent flag specifically so it parses on either side of
the subcommand name — `reposets --config x validate` and
`reposets validate --config x` both work, where a plain parent flag rejects
the trailing form.[^cli-flags] Core contributes `--help`, `--version`,
`--wizard`, `--completions` and `--log-level` on top of it. `--version`
prints the version the bundler substituted at build time, the same value
`doctor` reports.[^cli-index]

`Command.provide(ConfigLive)`, `Command.provide(CredentialsFilesLive)` and
`Command.provide(SyncJournalLive)` all sit on the root command rather than
on each subcommand — subcommand requirements bubble into the parent's `R`
through `withSubcommands`, so one `provide` covers every subcommand.[^cli-index]
The platform layer handed to `CliRuntime.main` supplies the rest: Node's
services, `App.layer`, `CliColor.formatterLayer()` for colour-aware help and
errors, and the `Invocation` service. `Invocation` carries the working
directory and the version. Environment variables are read through Effect's
`Config`, not `process.env`. `index.ts` is the only file under
`package/src` that reads `process`.[^cli-index][^invocation]

## stdout is output, stderr is diagnostics

Every command writes its output with `Console.log`, to stdout. That covers
`validate`'s `Valid:` lines, `list`, the whole `doctor` report, `history`
and `show`, `prune` and `clear`, `credentials list` and the create and
delete confirmations, `init`'s results, `nuke`'s target list and results,
and `sync`'s and `drift`'s report and closing summary.[^sync-logger]
Everything logged with `Effect.log*`, at any level, is a diagnostic on
stderr, because `CliLogger.layer()`'s default sends every level
there.[^effected-cli] `reposets drift > report.txt` therefore captures the
report and leaves failures on the terminal.

## `--log-level` filters diagnostics, not output

`--log-level` is core's own severity filter (`all|trace|debug|…|none`).
Core applies it around the command handler only, so it filters the
handler's `Effect.log*` calls and nothing else.[^core-command] There is no
`log_level` config key and no verbosity tier either:

| | report on stdout | handler diagnostics on stderr | usage errors and escaped failures | exit code |
| :--- | :--- | :--- | :--- | :--- |
| default | printed | printed | printed | correct |
| `--log-level error` | printed | errors only | printed | correct |
| `--log-level none` | printed | none | printed | correct |

To quiet the report, redirect stdout. `--log-level` no longer does it; see
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
`Valid: <path>` — before any detail, so a passing run cannot be misread as
a complaint.

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

`doctor` always exits 0: it reports, and `validate` gates. See
[Exit codes](#exit-codes).

## `history`, `show`, `prune`, `clear`

`history` lists past runs newest first with a `RUN` id column — the
handle every subcommand takes.[^cli-history] `show --run <prefix>` accepts
any unique prefix of a run id rather than the full id: an ambiguous prefix
lists the candidates instead of guessing, and no match says so plainly.
`prune --keep <n>` and `clear` both state, in their own output, that
applied state and the cache are left untouched — the journal is history,
the applied state is the drift baseline, and conflating the two would make
trimming a log quietly disable drift detection.

## `nuke`

`nuke` deletes every reposets file on this machine and touches nothing on
GitHub.[^cli-nuke] Three properties are load-bearing:

- It lists **only paths that exist**, assembled by looking rather than
  assuming, because a prompt that overstates is a prompt people learn to
  skim.
- It names what each loss costs, per target, and says of the state
  database specifically that the drift baselines cannot be reconstructed —
  the one irreversible consequence in the set. Config files can be
  restored from a backup or rewritten; fingerprints cannot.
- Without `--force` it refuses when stdin is not a terminal, rather than
  assuming an answer. A destructive command that proceeds because nobody
  was there to answer is the one failure mode worth engineering against.
  The check asks core's `Stdio.stdinIsTerminal`, so a test drives it
  without touching `process`. The refusal is a `CliError.UserError` and
  exits 64.

Once confirmed, `nuke` attempts every target even when one fails. A
target it could not remove is logged to stderr as `could not remove <path>`,
and the run then exits 1 through `CliExit` after the rest were tried.

## `init` and `credentials`

`init` scaffolds `reposets.config.toml` and `reposets.credentials.toml`,
writing to the XDG config directory by default or to the current directory
with `--project`. It never overwrites an existing file — only reports it —
so it stays safe to re-run against an already-configured machine, and it
adds the credentials file to `.gitignore` in both modes.[^cli-init] A file
it could not write, the `.gitignore` included, is logged to stderr as
`Could not write: <path>`. The remaining files are still attempted, and
the run exits 1 through `CliExit`.

`credentials create` requires exactly one of `--username`/`--org` (what
the profile acts as, which decides which settings are even valid for it)
and exactly one of `--op`/`--env` (a *reference*, never a token value —
the command actively refuses a value that looks like a credential, by
prefix or by length, rather than storing it). `credentials list` prints
each profile's owner and token reference, never a resolved value.
`credentials delete --profile` removes a profile from whichever file
`discover` found it in.[^cli-credentials]

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
`ConfigValidationError`, `render` prints the error's own message and then
the issue lines `@effected/cli`'s `ConfigIssueRenderer.render` produces. It
adds `Run 'reposets doctor' for suggested spellings.` only when one of those
lines is an `unknown key` line, because a missing key has no spelling to
suggest. For any other failure with a `cause`, such as a TOML syntax error
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
| 64 | A usage mistake (`EX_USAGE`) | A parse error, an unknown subcommand or flag, an unknown `--only`/`--skip` phase, or an unknown `--group`. Also `history show` with no match or an ambiguous prefix, `nuke` refused in a non-interactive shell without `--force`, every `credentials create` refusal, and `credentials delete` of a missing profile. |

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
[^cli-init]: `package/src/cli/commands/init.ts`
[^cli-nuke]: `package/src/cli/commands/nuke.ts`
[^cli-credentials]: `package/src/cli/commands/credentials.ts`
[^sync-logger]: `package/src/services/SyncLogger.ts`
[^commands-doc]: `docs/02-commands.md`
[^effected-cli]: npm:@effected/cli@0.9.0
[^invocation]: `package/src/services/Invocation.ts`
[^core-command]: `.repos/effect/packages/effect/src/cli/Command.ts`
[^bin-e2e]: `package/__test__/cli/bin.e2e.test.ts`
</content>
