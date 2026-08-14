---
module: reposets
title: Effect Services
category: architecture
status: current
completeness: 90
created: 2026-04-21
updated: 2026-08-14
last-synced: 2026-08-14
related:
  - architecture.md
  - cli.md
  - config-format.md
  - json-schema.md
dependencies: []
---

## Overview

This doc records what each service is responsible for, the boundaries between them, and the non-obvious decisions. Interface shapes and method signatures are authoritative in the source, not here.

Services live in three places, and the split is deliberate:

- `package/src/services/` — the pipeline's own services: `ConfigFiles`, `CredentialResolver`, `OnePasswordClient`, `SyncLogger`.
- `package/src/store/` — durable local state, wired by `@effected/app`.
- `@effected/github` — every GitHub resource service. **They are no longer in this repository.** The rebuild moved them, and the libsodium sealed-box encryption with them; there is no `package/src/services/github/` and no `package/src/lib/crypto.ts`. See "the GitHub boundary" below.

## ConfigFiles

Declarative config loading via `@effected/config-file`. See `package/src/services/ConfigFiles.ts`.

- `ReposetsConfigFile` and `ReposetsCredentialsFile` are `ConfigFile.Service` classes (`discover`, `load`, `loadOrDefault`, `save`, `update`), validated against `ConfigSchema` / `CredentialsSchema`.
- `makeConfigFilesLive(configFlag)` builds the config layer. `AppConfig.layer` appends its own XDG tier after whatever resolvers it is handed, so only the higher-priority tiers are named here.
- `CredentialsFilesLive` is a plain layer with no `--config` tier: that flag names the *config* file, and a credentials file is found next to the project or in the XDG config directory and nowhere else.

**`--config` replaces the upward walk rather than being prepended to it.** With no flag the chain is `upwardWalk` then XDG; with a flag it is `explicitPath` (a file) or `staticDir` (a directory) then XDG, and the walk is not in it at all. A flag naming a path that does not exist fails with `ConfigFlagNotFound` rather than falling through — every `ConfigResolver` has `never` in its error channel, which is right for a probe and wrong for an explicit request, so the distinction is enforced in `makeConfigFilesLive` instead of being pushed into the resolver contract.

**Both loaders decode strictly**, with `parseOptions: { onExcessProperty: "error", errors: "all" }`. `onExcessProperty` makes a typo'd key a rejection rather than a silent no-op; `errors: "all"` is what stops a config with three typos surfacing them one run at a time. Strictness is compatible with the `[settings.*]` pass-through, because keys absorbed by a `StructWithRest` index signature are not excess. (The `STRICT_KEYS` docstring in the source still says it is applied to credentials only — that is stale, `makeConfigFilesLive` passes it too.)

**`discover` propagates a decode failure — it does not swallow one.** An earlier version wrapped it in `Effect.orElseSucceed(() => [])` in two commands, turning a config that was one key wrong into "nothing found" and sending the user to `init` to create a second one. Both now keep the failure and render its structured `issue`.

**Cross-reference checking is not on the loader.** v3 registered `validateConfigRefs` as the config spec's `validate` callback, so a dangling reference failed the load for every command. The v4 rebuild dropped it and, for a period, nothing replaced it — while every phase kept skipping unresolvable references silently and citing that callback by name as the thing that owned the check. A misspelled section name synced nothing, reported nothing and exited 0. It is worth recording as the regression it was: three source comments named a function that had stopped existing, which is how it stayed invisible.

It is restored as `danglingReferences` in `package/src/lib/config-refs.ts` — a pure function in the same shape as `orgOnlyViolations` and `undefinedCredentialLabels`, called by the commands rather than registered on the spec. `ConfigValidationError.issue` is a schema-issue tree and `formatSchemaIssue` renders that shape, so a plain payload on the callback would print badly. The cost of the command-level form is that only the commands that call it check: `validate` and `sync` do, `list`, `doctor` and `history` do not — none of them writes.

## OnePasswordClient

Wraps `@1password/sdk` to resolve `op://` references. The Live layer dynamically imports the SDK; the Test layer returns values from a stub map. See `package/src/services/OnePasswordClient.ts`.

## CredentialResolver

Two responsibilities, and they are worth distinguishing:

- `resolveGitHubToken(profile)` — the token the run authenticates with.
- `resolveAll(profile)` — every label in the profile's `[resolve]` section, as one flat map.

