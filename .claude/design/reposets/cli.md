---
module: reposets
title: CLI Commands
category: architecture
status: current
completeness: 95
created: 2026-04-21
updated: 2026-08-14
last-synced: 2026-08-14
related:
  - architecture.md
  - services.md
  - config-format.md
dependencies: []
---

## Overview

The CLI is built with **`effect/unstable/cli`**, which is part of Effect core. **`@effect/cli` does not exist on the v4 line** — that package line ended at v3, and reaching for it is the most common wrong turn when porting.

Each subcommand is one file under `package/src/cli/commands/`; the root command and runtime bootstrap live in `package/src/cli/index.ts`. This doc covers the command surface and topology — see the source for argument and flag detail.

## Entry point

`package/src/cli/index.ts` registers subcommands via `Command.withSubcommands` and runs through `Command.run({ version })`.

**`Command.provide` sits on the root command**, rather than on each subcommand: subcommand requirements bubble into the parent's `R` through `withSubcommands`, so one provide covers all of them. `ConfigLive`, `CredentialsFilesLive` and `SyncJournalLive` are all provided there. `ConfigLive` reads `--config` through `GlobalFlag.setting`, which lets a layer require the parsed flag in `R` rather than take it as a constructor argument.

`MainLive` merges `App.layer` over `NodeServices.layer` with `CliLoggerLive`. The logger is **merged rather than provided beneath**, so it replaces Effect's default logger for every line the program emits, including lines from layer construction.

### Failures are caught inside the effect

`NodeRuntime.runMain` reports an unhandled failure using Effect's **default** logger, which sits outside the layers the program was provided. A failure escaping to it therefore prints `[23:05:56] ERROR (#2): …` — in exactly the format `CliLogger` exists to replace — and prints it on **stdout**, the one stream errors must not use.

So the entrypoint catches with `Effect.catch(reportAndExit)` *inside* the effect, keeping the failure in the logger's scope, and sets the exit code itself.

(Core also ships `Runtime.errorExitCode` and `Runtime.errorReported` markers, which set the process exit code and suppress the duplicate default-logger report without any platform import. Worth knowing if this is ever revisited.)

## Global options

`--config` is the only global flag reposets defines (`Command.withGlobalFlags([ConfigFlag])`). Core contributes `--help`, `--version`, `--wizard` and `--log-level`.

## `--log-level` is core's, and it is the per-run silencer

Removing `log_level` from the config did **not** remove the ability to quieten a run — core's own `--log-level` does it better than the tier it replaced, verified against the built CLI:

| | output | errors | exit code |
| :--- | :--- | :--- | :--- |
| default | everything | yes | correct |
| `--log-level error` | errors only | **yes** | correct |
| `--log-level none` | nothing | no | **correct** |

Config `silent` gated `syncError` and `finish` alongside everything else, so a failing run printed nothing at all. `--log-level error` is what that setting should have been: quiet on success, loud on failure, exit code intact. `none` is the CI form where only the exit code matters.

So the flag is not a no-op and is not ours to delete — it is a core built-in, and it supplies the one capability the tier removal appeared to cost.

## There are no verbosity tiers

`SyncLogger` had four — `silent`, `info`, `verbose`, `debug` — selected by a `log_level` config key. Both are gone.

Enumerating what each tier actually gated is what retired them. `verbose` guarded **exactly one call site**: `syncOperation`, the per-resource line for every secret, variable, ruleset, environment and security toggle. That line is the entire content of a sync, so the boundary did not fall between summary and detail — it fell between *settings* (which has its own call at `info`) and everything else. A dry run at the default tier therefore printed a change count with four fifths of the list suppressed, which is precisely the number a user acts on.

`silent` was worse: `syncError` and `finish` were both gated at `info`, so a failing run printed nothing at all and the exit code was the only signal. A config file that can silence errors is worse than `> /dev/null`, which leaves them on stderr where they belong.

What survives is `debug`, as a **flag rather than a level**, on `sync` and `drift`. It gates two *suffixes* on lines that print either way — where a resolved value came from, and the applied-versus-live fingerprints behind a drift report — which is a thing you reach for while diagnosing, not a preference to store.

`--log-level` remains Effect core's own global flag (`all|trace|debug|…|none`), setting the minimum severity of log records. With `log_level` gone there is nothing left for it to be confused with.

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

