---
module: reposets
title: Configuration Format
category: other
status: current
completeness: 90
created: 2026-04-21
updated: 2026-08-14
last-synced: 2026-08-14
related:
  - architecture.md
  - cli.md
  - services.md
  - json-schema.md
dependencies: []
---

## Overview

reposets reads two TOML files. This doc describes their structure and the schemas that validate them — the authoritative shapes live in `package/src/schemas/`. Generation of editor JSON schemas from these definitions is a separate build-time subsystem; see `json-schema.md`.

| File | Purpose | Location |
| :--- | :------ | :------- |
| `reposets.config.toml` | Groups, settings, environments, secrets, variables, rulesets, security, code_scanning, cleanup | XDG or project-local |
| `reposets.credentials.toml` | Named credential profiles with resolve sections (gitignored) | XDG config dir |

## Config path resolution

A declarative resolver chain (first match wins) finds the config. `makeConfigFilesLive(configFlag)` builds it, and `AppConfig.layer` appends the XDG tier itself:

- **No `--config`:** `upwardWalk` from cwd looking for `reposets.config.toml`, then XDG (`$XDG_CONFIG_HOME/reposets/` or `~/.config/reposets/`).
- **`--config <file>`:** `explicitPath`, then XDG.
- **`--config <dir>`:** `staticDir` over that directory, then XDG.

**The flag replaces the upward walk rather than being prepended to it**, and a flag naming a path that does not exist fails with `ConfigFlagNotFound` instead of falling through — otherwise `--config /nope.toml` would quietly load the XDG config.

Credentials use a separate chain — `upwardWalk` plus the XDG tier, no `--config` support. File references in `file`-kind groups resolve relative to the directory containing `reposets.config.toml`, which is also what the engine passes as the base path for `[resolve].file` entries in the credentials file.

## Config structure

```toml
# No owner here — it belongs to the credential profile a group names.
# No log_level either: it and the four verbosity tiers are gone.

[settings.default]
has_wiki = false
delete_branch_on_merge = true

[settings.default.security_and_analysis]
secret_scanning = "enabled"
secret_scanning_push_protection = "enabled"
dependabot_security_updates = "enabled"

[security.baseline]
vulnerability_alerts = true
automated_security_fixes = true
private_vulnerability_reporting = true

[code_scanning.baseline]
state = "configured"
languages = ["javascript-typescript", "python"]
query_suite = "extended"

[environments.production]
wait_timer = 30
prevent_self_review = true

[[environments.production.reviewers]]
type = "User"
id = 12345

[secrets.deploy.file]
NPM_TOKEN = "./private/NPM_TOKEN"

[secrets.api.resolved]
API_KEY = "SILK_API_KEY"

[variables.turbo.value]
NODE_ENV = "production"

[rulesets.branch-protection]
name = "branch-protection"
type = "branch"
enforcement = "active"
targets = "default"
non_fast_forward = true

[rulesets.branch-protection.pull_requests]
approvals = 1

[rulesets.branch-protection.status_checks]
default_integration_id = { resolved = "SILK_APP_ID" }

[[rulesets.branch-protection.status_checks.required]]
context = "CI"

[groups.my-projects]
repos = ["repo-one", "repo-two"]
credentials = "personal"   # required: names the profile, and so the owner
settings = ["default"]
environments = ["production"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"], environments = { production = ["api"] } }
variables = { actions = ["turbo"], environments = { staging = ["turbo"] } }
rulesets = ["branch-protection"]
security = ["baseline"]
code_scanning = ["baseline"]

[groups.my-projects.cleanup]
rulesets = true
environments = true

[groups.my-projects.cleanup.secrets]
actions = true
dependabot = { preserve = ["LEGACY_TOKEN"] }

[groups.my-projects.cleanup.variables]
actions = true
```

## Resource group model

Secret and variable groups are discriminated by kind — each group is exactly one kind, determined by its sub-key:

- `{ file = { NAME = "path" } }` — read from disk relative to the config dir.
- `{ value = { NAME = "string" } }` — inline; strings as-is, TOML tables JSON-stringified.
- `{ resolved = { NAME = "LABEL" } }` — map names to credential labels from the active profile's `[resolve]` section.

Rulesets are typed TOML tables (see Ruleset schema). Integer fields in rulesets accept `{ resolved = "LABEL" }` for runtime substitution.

## Ruleset schema

