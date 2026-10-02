---
type: Module
title: reposets
description: The one workspace package — CLI, sync engine, phases, and the services that turn a config into GitHub writes.
kind: package
resource: ../../package
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-02T16:06:57Z
  body_sha256: dd5334f057a8291a8cb68be947836dce7a4d029d9bd71d6e713d60f52e409d47
tags: [architecture, effect, github]
---

# reposets (package)

## Service graph

`package/src/cli/index.ts` provides the XDG directories (`Xdg` and
`AppDirs`, composed as `App.layer` composes them) in the platform layer, and
`ConfigLive` and `CredentialsFilesLive` once at the root command — subcommand
requirements bubble up into the root command's `R` through
`Command.withSubcommands`, so one `Command.provide` per service covers every
subcommand rather than each wiring its own copy. The two SQLite databases are
not in the platform: `AppStore.layer` and `AppCache.layer` are bound once at
module scope and attached with a per-command `Command.provide` to `sync` and
`drift` (both databases) and `history` (`SyncJournalLive` over `store.db`
only), so `init`, `list`, `validate`, `doctor`, `nuke` and `credentials`
never open or create either file. The tree runs through `CliAudience.run` under `@effected/cli`'s
`CliRuntime.main`, which installs the CLI logger, builds the audience,
terminal, theme and `CliInteractive` environment, provides the platform
layer inside failure reporting, and turns a usage error, a finding recorded
with `CliExit`, a cancelled prompt, or an escaped failure into the exit
code — see
[cli-runtime-via-effected-cli](../decisions/cli-runtime-via-effected-cli.md)
and [adopt-interactive-cli-kit](../decisions/adopt-interactive-cli-kit.md).

`reposets sync` (`package/src/cli/commands/sync.ts`) loads the config and
credentials files, checks for dangling section references and unknown
`--only`/`--skip` phase names before touching anything, then partitions
`config.groups` by the credential profile each group names
(`partitionByProfile`, `package/src/cli/commands/sync.ts:70-82`). One
partition is one identity: a `GitHubClient` fixes its token at construction,
so two profiles genuinely are two service graphs, never one graph swapped
mid-run. For each partition the handler resolves that profile's token, builds
the eight `@effected/github` resource-service layers over
`GitHubClient.layerFromToken({ token })`, and runs a fresh `SyncEngine`
(`SyncEngineLive(allPhases)`) against just that partition's groups. The engine
walks `PHASE_NAMES` order once per repository, in the group loop it owns.

## Three-level layer composition

The layer graph is assembled at three levels, and the split between them is
load-bearing rather than a style choice:

1. **Root entrypoint** (`package/src/cli/index.ts`) — `PlatformLive`
   (the `Xdg`/`AppDirs` directories and the `Invocation` layer over
   `NodeServices.layer`) handed to `CliRuntime.main`, which adds
   `CliLogger.layer()` outermost and, from its `env` option, the audience,
   terminal, theme, `CliInteractive` and the colour-aware help formatter,
   plus `ConfigLive` and `CredentialsFilesLive` on the root command, all
   provided once for the whole process. The databases sit one level down,
   per command: `StoreLive` (`AppStore.layer`) and the cache
   (`AppCache.layer`) are bound at module scope because each call opens a
   new connection, and are provided only to `sync`, `drift` and `history`.
   Migrations therefore run on the first command that uses the state
   database, not on every command. Before this split `App.layer` sat in
   the platform, so every command created both files and `nuke` deleted
   `store.db` while its own process held it open, orphaning the `-wal`
   and `-shm` files.
2. **Per sync invocation** (`syncHandler` in `package/src/cli/commands/sync.ts:178-186`)
   — `SyncJournalLive`, `AppliedStateLive`, `RepoCacheLive`, the
   `CredentialResolver` layer, and `SyncLoggerLive` (given the run's event
   sink when a live view is drawn) are merged into one
   `sharedLayer` and provided around the *whole* partition loop, not inside
   it. Layers memoize per `provide`/build call: building this layer inside
   the loop would mint a fresh `SyncLogger` per profile, each with its own
   error tally, so `finish()` would report only the last partition's errors
   and call it the run — plus a separate journal and cache connection per
   profile that never see each other's writes.
3. **Per partition** (`package/src/cli/commands/sync.ts:251-265`) — the eight
   GitHub resource-service layers over `GitHubClient.layerFromToken({ token })`,
   merged with `SyncEngineLive(allPhases)`. This layer is genuinely
   per-partition, because it is the one thing that must differ between
   partitions: the token.

