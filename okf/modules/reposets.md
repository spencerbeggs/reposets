---
type: Module
title: reposets
description: The one workspace package — CLI, sync engine, phases, and the services that turn a config into GitHub writes.
kind: package
resource: ../../package
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: d7a036c763a8874b9ed65ffaa108eb07c57c6921d8c46e480f46c2a13f956233
tags: [architecture, effect, github]
---

# reposets (package)

## Service graph

`package/src/cli/index.ts` bootstraps `App.layer` (`@effected/app`), which
opens the two SQLite databases the store services need, and provides
`ConfigLive`, `CredentialsFilesLive`, and `SyncJournalLive` once at the root
command — subcommand requirements bubble up into the root command's `R`
through `Command.withSubcommands`, so one `Command.provide` per service covers
every subcommand rather than each wiring its own copy
(`package/src/cli/index.ts:45-62`).

`reposets sync` (`package/src/cli/commands/sync.ts`) loads the config and
credentials files, checks for dangling section references and unknown
`--only`/`--skip` phase names before touching anything, then partitions
`config.groups` by the credential profile each group names
(`partitionByProfile`, `package/src/cli/commands/sync.ts:69-81`). One
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

1. **Root entrypoint** (`package/src/cli/index.ts`) — `App.layer`,
   `ConfigLive`, `CredentialsFilesLive`, `SyncJournalLive`, and
   `CliLoggerLive`, provided once for the whole process. `AppLive` is bound at
   module scope specifically because `App.layer` opens both SQLite databases;
   a second call would open a second pair with a split event stream, so this
   layer is built exactly once no matter how many commands or partitions run.
2. **Per sync invocation** (`syncHandler` in `package/src/cli/commands/sync.ts:206-214`)
   — `SyncJournalLive`, `AppliedStateLive`, `RepoCacheLive`, the
   `CredentialResolver` layer, and `SyncLoggerLive` are merged into one
   `sharedLayer` and provided around the *whole* partition loop, not inside
   it. Layers memoize per `provide`/build call: building this layer inside
   the loop would mint a fresh `SyncLogger` per profile, each with its own
   error tally, so `finish()` would report only the last partition's errors
   and call it the run — plus a separate journal and cache connection per
   profile that never see each other's writes.
3. **Per partition** (`package/src/cli/commands/sync.ts:279-293`) — the eight
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

Four local services live in `package/src/services`: `ConfigFiles`,
`CredentialResolver`, `OnePasswordClient`, and `SyncLogger`. Three store
services — `AppliedState`, `SyncJournal`, `RepoCache` — live in
`package/src/store` and are wired by `App.layer`. Everything that speaks to
GitHub — the eight resource services and the libsodium sealed-box encryption
secrets need before they can be written — is upstream in `@effected/github`.

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
reading `OP_SERVICE_ACCOUNT_TOKEN` from the environment lazily, at call time
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
that directory through.

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
does not mean the human's out-of-band edit should stay unreported.

### CliLogger (`package/src/cli/logger.ts`)

Replaces Effect's default logger for the whole process so a command's plain
output does not carry a timestamp, level, and fiber id in front of it. Its
callback is synchronous, so it cannot yield an `Effect` and therefore cannot
reach `Stdio`'s sinks directly; instead it reads the `Console` off the fiber
via `fiber.getRef(Console.Console)` — the same route core's own loggers take
— and routes `Error`/`Fatal` severity to `console.error` (stderr) while
everything below goes to `console.log` (stdout). This is the contract
`SyncLogger` is written against: it emits failures with `Effect.logError`
specifically so `reposets sync > log.txt` still shows failures on the
terminal while the redirected log only captures progress.

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