Rulesets are a discriminated union by `type`: `BranchRuleset` or `TagRuleset`. Branch rulesets support the full GitHub rule set plus the `pull_requests` shorthand; tag rulesets support the subset that applies to tags (no `merge_queue`, `pull_request`, `branch_name_pattern`, `workflows`, `code_scanning` or `copilot_code_review`). The authoritative rule list and per-type support are in `package/src/schemas/ruleset.ts`.

### Shorthand fields

`buildRulesetPayload()` converts ergonomic shorthand fields into the API-compatible rule format, then strips them from the output:

- `targets` (`"default"` | `"all"` | array of `{ include }` / `{ exclude }` patterns) -> `conditions.ref_name`.
- `pull_requests` (branch only) -> the `pull_request` rule.
- `status_checks` -> the `required_status_checks` rule; a top-level `default_integration_id` is applied to checks that omit it.
- Boolean flags (`creation`, `update`, `deletion`, `required_linear_history`, `required_signatures`, `non_fast_forward`) -> the corresponding parameterless rules.
- `deployments` (array of environment names) -> the `required_deployments` rule.

Fields `actor_id`, `integration_id` and `repository_id` accept a static integer or `{ resolved = "LABEL" }`.

## Environment schema

Top-level `[environments.<name>]` tables define deployment environments:

- `wait_timer` — minutes to wait before deployments (0-43200).
- `prevent_self_review` — prevent the deployment trigger from approving.
- `reviewers` — array of `{ type: "User" | "Team", id: number }`.
- `deployment_branches` — `"all"` | `"protected"` | array of `{ name, type? }` custom policies (type defaults to `"branch"`).

Environments referenced by a group's `environments` array sync through `@effected/github`'s `DeploymentEnvironment` service, in the `environments` phase — before secrets and variables, because an environment-scoped secret needs its environment to exist.

## Secret and variable scopes

Secrets are assigned through a `SecretScopes` struct: `actions`, `dependabot` and `codespaces` (each an array of secret group names) plus `environments` (a record mapping environment names to arrays of secret group names). Variables use a `VariableScopes` struct with `actions` and `environments`. The same group can be assigned to different scopes on different groups.

## Group reference fields

`[groups.<name>]` accepts reference arrays, each pointing into the matching top-level table: `settings`, `rulesets`, `environments`, `security` and `code_scanning`, plus the `secrets` and `variables` scope structs above.

`danglingReferences` (`package/src/lib/config-refs.ts`) reports every reference that resolves to nothing. It covers all seven arrays plus **both halves of an environment-scoped assignment** — the environment name keying the record and the group names inside it dangle independently, and a checker that looked at only one of them would pass a config that syncs nothing. Each finding carries the names that *do* exist, because nearly every one of these is a typo and a typo is fixed by seeing the correct spelling.

A reference is checked where it is **used**, not where a section is defined: an unreferenced `[settings.*]` section is dead config rather than an error.

`validate` reports and exits 1, ahead of the org-only and credential-label checks, since a dangling reference makes those later checks about resources that were never going to be applied. `sync` refuses before writing anything. This was **absent for part of the v4 rebuild** — v3 enforced it on the loader, the rebuild dropped it, and each phase went on skipping unresolvable references silently while citing the deleted validator by name. A misspelled group name synced nothing, reported nothing and exited 0.

## Settings schema

`SettingsGroupSchema` is a typed struct of known fields with an index signature for pass-through of unknown fields. See `package/src/schemas/config.ts` for the field list. Known fields cover repository features, forking, merge strategies and commit formatting, branch-delete-on-merge and `web_commit_signoff_required`. `has_sponsorships` and `has_pull_requests` are synced via the GraphQL `updateRepository` mutation rather than REST.

### `security_and_analysis` block

`SettingsGroupSchema` allows a nested `security_and_analysis` table whose fields ride along with the same `PATCH /repos/{owner}/{repo}` call as the rest of the settings. The reshaping — status fields wrapped as `{ status }`, `delegated_bypass_reviewers` rewritten under `secret_scanning_delegated_bypass_options.reviewers` — is `@effected/github`'s job now, not this repository's. Status fields take `"enabled" | "disabled"` and cover the GHAS toggles, secret-scanning variants and `dependabot_security_updates`; some are GHAS-licensed and some are org-only.