**Everything comes back `Redacted.Redacted<string>`.** That closes the `toString`, interpolation and `JSON.stringify` leak paths at the type rather than by convention. `Redacted.value` is unwrapped only where a value must physically leave the process — the sealed-box encrypt call, and the numeric-id substitution in rulesets, which is documented as the single unwrap in that file.

`github_token` is `{ op }` or `{ env }` **only**; there is no on-disk token option, by design — a CLI should not keep tokens in a file it also asks users to share. See `config-format.md`.

## SyncLogger

Dry-run-aware output for the sync pipeline; all sync output flows through it rather than direct console calls. CLI commands use `Effect.log`/`Effect.logError`, routed by `CliLogger`.

**There are no verbosity tiers.** There were four — `silent`, `info`, `verbose`, `debug` — selected by a `log_level` config key, and both are gone. `verbose` gated exactly one call site, `syncOperation`, which is the entire content of a sync, so the boundary fell between *settings* and everything else rather than between summary and detail. `silent` gated errors too, so a failing run printed nothing and the exit code was the only signal.

`SyncLoggerLive({ dryRun, debug })` takes both settings per invocation, from the `--dry-run` and `--debug` flags. `debug` adds two *suffixes* to lines that print either way — where a resolved value came from, and the applied-versus-live fingerprints behind a drift report — never lines of its own. Dry run prefixes verbs with "would", except `driftDetected`, which is an observation rather than an operation: the drift happened either way and only its consequence is conditional. Errors go to `logError` (stderr) and accumulate for `finish()`.

`groupStart` takes both a `selected` and a `declared` count so a `--repo` filter that narrowed the run reads as `(1 of 3 repos)` rather than as a group that has one repository. `repoSkip` is part of the interface and has no production caller.

## CliLogger

Not a service but a `Logger`, in `package/src/cli/logger.ts`. Effect's default logger emits `[00:33:56.619] INFO (#2): message`, which is right for a service and wrong for a CLI — it made `doctor`'s permission table unreadable.

It renders the message plainly and routes `Error`/`Fatal` to stderr so `reposets sync > log.txt` still shows failures on the terminal.

**It reads the `Console` off the fiber rather than writing to `process.stdout`.** A `Logger` callback is synchronous and so cannot reach `Stdio`'s sinks, but `Console.Console` is a `Context.Reference` that core's own loggers read the same way. It carries a default, so it never appears in `R` — and it makes the stderr/stdout split *assertable*, which a `process.stdout` write is not without stubbing a global.

## The GitHub boundary

Every GitHub resource service is **upstream**, in `@effected/github`, along with the libsodium sealed-box encryption used for secrets. Nothing in `package/src` wraps the GitHub API any more, and no design doc in this module is the authority on those services — read the package.

`sync` merges eight of them over one client: `GitHubRepository`, `Ruleset`, `RepositorySecurity`, `CodeScanning`, `DeploymentEnvironment`, `RepositorySecret`, `RepositoryVariable` and `WorkflowDispatch`, all `.pipe(Layer.provideMerge(GitHubClient.layerFromToken({ token })))`. See `package/src/cli/commands/sync.ts`.

Two properties of that boundary are load-bearing here rather than upstream:

- **A token is fixed at `GitHubClient` construction.** Every resource service is built from that client, so a second identity is a second service graph — there is no swapping one mid-run. That single fact is why `sync` partitions groups by credential profile, and why the run boundary had to move out of the engine.
- **The resource services take no `owner`/`repo` argument.** Each resolves `Repo` from context per call, so a phase carries `Repo` in `R` and the engine discharges it once at the repository loop — the one place that knows which repository is in play.

What was found in these services during the campaign, and fixed upstream: every paginated read was truncated to its first page, including the ruleset existence check that decides create-versus-update. `applySettings` now returns the fields it actually sent, which is what lets the settings phase report those rather than the ones the config asked for.

`tweetnacl` remains in `package/package.json` and is imported nowhere — a leftover of the crypto move.

`blakejs` is **CommonJS**: `import { blake2bHex } from "blakejs"` builds cleanly and throws at runtime. Use the default import. See `package/src/lib/fingerprint.ts`.

## The phases

One module per phase under `package/src/sync/phases/`, plus `resource.ts` for the shared helpers. Each exports an `Effect` that yields a `Phase`; `allPhases` assembles them in `PHASE_NAMES` order. See `architecture.md` for the contract.

Decisions worth recording:

