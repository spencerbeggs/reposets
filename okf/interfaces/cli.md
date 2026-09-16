---
type: Interface
title: The reposets command line
description: The command tree, flags and exit-code promises the reposets CLI makes to the people and CI jobs that run it.
kind: cli
resource: ../../package/src/cli/index.ts
tags: [dx, github, effect]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: c8495aebce619e80332c595d10378ee9b34e35fe34dff6f02bde7f816b1d3c46
sources:
  - id: cli-index
    resource: ../../package/src/cli/index.ts
  - id: cli-flags
    resource: ../../package/src/cli/flags.ts
  - id: cli-logger
    resource: ../../package/src/cli/logger.ts
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

`reposets` is built on `effect/unstable/cli` — Effect core's own CLI framework
on the v4 line, where the old `@effect/cli` package does not exist. One
subcommand file lives under `package/src/cli/commands/`, and
[`package/src/cli/index.ts`](../../package/src/cli/index.ts) registers them
on the root command via `Command.withSubcommands` and runs the tree through
`Command.run({ version })`.[^cli-index] For the full flag and argument
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
`--wizard` and `--log-level` on top of it.

`Command.provide(ConfigLive)`, `Command.provide(CredentialsFilesLive)` and
`Command.provide(SyncJournalLive)` all sit on the root command rather than
on each subcommand — subcommand requirements bubble into the parent's `R`
through `withSubcommands`, so one `provide` covers every subcommand.[^cli-index]

## `--log-level` is the per-run silencer

`--log-level` is core's own severity filter (`all|trace|debug|…|none`), and
it is the whole answer to "how do I quiet a run" — there is no `log_level`
config key and no verbosity tier to reach for instead. `CliLoggerLive`
decides where a record goes once it is emitted (errors and fatals to
stderr via `console.error`, everything else to stdout via
`console.log`),[^cli-logger] and `--log-level` decides which records are
emitted at all, upstream of that routing:

| | output | errors | exit code |
| :--- | :--- | :--- | :--- |
| default | everything | yes | correct |
| `--log-level error` | errors only | yes | correct |
| `--log-level none` | nothing | no | correct |

`--log-level error` is quiet on success and loud on failure with the exit
code intact; `--log-level none` is the CI form where only the exit code
matters. Neither flag changes what `sync` or `drift` actually do — only
what they print.

## `--only` wins over `--skip`

`sync` and `drift` select phases from `PHASE_NAMES` with `--only` and
`--skip`. When a name appears in both, `--only` wins: an explicit inclusion
is a stronger statement than an exclusion, and the alternative — running
nothing — is worse than an ambiguous but non-empty result. An unrecognised
phase name in either flag is refused outright rather than filtered out
silently, and refuses the whole invocation with `Unknown phase name(s): …`
rather than running the phases it did recognise.[^cli-sync] Phase selection
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
2. **Organization-only constructs** (`orgOnlyViolations`) — a ruleset
   bypass actor, an environment reviewer, or a delegated bypass reviewer
   declared as a `Team`, assigned to a group whose credential profile
   declares `username` rather than `org`.
3. **Undeclared credential labels** (`undefinedCredentialLabels`) — a
   `resolved` secret or variable naming a label the group's profile does
   not declare in its `[resolve]` section.

Each violation is reported where it is *referenced*, not where it is
defined, because "referenced" is where a config author actually needs to
look to fix it. Credentials are read here only for their owner
declarations (`username` versus `org`); nothing is resolved and no network
request is made. On success, `validate` states the outcome first —
`Valid: <path>` — before any detail, so a passing run cannot be misread as
a complaint.

## `doctor` — everything `validate` does, plus live posture

`doctor` runs the same reference and credential checks as `validate`, adds
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
- Without `--force` it refuses a non-interactive shell (`process.stdin.isTTY
  !== true`) rather than assuming an answer — a destructive command that
  proceeds because nobody was there to answer is the one failure mode worth
  engineering against.

## `init` and `credentials`

`init` scaffolds `reposets.config.toml` and `reposets.credentials.toml`,
writing to the XDG config directory by default or to the current directory
with `--project`. It never overwrites an existing file — only reports it —
so it stays safe to re-run against an already-configured machine, and it
adds the credentials file to `.gitignore` in both modes.[^cli-init]

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

`sync` and `doctor` both render the structured issue a `ConfigValidationError`
carries through `formatSchemaIssue`, with the lines deduplicated — a union
schema reports every branch it tried, so one wrong key in a three-member
union used to print the same `unknown key` line three times, burying the
lines that say which shapes were actually allowed.[^cli-sync]

## Exit codes

Every command that finds nothing wrong exits 0. A command sets
`process.exitCode = 1` explicitly rather than throwing, for: a config that
fails to discover or decode, an unknown `--only`/`--skip` phase name, a
dangling reference, an undeclared credential label, an org-only violation,
a `sync` whose partitions produced at least one error (or, with
`--fail-on-drift`, at least one drifted resource), an ambiguous or missing
`history show` prefix, and a `nuke` refused for lacking `--force` in a
non-interactive shell. A failure that escapes the command effect entirely
is caught by `Effect.catch(reportAndExit)` at the entrypoint and reported
through the CLI logger before the process exits non-zero — see
[`failures-are-caught-inside-the-effect`](../decisions/failures-are-caught-inside-the-effect.md).

[^cli-index]: `package/src/cli/index.ts`
[^cli-flags]: `package/src/cli/flags.ts`
[^cli-logger]: `package/src/cli/logger.ts`
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
</content>