The block also accepts an org-only `delegated_bypass_reviewers` array. Each entry is a discriminated union of exactly one of `team` (a GitHub team slug) or `role` (an organization role name from `GET /orgs/{org}/organization-roles`), with an optional `mode = "ALWAYS" | "EXEMPT"`. Both forms resolve to numeric `reviewer_id`s in the `settings` phase, through `@effected/github`'s `Ruleset` service, before the PATCH is built. Role IDs are per-org even for predefined roles, so resolution consults the live API per (org, role) pair. `validate` rejects this construct offline when the group's profile declares `username`, since it is organization-only.

```toml
[settings.oss-defaults.security_and_analysis]
secret_scanning = "enabled"
secret_scanning_push_protection = "enabled"
dependabot_security_updates = "enabled"

[[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
team = "security-team"
mode = "ALWAYS"

[[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
role = "admin"
mode = "EXEMPT"
```

GHAS-licensed fields generally succeed on public repos and fail (HTTP 422) on unlicensed private repos; org-only fields are stripped from the merged block on personal accounts before the PATCH. Omitting any field means "leave alone" — there is no cleanup scope for it.

## Security group schema

Top-level `[security.<name>]` groups configure the repository security features that have dedicated PUT/DELETE endpoints. Each field is an optional boolean; omitted fields are "leave alone".

- `vulnerability_alerts` — Dependabot vulnerability alerts.
- `automated_security_fixes` — Dependabot security PRs; requires `vulnerability_alerts` to also be enabled.
- `private_vulnerability_reporting` — private vulnerability reporting inbox.

Groups reference these via the `security: string[]` field. Multiple references merge last-write-wins in the `security` phase, which probes the current state and only toggles on a diff. The phase also catches the `automated_security_fixes = true` with `vulnerability_alerts = false` contradiction that a single group's schema rejects but merging can recreate, rather than letting GitHub answer 422.

## Code scanning group schema

Top-level `[code_scanning.<name>]` groups configure CodeQL default setup, applied via `PATCH /repos/{o}/{r}/code-scanning/default-setup`. Fields: `state` (`"configured" | "not-configured"`), `languages` (default-setup language literals, filtered against detected languages with a warning rather than a failure), `query_suite`, `threat_model`, `runner_type` and `runner_label` (required when `runner_type = "labeled"`).

`actions` is filtered differently from every other language: it is not a repository language, so it is checked against a count of files under `.github/workflows/` instead. See the `code-scanning` phase notes in `services.md` for why that count excludes GitHub's own synthetic CodeQL workflow.

The default-setup language enum is `actions`, `c-cpp`, `csharp`, `go`, `java-kotlin`, `javascript-typescript`, `python`, `ruby` and `swift`. This is intentionally narrower than the CodeQL analyzer language list — for example Rust is supported by the CodeQL analyzer but not by default setup. Widen the literal in `package/src/schemas/config.ts` if GitHub extends default-setup support.

Groups reference these via `code_scanning: string[]`; multiple references merge last-write-wins in the phase. The PATCH endpoint returns `202 Accepted` and applies asynchronously; nothing polls for completion.

## Cleanup configuration

Cleanup is per group, not global; each group can have its own `[groups.<name>.cleanup]` section. The `CleanupScope` type is a three-way union: `false` (disabled, the default), `true` (delete all undeclared resources) or `{ preserve = [...] }` (delete undeclared except preserved).

Scopes nest as `cleanup.secrets.{actions,dependabot,codespaces,environments}`, `cleanup.variables.{actions,environments}`, `cleanup.rulesets` and `cleanup.environments`. All default to `false`. Cleanup runs last so newly synced items are never deleted. Security features and code scanning have no cleanup scope — omission means "leave alone".

**An enabled scope with nothing declared deletes everything in that scope.** That is the literal reading of the policy and is intentional: enabling `cleanup.secrets.actions` while referencing no secret groups says this repository should have no Actions secrets, and there is no other way to say it. Every deletion is named in the output, and `--dry-run` lists them without touching anything.

An organization's **inherited** rulesets are never deleted, regardless of scope.

## Credentials

**Tokens are never stored on disk.** `github_token` is a *reference*, not a value: either `{ op = "op://..." }` or `{ env = "VAR_NAME" }`. v3 accepted a literal token and a literal `op_service_account_token`; both are gone. A CLI's credentials file is exactly the file people are most likely to copy, share or accidentally commit, so the only thing in it is an address.

The 1Password service-account token itself comes from the `OP_SERVICE_ACCOUNT_TOKEN` environment variable, so a user grants access to one scoped space rather than pasting secrets into a config.