## Commands

- **`sync`** — loads config and credentials, builds the per-run service layers and walks the phases. `--only` and `--skip` select phases by name, and `--only` wins when both name the same phase: an explicit inclusion is a stronger statement than an exclusion, and the alternative is silently running nothing. Selection preserves `PHASE_NAMES` order regardless of flag order, because the order is a correctness property rather than a preference. Layer composition is described in `architecture.md`.
- **`drift`** — reports resources changed outside reposets and changes nothing, exiting non-zero when drift is found so it gates CI without a flag. It is `sync --dry-run --no-cleanup --fail-on-drift` through **the same handler**, deliberately: the three-way comparison lives in the phases, and a separate read-only implementation would be a second copy of that decision, free to disagree with the one that actually converges. It writes nothing to GitHub *and* nothing to the baseline — phases gate `applied.record` on `dryRun`, so a drift check cannot quietly accept the drift it just reported. Cleanup is off because an undeclared resource is not drift.
- **`list`** — prints a config summary: each group with its referenced settings, environments, secrets and variables (by scope), rulesets, owner and credential profile.
- **`validate`** — schema and reference-integrity checks without hitting the GitHub API, plus two classes of check that reading both files makes possible offline. **Reference integrity runs first** (`danglingReferences`), because a group asking for a section that does not exist makes every later check about resources that were never going to be applied. `sync` runs the same check and refuses before writing; `list`, `doctor` and `history` do not, and none of them writes. This check was missing for part of the v4 rebuild, during which a misspelled section name printed `Valid:` and exited 0 — see `config-format.md`. **Organization-only constructs** — a `Team` ruleset bypass actor, a `Team` environment reviewer, or delegated bypass — assigned to a group whose profile declares `username`. And **undeclared credential labels**: a `resolved` secret or variable naming a label the group's profile does not declare in `[resolve]`. Each is reported where it is *referenced*, not where it is defined, and exits non-zero. The label check matters because its sync-time equivalent compares against resolved *values*, so it cannot fire until a run has authenticated and reached the secrets phase — by which point earlier phases have already written to GitHub. Credentials are read here for their owner declarations only — nothing is resolved and no token is needed. States the outcome first (`Valid: <path>`), because opening with `sources found: 1` reads as a complaint and never says whether the command passed.
- **`doctor`** — everything `validate` does, plus credential posture, Levenshtein typo detection for unknown keys, and **one live check per profile**: resolve the `github_token` reference and call `GET /user` with it. That check exists because the file-reading sections cannot tell a working setup from a revoked token, an `op://` path pointing at nothing, or a service account without vault access — all three produce identical output otherwise. The required-permissions list is printed as a **requirement, not a verification**: GitHub reports a permission set for App installation tokens only, so a fine-grained PAT's own scopes are not readable through the API, and the output says so. **It never prints a resolved secret value**, which tests assert.

The identity line is worded per profile kind, because `GET /user` returns the account that **owns** the token — a user even for a token whose whole purpose is an organization. Reporting that as "authenticates as spencerbeggs" beside `org = "..."` read as a contradiction. A `username` profile now gets the one exact check available for free (`login === username`, a typo becomes a named error rather than a 404 mid-sync); an `org` profile is told the token's owner and its org without any claim of having verified the pairing, because nothing in `GET /user` can. `describeIdentity` is extracted so all three branches are testable — `doctor` builds its own client from the resolved token, so nothing outside it can reach them.

- **`history`** — past runs from the sync journal, newest first. See below.
- **`init`** — scaffolds `reposets.config.toml` and `reposets.credentials.toml`. Default writes to the XDG config dir; `--project` writes to cwd and appends the credentials file to the project `.gitignore`.
- **`nuke`** — deletes every reposets file on this machine. See below.
- **`credentials create|list|delete`** — manages named profiles. `create` requires exactly one of `--username` or `--org`: it is what the profile acts as, and it decides which settings are even valid. `list` shows what each profile acts as and the token *reference*, never a resolved value.

### `doctor` also answers "which files?"

Three files, three directories, three different rules for finding them — so `doctor` prints the version, the **credentials file the resolver chain actually found** (via `discover`, not a guess from cwd, marked `(not created yet)` when the chain finds nothing) and the state database path. Printing them is the cheapest way to end "which config is it reading?", which is otherwise answered by guessing.