The engine's own remaining requirements — journal, logger, resolver, cache —
are satisfied from the ambient context the partition loop already runs in,
which is what keeps those four services shared across every partition while
only the GitHub client layer varies.

## Data flow

One sync run moves through four steps: (1) load and decode
`reposets.config.toml` and `reposets.credentials.toml` via the `ConfigFiles`
services; (2) partition groups by credential profile and resolve each
profile's token and `[resolve]` labels through `CredentialResolver`; (3) for
every repository in a partition's groups, build a `RepoContext`
(`package/src/sync/phase.ts:18-49`) once and walk the selected `Phase` list
against it, discharging `Repo` per repository; (4) record every
`ChangeRecord` into the run's journal and summarise errors and drift counts
into a `SyncReport`. Every phase reads only the `RepoContext` it is handed —
none re-resolves credentials, re-detects the owner type, or re-reads the
config file — which is what makes a phase testable as a pure function without
standing up the engine (`package/__test__/sync/phases.test.ts` builds
`RepoContext` values directly for exactly this reason).

## Where services live

Five local services live in `package/src/services`: `ConfigFiles`,
`CredentialResolver`, `Invocation`, `OnePasswordClient`, and `SyncLogger`. Three store
services — `AppliedState`, `SyncJournal`, `RepoCache` — live in
`package/src/store` and are wired over `AppStore.layer` / `AppCache.layer`
by the commands that use them. Everything that speaks to
GitHub — the eight resource services and the libsodium sealed-box encryption
secrets need before they can be written — is upstream in `@effected/github`.
Everything at the CLI boundary — the runtime wrapper, the logger, the exit
code cell, colour, the audience, `Doc` reports and `CliMessage` lines, the
prompts and the live view (`@effected/cli/ui`), and the schema-issue
renderers (`SchemaIssueRenderer`, `ConfigIssueRenderer`) that turn a decode
failure into `unknown key` lines — is upstream in `@effected/cli`, with the
audience and terminal detection in `@effected/env`. `@effected/glob` and
`@effected/walker` are direct dependencies only because they are required
peers of `@effected/cli`. There is no `src/cli/logger.ts` and
no `src/lib/schema-issues.ts`.

### Invocation (`package/src/services/Invocation.ts`)

One immutable value, `{ cwd, version }`, built only in
`package/src/cli/index.ts` from `process.cwd()` and the bundler-substituted
version. That makes `index.ts` the only file under `package/src` that reads
`process`. `nuke`, `init` and `doctor` read from it, so a test hands them a
different directory with `Invocation.layer(...)`. The environment is not
here: every environment variable is read through Effect's `Config` from the
ambient `ConfigProvider`, which is the process environment in the shipped
bin. Whether the run may prompt is not here either: every command asks
`CliInteractive`, which `CliRuntime.main` decides from the audience and
the terminal. The version has to be
threaded down from `index.ts` because the bundler substitutes only the
literal `process.env.__PACKAGE_VERSION__` spelling, not a destructured
`env.__PACKAGE_VERSION__`. Config discovery is the one place the process
cwd still leaks in, through `@effected/config-file`'s
`ConfigResolver.upwardWalk`, which is why
`package/__test__/cli/commands.test.ts` still calls `process.chdir` — a
known follow-up.

### ConfigFiles (`package/src/services/ConfigFiles.ts`)

Wraps `@effected/config-file`'s `ConfigFile.Service` twice, once for
`ReposetsConfigFile` and once for `ReposetsCredentialsFile`, each over
`TomlCodec`. The two files decode under different strictness: credentials
decode with `onExcessProperty: "error"` and `errors: "all"`, so a stale key
(`op_service_account_token`, removed for a security reason — it stored the
credential that unlocks every other credential) or a typo is rejected rather
than silently dropped, and every rejection in one file is reported at once
rather than one round trip per typo. The config file stays lenient on
purpose, because `doctor` diagnoses unknown config keys with nearest-match
suggestions — strictly better than a decode failure — and locates the file
through `discover`, which decodes; making that load strict would mean
`discover` fails and `doctor` reports "no config found" for a file that is
present and one character wrong, losing the diagnosis exactly when it is
wanted. `--config` gets its own resolver-tier construction
(`makeConfigFilesLive`) rather than a static layer, because a directory
argument needs `ConfigResolver.staticDir` while a file argument needs
`ConfigResolver.explicitPath`, and a path that resolves to neither raises
`ConfigFlagNotFound` rather than falling through to the XDG tier the way an
ordinary probe would.

### OnePasswordClient (`package/src/services/OnePasswordClient.ts`)

