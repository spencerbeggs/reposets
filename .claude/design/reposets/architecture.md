---
module: reposets
title: Architecture
category: architecture
status: current
completeness: 90
created: 2026-04-21
updated: 2026-08-14
last-synced: 2026-08-14
related:
  - services.md
  - cli.md
  - config-format.md
  - json-schema.md
dependencies: []
---

## Overview

reposets is an Effect **v4** CLI for syncing GitHub repository settings, secrets, variables, rulesets, deployment environments, repository security features and CodeQL default setup across personal and organization repos. Config files are distributable templates; environment-specific values resolve from credential profiles at runtime. This doc owns the topology: which services exist, how layers compose, and how the sync pipeline is structured. Service interfaces live in `services.md`, the CLI surface in `cli.md` and the TOML schema in `config-format.md`.

The v3 implementation was rebuilt onto Effect v4 and the `@effected/*` kit. Three things a reader coming from the old shape should know up front: `@effect/cli` **does not exist on the v4 line** (the framework is `effect/unstable/cli`, in core), the Octokit wrapper was replaced by `@effected/github`, and reposets now keeps **durable local state** — it did not before.

## Service graph

```text
CLI commands (effect/unstable/cli; --config global flag, CliLogger)
  |
  v
App.layer (@effected/app) — XDG dirs + Store + Cache, one wiring
  |--- AppliedState   (SQLite: what reposets last wrote, per resource)
  |--- SyncJournal    (SQLite: run history and per-resource changes)
  |--- RepoCache      (TTL cache: team slug -> id, owner type, languages, workflows)
  |
  v
ConfigFile services (@effected/config-file), provided once at the root command
  |--- ReposetsConfigFile      (ConfigLive, from the --config global flag)
  |--- ReposetsCredentialsFile (CredentialsFilesLive; no --config tier)
  |
  v
sync command — owns the run, partitions groups by credential profile
  |--- shared across partitions: SyncJournal, AppliedState, RepoCache,
  |                              CredentialResolver, SyncLogger
  |--- per partition: GitHubClient.layerFromToken + eight resource
  |                   services (@effected/github) -> SyncEngineLive
  |
  v
SyncEngine (walks a list of Phase values)
  |--- CredentialResolver --- OnePasswordClient (@1password/sdk)
  |--- SyncLogger (one output level, plus --debug suffixes)
```

## Layer composition

Layers compose at three levels:

- Root entrypoint (`package/src/cli/index.ts`) merges `App.layer` over `NodeServices.layer` and `CliLoggerLive`. `Command.provide` sits on the **root** command rather than each subcommand, because subcommand requirements bubble into the parent's `R` through `withSubcommands`. `ConfigLive`, `CredentialsFilesLive` and `SyncJournalLive` are all provided there. `ConfigLive` reads `--config` from `GlobalFlag.setting`, which is the bridge between parse time and layer-construction time: a layer can require the flag in `R` rather than take it as a constructor argument.
- Per sync invocation: the handler composes `OnePasswordClientLive`, `CredentialResolverLive`, `SyncLoggerLive({ dryRun, debug })`, the journal, the applied state and the cache. This graph is built in the handler and not at the entrypoint because it depends on values known only after the config and credentials load.
- Per **partition** of that invocation: `GitHubClient.layerFromToken({ token })` with the eight `@effected/github` resource services over it, feeding `SyncEngineLive(allPhases)`. A token is fixed at client construction, so one identity is one graph.

The shared/per-partition split is load-bearing rather than tidy. The shared layer is built once and provided around the **whole** partition loop: layers memoize per build, so providing the logger inside the loop would mint one per profile, each with its own error tally, and `finish()` would report one partition's errors as the run's — plus a separate journal and cache connection per profile.

The key constraint: layers are provided at the entrypoint and per-command handlers, never inside service implementations.

A **`Layer` memoizes within a single `Effect.provide` scope, not by const identity.** Two provides of the same layer value are two builds — and for `App.layerTest`, two separate `:memory:` databases. This is ordinary `Layer` semantics, but the failure mode is data appearing to vanish rather than a wiring error, so it is worth stating.

## Phases: the pipeline is data

The sync pipeline is a **list of `Phase` values the engine walks**, not a hardcoded sequence. That is what lets `--only` and `--skip` select a subset without the engine knowing what any phase does.

```ts
interface Phase {
  readonly name: PhaseName;
  readonly appliesTo: (ctx: RepoContext) => boolean;
  readonly run: (ctx: RepoContext) => Effect.Effect<PhaseResult, never, Repo>;
}
```

Four decisions in that shape are load-bearing:

