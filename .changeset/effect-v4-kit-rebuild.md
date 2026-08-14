---
"reposets": major
---

## Breaking Changes

### Verbosity tiers are gone, along with `log_level`

`sync --log-level silent|info|verbose|debug` and the `log_level` config key are both removed. Delete `log_level` from `reposets.config.toml`; there is nothing to replace it with, because sync output is now one level and shows everything.

The tiers looked like a summary-versus-detail choice and were not. `verbose` gated exactly one thing — the per-resource line for every secret, variable, ruleset, environment and security toggle — so the default tier reported a change count with the changes themselves suppressed. A dry run naming five changes and printing one is not something anyone can act on.

`silent` suppressed errors as well, so a failing run printed nothing and the exit code was the only signal. Redirect stdout instead: errors go to stderr and survive it.

`--log-level` is still Effect core's own global flag (`all|trace|debug|…|none`), a severity filter over log records. It never fed sync output and now has nothing to be confused with.

### `sync --debug` and `drift --debug`

The one part of `debug` worth keeping, as a flag rather than a stored level: it annotates lines that print either way with where a resolved value came from, and with the applied and live fingerprints behind a drift report.

### `owner` has moved to the credential profile

There is no `owner` in `reposets.config.toml` any more — not at the top level and not on a group. A profile declares who it acts as, with exactly one of `username` or `org`:

```toml
[profiles.personal]
username = "spencerbeggs"
github_token = { op = "op://Private/github/token" }

[profiles.sandbox]
org = "reposets-sandbox"
github_token = { op = "op://Private/github/org-token" }
```

A token authenticates *as* an identity, so the account belongs to the credential rather than to the repositories being configured. Two keys rather than an `owner` plus an `owner_type` means an owner without a type cannot be expressed, and declaring both is rejected.

One owner per profile: a token reaching several owners is declared as several profiles sharing a token reference. `reposets credentials create` now requires `--username` or `--org`.

### Dead surface removed

`op_service_account` was declared per profile in the credentials schema and read by nothing — the 1Password service-account token has always come from `OP_SERVICE_ACCOUNT_TOKEN` in the environment. It shipped in the published JSON schema, so editors autocompleted a key that did nothing.

Also removed, all verified to have no callers: `SyncOptions.failOnDrift` (the exit code is decided from the returned drift count), `SyncLogger.syncSummary` and `SyncLogger.repoSkip`, and the `tweetnacl` dependency, which nothing imported once the sealed box moved to `@effected/github`.

### Every group must name a credential profile

`credentials` is now **required** on every `[groups.*]` section, including in single-profile configs:

```toml
[groups.my-projects]
repos = ["repo-one", "repo-two"]
credentials = "personal"
```

The field names the identity the group is synced as. Optional would have to mean "the only profile", which stops being well defined the day a second profile is added — so adding an unrelated profile could change which account an existing group writes to, with nothing in that group having changed. It replaces two implicit behaviours that could each pick the wrong account silently: `sync` refused to run with more than one profile configured, and a group naming none fell back to whichever profile TOML happened to order first.

## Features

### `drift`

Reports resources changed outside reposets and changes nothing, exiting non-zero when drift is found so it gates CI without a flag. It writes nothing to GitHub *and* nothing to the drift baseline, so a check cannot quietly accept the drift it just reported.

### `history`

Past runs from the sync journal, newest first, with a `RUN` id column. Runs that failed show their error.

* `history [--limit <n>] [--repo owner/name]` — the listing
* `history show --run <id>` — every resource one run touched, grouped by repository; the id may be any unique prefix
* `history prune [--keep <n>]` — delete all but the newest runs
* `history clear` — delete every run

Both deletions leave the applied state and cache alone, so drift detection keeps working.

### `nuke`

Deletes every reposets file on this machine — project and user config, credentials, and the state database. Nothing on GitHub is touched. It lists only paths that actually exist, names what each loss costs, and refuses to run in a non-interactive shell unless `--force` is passed.

### Selecting sync phases

`sync --only <phase>` and `sync --skip <phase>` select phases by name. `--only` wins when both name the same phase, and selection always preserves the canonical phase order regardless of flag order.

### Per-group credential tokens

A group's `credentials` profile now selects its **token**, not only its `[resolve]` values, so one config can sync repositories owned by different accounts. `sync` partitions groups by profile and runs one engine per partition, in config order.

One `sync` remains one run in `history` however many identities it used, and a profile that is unknown or whose token will not resolve fails only its own groups — the rest of the run still happens. `list` now shows each group's profile alongside its owner.

### `sync --fail-on-drift`

Exits non-zero when a resource has changed outside reposets.

### `validate` catches undeclared credential labels without a network call