Resolves one `op://` reference at a time through the `@1password/sdk`,
reading `OP_SERVICE_ACCOUNT_TOKEN` through `Config` lazily, at call time
— never taken as a parameter and never stored beside the references it
unlocks, so a config with no `op` entries never needs it. It builds a fresh
SDK client per reference resolved, which is v3's behavior ported unchanged
rather than quietly improved: a profile with twenty `op` entries pays for
twenty authentication handshakes. Every resolved value comes back as
`Redacted.Redacted<string>`.

### CredentialResolver (`package/src/services/CredentialResolver.ts`)

Turns the references in a `CredentialProfile` into `Redacted` values. All
four `[resolve]` sub-groups are read, in the order the schema declares them —
`op`, `env`, `file`, then `value` — and a label declared in two sub-groups
resolves to the last one written. `value` entries never fail to resolve,
which is why `ResolveError.source` has no `value` member; a string is used
as-is and any other JSON value is stringified, matching how a secret or
variable group's own `value` kind behaves, since a label feeding one of those
must arrive in the same shape. `resolveAll`'s `basePath` parameter is the
**config** file's directory, not the credentials file's — a `[resolve].file`
path resolves beside `reposets.config.toml`, and `SyncEngine` is what passes
that directory through. `env` references are read through
`Config.option(Config.String(variable))` when a method runs, so
`CredentialResolverLive` requires only `OnePasswordClient`, and a variable
that is set but empty fails as not set. A test supplies the environment
with `ConfigProvider.layer(ConfigProvider.fromEnv({ env }))` through
`Layer.provideMerge` — see
[config-provider-hidden-by-provide](../gotchas/config-provider-hidden-by-provide.md).

### SyncLogger (`package/src/services/SyncLogger.ts`)

The single output surface for the sync pipeline; `SyncEngine` and every phase
describe *what* happened, and this service decides how to say it. There are
no verbosity tiers — the four that existed in v3 collapsed to one output plus
a `debug` flag, because auditing what each tier actually gated found that
`verbose` guarded exactly one call site (the per-resource operation line,
which is the entire content of a sync) and `silent` suppressed errors along
with everything else, leaving the exit code as the only signal a failing run
gave. `debug` adds diagnostic suffixes only — where a value came from, and
the applied/live fingerprints behind a drift report — never lines of its
own, which is why it is a per-run flag rather than a level stored in the
config file. `groupStart` takes both `selected` and `declared`, because a
`--repo` filter that narrows a group's repository count makes those two
numbers differ, and printing only one of them is what made a filtered run's
header read `(3 repos)` above a summary that only ever touched one. Drift is
reported at the same rank as the ordinary summary lines rather than folded
into the verbose detail, and it is worded as an observation about a person
("changed outside reposets") rather than as an action by the tool — it is
emitted even when nothing was written, since the tool having no work to do
does not mean the human's out-of-band edit should stay unreported. The report
is the command's output, so every line is `Console.log` on stdout; failures
are `Effect.logError` on stderr. `--log-level` therefore filters the
failures and never the report — see
[log-level-none-still-prints-reports](../gotchas/log-level-none-still-prints-reports.md).
Every action line leads with a status glyph from the kit's core
vocabulary, painted for a person and plain for an agent, so the layer
requires `CliTheme` and `Audience`. Every line is sanitised before it is
written, because it interpolates config and API text.

`SyncLoggerLive` takes an optional `events` `PubSub<SyncEvent>`. When it
is given, every hook publishes an event beside the line it prints, so a
live view and the streamed report are fed by the same call and cannot
disagree. `runStart(total)` prints nothing and exists only to publish
`RunStarted` with the number of repositories selected; `finish(summary)`
publishes `RunEnded` with the engine's totals, last, after every line.
Both lines and events reach the terminal through the fiber's `Console`,
which is the seam the live view uses: `runUnderSyncView` in `sync.ts`
provides the view's `logConsole` around the run, so every line lands above
the redrawing footer without this service knowing a view exists.

### Views (`package/src/cli/views/`)

The live view of an interactive `sync` or `drift`, split in two so the
non-interactive path never loads React. `sync-progress-model.ts` holds no
JSX: the progress state, the reducer that folds `SyncEvent`s into it, and
`syncSummaryBlock`, the one summary both paths draw. `sync-progress.tsx`
is the only module with JSX; it holds the footer component and
`syncProgressView`, the `CliUi.live` options in `hosted` mode, and
`sync.ts` imports it dynamically on the drawing path alone. Command
modules contain no JSX. `package/tsconfig.json` and the root
`tsconfig.json` set `"jsx": "react-jsx"` for it, and `ink` and `react` are
runtime dependencies that load only when a screen or the live view mounts.
`selectedRepoCount` in `sync.ts` computes the view's denominator up front
with the engine's own selection rule.