- **`settings`** — referenced groups merge, and each group's `security_and_analysis` merges separately, last-write-wins. `ORG_ONLY_SAA_FIELDS` are stripped on personal accounts; on orgs, team slugs and role names resolve to numeric reviewer ids first.
- **`security`** — merged last-write-wins, undefined meaning "leave alone". The phase catches the `automated_security_fixes = true` with `vulnerability_alerts = false` contradiction that a single group's schema rejects but merging can recreate, rather than letting GitHub answer 422.
- **`code-scanning`** — `REPO_LANG_TO_CODEQL` maps repository language names onto the CodeQL enum; languages outside the map are dropped. **`actions` is checked against workflow files, not languages** — it is not a repository language, so `listRepoLanguages` can never confirm it, and GitHub answers a 422 for a repository with none. The count filters on `.github/workflows/` paths, because configuring default setup makes GitHub add a synthetic `dynamic/github-code-scanning/codeql` workflow that would otherwise let the check satisfy itself on the second run — and that synthetic workflow survives setting the state back to `not-configured`. Workflow *state* is deliberately not filtered: one disabled workflow satisfies GitHub, verified live. If every configured language filters out, the phase sends nothing rather than a `configured` state with an empty list.
- **`rulesets`** — `buildRulesetPayload()` (not `normalizeRuleset`) converts shorthand into API rules; `{ resolved }` references are substituted from the credential map at any depth. A **renamed** ruleset creates a second one rather than renaming the first, because GitHub identifies a ruleset by an id assigned at creation and the config has only a name; `cleanup` removes the orphan.
- **`cleanup`** — see below.

### cleanup

The only phase that removes anything, and last for that reason. Three properties are load-bearing, and each is pinned by a test that fails when the property is mutated away:

1. **An organization's inherited rulesets are never deleted** — filtered out before "undeclared" is even asked.
2. **Every deletion calls `applied.forget`** — otherwise a recreated resource is compared against a pre-deletion fingerprint and reports drift nobody caused.
3. **A dry run deletes nothing** but still names everything it would.

Deletion decisions use `declaredNames`, which reads names from the config **without resolving values** — so a `{ file }` secret group is never opened on the deletion path.

**An enabled scope with nothing declared deletes everything in that scope.** That is the literal reading of "delete what the config does not declare", and it is intentional: a group that enables `cleanup.secrets.actions` and references no secret groups is saying this repository should have no Actions secrets, which is the only way to say it.

Listings and deletes are built as **thunks**. `GitHubClient.layerFixture` records a call when the request function is *invoked*, not when the effect it returns is run, so a prepared-but-unrun effect reads as a request that was sent — which made a disabled scope look like it issued requests and a dry run look like it deleted.

## SyncEngine

Walks the phases. `syncAll(config, credentials, options)`; see `SyncOptions` in `package/src/sync/SyncEngine.ts` for the fields.

**The engine records into a run but does not open or close one.** The run boundary belongs to the command: `sync` partitions groups by credential profile and drives one engine per partition, so an engine that opened its own run would split one invocation across several `history` rows for a reason no reader of `history` can see. `runId` is therefore an input.

Per group it resolves the profile's `[resolve]` labels once, not per repository. The **owner comes from the profile**, not the config — `config.owner` and `group.owner` are gone, and with them the fallback chain that could put a group's owner and its token on different accounts. The profile *declares* the owner type and the engine *verifies* it against GitHub before writing, cached per owner; a mismatch fails that repository by name, and a failed read leaves the declaration standing rather than assuming `Organization` for everyone.

`SyncEngineLive(makePhases)` binds phase requirements at layer construction so `R` does not leak through `syncAll` to callers. `Repo` is the deliberate exception, discharged at the repository loop.

`SyncOptions.failOnDrift` is accepted and never read — the engine returns a `drifted` count and `sync` decides the exit code from it.

## Store services

Wired by `App.layer`; migrations in `package/src/store/migrations.ts`.

- **`AppliedState`** — `get` / `getMany` / `record` / `forget` over `(repo, kind, name)`. The composite map key joins kind and name with a **NUL byte**, which cannot occur in either component. The separator is module-private and `lookup` is exported, because a NUL is invisible in most source viewers and makes a file binary to `grep`.
- **`SyncJournal`** — runs and per-resource changes. `history` orders by **`rowid`**, not the UUIDv7 primary key: v7 is millisecond-precision, so ids minted in the same millisecond order by their random suffix.
- **`RepoCache`** — team slug → id, owner type, repository languages, over `Cache.through`.