A `resolved` secret or variable naming a label the group's profile does not declare in `[resolve]` is now rejected offline. Its sync-time equivalent compares against resolved values, so it could not fire until a run had authenticated and reached the secrets phase — after settings, environments and rulesets had already been written.

### `validate` catches organization-only settings without a network call

Because the profile declares the owner type, `validate` can now reject constructs that need an organization when the group's profile is a personal account — a `Team` ruleset bypass actor, a `Team` environment reviewer, and `secret_scanning_delegated_bypass` / `delegated_bypass_reviewers`. Previously the owner's type was only knowable by asking GitHub, so these surfaced as a 422 partway through a sync, after earlier repositories had already been written.

`sync` still verifies the declared type against GitHub before writing, and now fails with a named error when the two disagree instead of sending a request GitHub rejects.

### `doctor` says where everything lives

Now prints the package version, the credentials file the resolver chain actually found, and the state database path — alongside the existing live token check. The required-permissions list is labelled as a requirement rather than a verification, because GitHub does not expose a fine-grained token's own scopes.

### `validate` rejects references to sections that do not exist

A group naming a settings, ruleset, environment, security, code-scanning, secret or variable group that is not defined is now an error, reported with the names that *are* defined so a typo shows its own fix. `sync` runs the same check and refuses before writing anything.

### `doctor` explains what 1.0 removed, and checks more

Removed keys (`owner`, `log_level`, and `owner` on a group) are reported with where each one went rather than as unknown keys — the nearest-match hint was actively misleading, since `owner` is three edits from `repos`. It also warns on unrecognised fields inside `[settings.*]`, and for a profile declaring `username` it asserts that the token's owner matches.

## Bug Fixes

* Every paginated read was truncated to its first page. Repositories with more than one page of rulesets, secrets, variables or environments were compared against a partial listing — including the ruleset existence check that decides create-versus-update.
* CodeQL default setup no longer sends the `actions` language to repositories with no workflow files, which GitHub rejects with a 422. Workflow files are now counted directly, and CodeQL's own generated workflow is excluded from that count so it cannot satisfy the precondition on its own.
* `sync` reports the settings fields it actually sent rather than the fields the config requested. Fields dropped to satisfy GitHub's own rules — a merge-commit title alongside the merge strategy being disabled — were previously named as applied.
* Organization-only repository settings are skipped for repositories whose visibility does not support them, instead of failing the settings phase.
* Cross-reference validation was dropped during the rebuild and nothing replaced it, so a misspelled section name synced nothing, reported nothing, and `validate` printed `Valid:`. Several phases skipped unresolvable references *because* a validator that no longer existed was supposed to catch them.
* `--only` and `--skip` ran **every** phase when given a name that does not exist: unrecognised names were filtered out, and an empty selection reads as "no filter". A flag used to limit the blast radius of a destructive command did the opposite and reported success.
* The `[resolve]` section's `value` sub-group was never read. Every inline label resolved to nothing, and configs referencing one were told the label "is not defined in the active profile's `[resolve]` section" — about a label that was declared.
* `--repo` reported an error for every group that did not contain the named repository, so any multi-group config exited non-zero on a successful run.
* A misspelled field inside `[settings.*]` passed every gate: the schema accepts unknown fields by design, GitHub ignores them, and the run reported them as applied.
* `doctor` reported a credentials file that exists but fails to parse as `(not created yet)`, four lines after saying it failed to load.
* A profile whose token will not resolve now reports the resolver's own reason, so an unset `OP_SERVICE_ACCOUNT_TOKEN` is distinguishable from a reference pointing at nothing.
* Group headers report the selection, not just the count: a `--repo` filter now prints `group: name (1 of 3 repos)` rather than `(1 repo)`.
* The `[resolve]` section's `value` sub-group was never read. Every inline label resolved to nothing, and configs referencing one were told the label "is not defined in the active profile's `[resolve]` section" — about a label that was declared. Strings pass through and objects are JSON-stringified, matching the `value` kind of a secret or variable group.
* `--repo` no longer reports an error for every group that does not contain the named repository, which made any multi-group config exit non-zero on a successful run. The filter is judged across the whole run: an error only when it matched nothing anywhere.
* A profile whose token will not resolve now reports the resolver's own reason, so an unset `OP_SERVICE_ACCOUNT_TOKEN` is distinguishable from a reference pointing at nothing.

## Documentation

`docs/migrating-to-1.0.md` is new: before-and-after TOML for every breaking change, plus a checklist. Every existing config breaks on at least three of them at once, and `reposets doctor` names each removed key it finds.

## Refactoring

Rebuilt on Effect v4 and the `@effected/*` kit. `@effect/cli` does not exist on the v4 line; the CLI now uses `effect/unstable/cli` from core. The GitHub resource services and the libsodium sealed-box encryption used for secrets moved into `@effected/github`.