### CLI runtime (`@effected/cli`)

`CliRuntime.main` owns the process edge. Its default logger,
`CliLogger.layer()`, drops Effect's timestamp, level and fiber id, strips
escapes from every line, and sends every `Effect.log*` level to stderr, so
a command's output reaches stdout through `Console.log`, `Doc.print` or a
success or info `CliMessage`. `CliExit.set(1)` records a finding from a handler
that succeeds, a `CliError.UserError` exits 64, and anything that escapes is
rendered by the entrypoint's `render` callback and exits 1. The stream
split and exit codes are specified in
[`interfaces/cli.md`](../interfaces/cli.md). The testing side,
`CliTest.sandbox` and `CliTest.run` from `@effected/cli/testing`, drives the
built dev bin in `package/__test__/cli/bin.e2e.test.ts` and asserts exit
codes and stream placement. `@effect/vitest` is a devDependency for that
suite, and `package/__test__/utils/capture.ts` provides a capturing `Console`
and the agent audience, so unit tests assert plain, deterministic text and
which stream a line landed on through the same `CliLogger` routing the bin
uses. Prompt flows are driven with `CliUiTest.session` from
`@effected/cli/ui/testing`, and the live view on
`package/__test__/utils/terminal.ts`'s in-memory terminal — see
[ui-test-session-hides-clear-and-log-lines](../gotchas/ui-test-session-hides-clear-and-log-lines.md).

## Phase-by-phase decisions

- **settings** (`package/src/sync/phases/settings.ts`) — merges every
  `[settings.*]` group a repository's group references with last-write-wins,
  and merges `security_and_analysis` separately from the rest of the payload
  because GitHub accepts it as its own nested object; organization-only
  fields (for example `secret_scanning_delegated_bypass`) are stripped from a
  personal repository's payload before it is sent, since GitHub rejects the
  whole PATCH — not just the offending field — when one is present. There is
  no independent GET this phase can compare desired values against for every
  field, so where none exists the phase compares desired against the last
  *applied* value; that reports a changed baseline as `ConfigChanged`, never
  as `Drift`, because there is nothing external to attribute the difference
  to.
- **security** (`package/src/sync/phases/security.ts`) — a contradiction
  guard, `contradicts`, rejects `automated_security_fixes: true` paired with
  `vulnerability_alerts: false` before any write, because GitHub rejects
  automated fixes without alerts enabled; catching it before the first write
  avoids leaving a repository half-configured with the failure attributed to
  the wrong toggle. Each of the three toggles is tracked as its own drift
  resource, so a person flipping one setting in the UI is reported as that
  toggle changing, not as "security changed".
- **code-scanning** (`package/src/sync/phases/code-scanning.ts`) — the
  `actions` language is checked against the repository's workflow-file
  **count**, counting only files under `.github/workflows/` rather than
  attempting to analyze workflow YAML, because `actions` names a CodeQL
  default-setup scanning target rather than a language `listRepoLanguages`
  can confirm, and GitHub's own validation rejects `actions` with a 422 on a
  repository with zero workflow files. The check runs only when `actions` is
  actually configured, so a config that never names it never pays for the
  round trip.
- **rulesets** (`package/src/sync/phases/rulesets.ts`) — builds the API
  payload through `buildRulesetPayload` (`package/src/schemas/ruleset.ts`)
  rather than forwarding the config shape directly, after resolving actor
  references against the repository.
- **cleanup** (`package/src/sync/phases/cleanup.ts`) — computes what a group
  *declares* for secrets and variables with `declaredNames`
  (`package/src/sync/phases/resource.ts:132-144`), which reads only the
  `Object.keys` of a group's `value`/`resolved`/`file` entries and never
  calls `CredentialResolver` to resolve them. Cleanup therefore never needs a
  credential to decide what to delete — it only needs to know which *names*
  were declared, which is cheaper and means a broken 1Password reference
  cannot block a cleanup pass that does not otherwise depend on it.

Every phase's `run` returns `PhaseResult` rather than raising — see
[phase-run-never-fails](../invariants/phase-run-never-fails.md) — and the
phase list itself is data the engine walks rather than a hardcoded sequence
— see [phases-are-data](../decisions/phases-are-data.md) and
[phase-order-is-pinned](../invariants/phase-order-is-pinned.md).