- **`run` has `never` in its error channel.** A sync spans many repositories and many resources; one repository's rejected ruleset must not stop the other nineteen. Failures are collected into `PhaseResult.errors` and reported.
- **Phase requirements bind at layer construction**, inside `SyncEngineLive(makePhases)`, so `R` does not leak through `syncAll` out to every caller.
- **`Repo` is the deliberate exception in `R`.** `@effected/github`'s resource services take no `owner`/`repo` argument and resolve `Repo` from context per call, which is what makes a scoped override mean anything. So a phase carries it and the engine discharges it once at the repository loop — the single place that knows which repository is in play.
- **`appliesTo` lets a phase decline cheaply**, before any round trip. A declining phase is skipped without logging — "did nothing because nothing was configured" is not news.

`PHASE_NAMES` is the order, and the array *is* the contract:

`settings → security → code-scanning → environments → secrets → variables → rulesets → cleanup`

Two ordering constraints are load-bearing and not obvious from the code: **environments must exist before any environment-scoped secret or variable**, and **cleanup runs last**, because every other phase's writes are what define "declared".

Security features and code scanning follow "leave alone if omitted" semantics — they have no `cleanup` scope of their own.

## Data flow

1. The CLI resolves a config path through the declarative resolver chain (`--config`, *or* an upward walk, then XDG; see `config-format.md`), parses the TOML and decodes it **strictly** (`onExcessProperty: "error"`, `errors: "all"`). Cross-reference integrity is checked by the command rather than the loader — `danglingReferences` in `package/src/lib/config-refs.ts`, called by `validate` and by `sync` before it writes anything. See `services.md` for why it is not the config spec's `validate` callback, as it was in v3.
2. The `sync` command opens **one journal run**, partitions groups by credential profile, and for each partition resolves that profile's token and builds a service graph around it. An unknown profile or an unresolvable token fails only its own groups.
3. `SyncEngine.syncAll` iterates the partition's groups. Per group it resolves every credential label once (into a `Map<string, Redacted<string>>`) and reads the owner from the **profile**, whose declared `username`/`org` is verified against GitHub once per owner and cached, so org-only fields are stripped on personal accounts.
4. Per repository it assembles a `RepoContext` and walks the selected phases, merging their results. Changes go to the journal; the command closes the run and summarises it.

## Drift detection

reposets records a fingerprint of what it last wrote, so it can tell **"the config changed"** from **"someone changed this in the GitHub UI"**.

`fingerprint()` is a blake2b digest over key-sorted canonical JSON — key order is not drift, but array order is, because element order is meaningful in this config. `decide(desired, live, applied)` is a pure, total three-way comparison returning `FirstSync`, `InSync`, `ConfigChanged` or `Drift`.

The policy is **report, still converge**: config remains the source of truth and drift is overwritten, but it is always reported, `--fail-on-drift` turns it into a CI signal, and the `drift` command reports without changing anything.

Detection fidelity differs by resource, and the reason differs too:

- **Value-level** for settings, variables and environments — the live value is readable.
- **Presence-level** for secrets, and that is *not* a limitation we can lift: GitHub never returns a secret's value from any endpoint. A deleted secret is detectable; an edited one is not.
- **Presence-level** for rulesets, which *is* a cost decision rather than an API limit — `GET /rulesets` returns summaries, and full configuration needs one request per ruleset.

## State

`App.layer` wires three stores, all local, all under the XDG data directory:

- **`AppliedState`** — the fingerprint reposets last wrote per `(repo, kind, name)`. Keys join kind and name with a **NUL byte**, which cannot occur in either component. `cleanup` calls `forget` on every deletion, so a recreated resource is not compared against a pre-deletion baseline.
- **`SyncJournal`** — run history and per-resource changes, behind `reposets history`. `history` orders by `rowid`, **not** by the UUIDv7 primary key: v7 is millisecond-precision, so ids minted in the same millisecond order by their random suffix.
- **`RepoCache`** — team slug → id, owner type, repository visibility, languages and workflow count, TTL-bounded. See `RepoCacheShape` for the current set and each entry's key and tag.

## Error model

Errors are tagged data classes. The load-bearing decision is unchanged from v3: a `GitHubError` is caught **per operation**, so one failed API call does not abort the rest of the sync. What changed is that the error's own words survive — an earlier version collapsed a 403, a 404 and a network failure into `could not read current state`, which tells a user nothing.

All resolved credentials are `Redacted.Redacted<string>`, which closes the `toString`, interpolation and `JSON.stringify` leak paths at the type. `Redacted.value` is unwrapped only where a value must physically leave the process or be fingerprinted — the write call in the secrets and variables phases, and the numeric-id substitution in rulesets. It greps, which is the point.

## Rationale

Config-as-template plus runtime credential resolution lets the same `reposets.config.toml` be committed and shared while secrets stay out of version control. Modeling the pipeline as Effect programs gives uniform error handling and lets every service ship a Live and a Test layer, so the orchestration is exercised without touching the GitHub API.