### `history` and its subcommands

The bare command lists runs newest first, with a **`RUN` id column** — the id is what every subcommand takes, so a listing that omits it makes the rest of the surface unreachable. `--limit` (default 20) and `--repo owner/name` narrow it, and the listing says how to see more rather than silently truncating. A run that failed shows its error: a journal that records only what succeeded cannot answer "why did nothing change?".

- **`show --run <id>`** — every resource one run touched, grouped by repository. The argument is a **unique prefix**, not a full id: an ambiguous prefix lists the candidates instead of picking one, and no match says so.
- **`prune --keep <n>`** (default 50) — deletes all but the newest runs.
- **`clear`** — deletes every run.

Both deletions say plainly that **applied state and the cache are untouched, so drift detection still works**. That sentence is the point of the two commands existing separately from `nuke`: the journal is history, the applied state is the drift baseline, and conflating them would make trimming a log quietly disable drift detection.

### `nuke`

Removes the project and user config files, the credentials files, and the state database — **nothing on GitHub is touched**, which the output says twice because "delete everything reposets did" is the reasonable wrong reading.

Three properties are load-bearing:

- It lists **only paths that exist**, assembled by looking rather than assuming. A prompt that overstates is a prompt people learn to skim.
- It names what each loss costs, and says of the database that the drift baselines **cannot be reconstructed** — the only irreversible consequence in the set. Config files can be restored from a backup or rewritten; fingerprints cannot, and without them the next run reports a first sync where a real out-of-band edit happened.
- Without `--force` it **refuses a non-interactive shell** rather than assuming an answer. A destructive command that proceeds because nobody was there to answer is the one failure mode worth engineering against; `Prompt.confirm` defaults to no.

The upward walk for project config mirrors the resolver's own chain, because the file a user is thinking of is the one the CLI would load — not always the one in the current directory.

## Saying what was selected, not just what was acted on

`groupStart` takes both `selected` and `declared`. A `--repo` filter acting on one repository out of a group of three used to report one repository — true, and it reads as "the group has one". The header now prints `group: <name> (1 of 3 repos)` when a filter narrowed the run and `(3 repos)` when it did not, so a filter that matched less than intended is visible in the output rather than inferable from its absence.

## Reporting a bad config

Both `sync` and `doctor` render the structured `issue` a `ConfigValidationError` carries, through `formatSchemaIssue`. Before that, `sync` named the file and said "run doctor", and `doctor` said `FAILED` and `No unknown keys detected` — so a wrongly *shaped* value left the two commands pointing at each other and neither saying what was wrong. Doctor's hand-written known-key list can only ever find a misspelling.

Issue lines are deduplicated, because a union reports every branch it tried: one wrong key in a three-member union printed the same `unknown key` line three times, burying the lines that say which shapes were allowed.

Doctor's known-key sets (`KNOWN_CONFIG_KEYS`, `KNOWN_GROUP_KEYS`) are hand-written and must be kept in step with the schema — they listed `owner` and `log_level` after both were removed, so a migrating config was rejected by strict decoding while doctor's typo section said nothing about them. Removed keys now have their own map, `REMOVED_KEYS`, which reports where each one went rather than guessing a near match: `owner` is three edits from `repos`, so the typo hint actively misled.

The **settings** fields are checked too, and that set is derived from `SettingsGroupSchema` rather than hand-written. It cannot be, safely: `SettingsGroupSchema` has a rest schema, so an unrecognised field decodes cleanly, is PATCHed, is ignored by GitHub, and is reported as applied. Strict decoding cannot object — pass-through is deliberate, since it is how a field GitHub adds tomorrow works without a release here — so a warning is the only correct response, and deriving the set from the schema is what stops a second hand-maintained list going stale the way the first did.

`doctor` still locates and parses the config file itself, and that duplication is **not** dead code despite the original justification being wrong. `ConfigCodecError` carries `codec` and `operation` and **no path**, so a TOML *syntax* error cannot name the file it failed to parse — and that is the most ordinary config mistake there is. Delete the workaround when the codec error carries a path. `sync` prints the error's `cause`, which does carry the line and column.