```toml
[profiles.personal]
github_token = { op = "op://vault/item/field" }
# or: github_token = { env = "GITHUB_TOKEN" }

[profiles.personal.resolve.op]
SILK_APP_ID = "op://vault/item/field"

[profiles.personal.resolve.file]
DEPLOY_KEY = "./private/deploy.key"

[profiles.personal.resolve.value]
BOT_NAME = "mybot[bot]"
REGISTRIES = { npm = "https://registry.npmjs.org" }
```

Every group names its profile: `credentials = "profile-name"` is **required**, even when only one profile exists. The `[resolve]` section defines named labels in four sub-groups — `op` (1Password references), `env` (environment variables), `file` (file paths) and `value` (inline strings or objects) — that all contribute to one flat namespace referenced by config templates. Every resolved value is `Redacted`.

### The owner lives on the profile

There is no `owner` in `reposets.config.toml`, at the top level or on a group. A token authenticates *as* an identity, so the account is a property of the credential, and a profile declares it as exactly one of `username` or `org`:

```toml
[profiles.personal]
username = "spencerbeggs"
github_token = { op = "op://Private/github/token" }

[profiles.sandbox]
org = "reposets-sandbox"
github_token = { op = "op://Private/github/org-token" }
```

**Two keys rather than an `owner` plus an `owner_type`**, so an owner without a type is unrepresentable. The branches forbid each other's key: a plain union of two structs accepts a profile declaring both and silently drops the second — verified against the installed beta — which would make the contradictory state representable and resolve it by branch order.

**One owner per profile.** A token reaching several owners is declared as several profiles sharing a token reference. Repetitive, but it keeps every group's owner a single lookup with no fallback chain, and a group can never end up writing to one account with another account's token.

### What the declared type buys

`ownerType` gates organization-only constructs, and the only way to learn it used to be asking GitHub — so `validate`, whose whole contract is that it touches no network, could not check them at all. They surfaced as a 422 partway through a sync, after earlier repositories had already been written.

`orgOnlyViolations` now rejects three constructs assigned to a personal-account group, offline and without a token: a `Team` ruleset bypass actor, a `Team` environment reviewer, and `secret_scanning_delegated_bypass` / `delegated_bypass_reviewers`.

Each is checked where it is **referenced**, not where it is defined: a ruleset with a team actor is valid sitting in `[rulesets.*]` and only becomes an error when a personal-account group assigns it. Reporting the definition would name a section shared across groups that the user cannot change without breaking the groups legitimately using it.

**The declaration is not proof.** `sync` still reads the owner's type from GitHub — cached per owner, as before — and compares it to the declaration, failing the repository with a named error on a mismatch. Believing a hand-written claim in the write path would be the same mistake this campaign kept finding: a precondition satisfied by our own assumption. On a failed read the declaration now stands, which is strictly better than the previous fallback of assuming `Organization` for everyone.

### Why `credentials` is required rather than defaulted

The field names the identity a group is synced **as**, which is the one property of a group that decides whether it can act at all. An optional field would have to mean "the only profile", and that stops being well defined the moment a second profile is added — so adding an unrelated profile would either change which account an existing group writes to, or turn a working config into an error, with nothing in the group itself having changed.

Requiring it makes adding a profile inert for every group that already exists. The cost is one line per group in a single-profile config, paid once.

It replaces two implicit behaviours, both of which could pick the wrong account silently: `sync` refused to run with more than one profile at all, and the engine fell back to `Object.values(profiles)[0]` for a group that named none — making the identity depend on TOML key order.

### One identity per group, several per run

`credentials` now selects the profile's **token** as well as its `[resolve]` values.

A token is fixed at `GitHubClient` construction and every resource service is built from that client, so a second identity is a second service graph — there is no swapping one mid-run. `sync` therefore partitions groups by profile and runs one engine per partition, in the config's order of first appearance.

Three consequences worth knowing:

- **One `sync` is still one run** in `history`. The run boundary belongs to the command, so the engine records into a run it is given rather than opening its own; otherwise one invocation would appear as several rows for a reason no reader of `history` could see.
- **A bad profile fails its own groups, not the command** — the same policy for an unknown profile name and an unresolvable token. The alternative loses a four-group sync to the fourth group's typo after the first three have already written to GitHub.
- **Only profiles with selected groups are resolved**, so `--group` against one profile is not held hostage by an unrelated profile whose 1Password item was renamed.
