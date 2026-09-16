---
title: reposets.config.toml
description: The eight-section TOML config file reposets reads to sync GitHub repository resources.
type: Interface
kind: config
resource: ../../package/src/schemas/config.ts
tags: [github, security, docs]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 3364eb8c09e1d0676b75e3f522cb0c4a5badef25f4d0bbe54db852a700d3d59e
sources:
  - id: config-schema
    resource: ../../package/src/schemas/config.ts
  - id: common-schema
    resource: ../../package/src/schemas/common.ts
  - id: ruleset-schema
    resource: ../../package/src/schemas/ruleset.ts
  - id: environment-schema
    resource: ../../package/src/schemas/environment.ts
  - id: cleanup-phase
    resource: ../../package/src/sync/phases/cleanup.ts
  - id: config-refs
    resource: ../../package/src/lib/config-refs.ts
---

# reposets.config.toml

## Contract

`reposets.config.toml` is the one config file `reposets` reads to know which
GitHub repository settings, secrets, variables, rulesets, deployment
environments, security features and CodeQL default setup to apply, and to
which repositories. It decodes against `ConfigSchema`, whose only required
key is `groups`; every other top-level section — `settings`, `secrets`,
`variables`, `rulesets`, `environments`, `security`, `code_scanning` —
defaults to an empty table, so a config that declares repositories and
nothing else is valid and does nothing[^config-schema]. Decoding is strict:
an unknown key anywhere outside a `[settings.*]` group's pass-through
index signature is a decode error, not a silent no-op.

```toml
# No owner here — it lives on the credential profile a group names, not
# on the config. No log_level either.

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
credentials = "personal" # required: names the profile, and so the owner
settings = ["default"]
environments = ["production"]
rulesets = ["branch-protection"]
security = ["baseline"]
code_scanning = ["baseline"]

[groups.my-projects.secrets]
actions = ["deploy", "api"]
dependabot = ["deploy"]

[groups.my-projects.secrets.environments]
production = ["api"]

[groups.my-projects.variables]
actions = ["turbo"]

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

`[secrets.<name>]` and `[variables.<name>]` are each a discriminated union
of exactly one kind, chosen by which sub-key is present[^common-schema]:

- `{ file = { NAME = "path" } }` — read from disk. The path resolves
  relative to the directory that holds `reposets.config.toml`, the same
  base path the engine passes for `[resolve].file` entries in the
  credentials file.
- `{ value = { NAME = "..." } }` — inline. A string value is used as-is; a
  TOML table value is JSON-stringified before it is sent[^common-schema].
- `{ resolved = { NAME = "LABEL" } }` — maps a name to a credential label
  from the active profile's `[resolve]` section; the value comes from
  `reposets.credentials.toml` at sync time, never from this file.

## Ruleset schema

`[rulesets.<name>]` decodes against `RulesetSchema`, a discriminated union
on `type`: `"branch"` or `"tag"`[^ruleset-schema]. Branch rulesets accept
the full shared rule set plus branch-only shorthands (`pull_requests`,
`merge_queue`, `copilot_review`, `code_scanning`, `workflows`,
`branch_name`); tag rulesets accept the shared subset plus `tag_name` only
— no `merge_queue`, `pull_request`, `branch_name_pattern`, `workflows`,
`code_scanning` or `copilot_code_review`[^ruleset-schema].

`buildRulesetPayload()` expands ergonomic shorthand fields into the API's
flat `rules` array, then the shorthand fields themselves are not sent — the
expansion is one-way[^ruleset-schema]:

- `targets` (`"default"` | `"all"` | an array of `{ include }` / `{ exclude }`
  glob patterns) becomes `conditions.ref_name`.
- `pull_requests` (branch only) becomes the `pull_request` rule.
- `status_checks` becomes the `required_status_checks` rule; a top-level
  `default_integration_id` fills in for any check that omits its own
  `integration_id`.
- Boolean flags — `creation`, `update`, `deletion`, `required_linear_history`,
  `required_signatures`, `non_fast_forward` — each become the matching
  parameterless rule when `true`.
- `deployments` (an array of environment names) becomes the
  `required_deployments` rule.

`actor_id` on a bypass actor, `integration_id` on a status check, and
`repository_id` on a required workflow file each accept either a static
integer or `{ resolved = "LABEL" }` for runtime substitution against the
active profile's resolved credential labels, at any depth in the
structure[^ruleset-schema].

## Environment schema

`[environments.<name>]` decodes against `EnvironmentSchema`[^environment-schema]:

- `wait_timer` — minutes to wait before a deployment proceeds, `0`–`43200`.
- `prevent_self_review` — prevents the account that triggered the
  deployment from approving it.
- `reviewers` — an array of `{ type: "User" | "Team", id: number }`.
- `deployment_branches` — `"all"` | `"protected"` | an array of
  `{ name, type? }` custom policies, where `type` defaults to `"branch"`.

A group's `environments` array syncs through `@effected/github`'s
`DeploymentEnvironment` service in the `environments` phase, which runs
before `secrets` and `variables` — an environment-scoped secret or
variable needs its environment to exist first.

## Secret and variable scopes

A group assigns secret groups through `SecretScopesSchema`: `actions`,
`dependabot` and `codespaces`, each an array of secret group names, plus
`environments`, a record mapping environment names to arrays of secret
group names[^config-schema]. Variable groups use `VariableScopesSchema`:
`actions` and `environments` only — no `dependabot` or `codespaces` scope
for variables[^config-schema]. The same named group can be assigned to
different scopes on different `[groups.*]` tables.

## Group reference fields

`[groups.<name>]` accepts reference arrays into the matching top-level
table — `settings`, `rulesets`, `environments`, `security`,
`code_scanning` — plus the `secrets` and `variables` scope structs
above[^config-schema]. `danglingReferences()` reports every reference that
resolves to nothing, across all seven arrays plus **both halves** of an
environment-scoped assignment: the environment name keying the record and
the group names inside it dangle independently, so a checker that read
only one half would pass a config that syncs nothing[^config-refs]. Each
finding carries the names that do exist, because nearly every dangling
reference is a typo, fixed fastest by seeing the correct spelling rather
than being told the wrong one is wrong[^config-refs].

A reference is checked where it is used, not where its section is
defined — an unreferenced `[settings.*]` table is dead config, not an
error[^config-refs].

## Settings schema

`SettingsGroupSchema` is a `StructWithRest`: known fields are typed, and
an index signature passes through anything else to the API
unchanged[^config-schema]. Known fields cover repository features
(`has_wiki`, `has_issues`, `has_projects`, `has_discussions`,
`has_sponsorships`, `has_pull_requests`), forking, the four merge
strategies and their commit-title/message formatting, `delete_branch_on_merge`
and `web_commit_signoff_required`[^config-schema]. `has_sponsorships` and
`has_pull_requests` sync through the GraphQL `updateRepository` mutation
rather than the REST `PATCH`, though both live in the same
`SettingsGroupSchema`.

### `security_and_analysis`

A nested `security_and_analysis` table rides the same `PATCH
/repos/{owner}/{repo}` call as the rest of the settings group. Status
fields take `"enabled" | "disabled"` and cover the GHAS toggles
(`advanced_security`, `code_security`, `secret_scanning_ai_detection`,
`secret_scanning_non_provider_patterns`), the secret-scanning variants
(`secret_scanning`, `secret_scanning_push_protection`), the org-only
delegation toggles (`secret_scanning_delegated_alert_dismissal`,
`secret_scanning_delegated_bypass`), and
`dependabot_security_updates`[^config-schema].

`delegated_bypass_reviewers` is an org-only array; each entry is a
discriminated union of exactly one of `team` (a GitHub team slug) or
`role` (an organization role name from `GET
/orgs/{org}/organization-roles`), with an optional `mode = "ALWAYS" |
"EXEMPT"`[^config-schema]:

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

Both forms resolve to numeric `reviewer_id`s during the `settings` phase,
through `@effected/github`'s `Ruleset` service, before the PATCH is built.
Role ids are per-org even for predefined role names, so resolution
consults the live API for each `(org, role)` pair. `validate` rejects this
construct offline for any group whose profile declares `username`, since
it is organization-only. Omitting any `security_and_analysis` field means
"leave alone" — there is no cleanup scope for it.

## Security group schema

`[security.<name>]` groups three optional booleans, each mapped to a
dedicated PUT/DELETE endpoint rather than the settings PATCH: omitted
fields mean "leave alone"[^config-schema].

- `vulnerability_alerts` — Dependabot vulnerability alerts.
- `automated_security_fixes` — Dependabot security pull requests; the
  schema rejects `automated_security_fixes: true` together with
  `vulnerability_alerts: false` in the same group[^config-schema].
- `private_vulnerability_reporting` — the private vulnerability reporting
  inbox.

A group references these through `security: string[]`; multiple
references merge last-write-wins in the `security` phase, which also
catches the same `automated_security_fixes`/`vulnerability_alerts`
contradiction when it is produced by merging two otherwise-valid groups,
rather than letting GitHub answer with a 422.

## Code scanning group schema

`[code_scanning.<name>]` configures CodeQL default setup, applied through
`PATCH /repos/{o}/{r}/code-scanning/default-setup`. Fields: `state`
(`"configured" | "not-configured"`), `languages`, `query_suite`
(`"default" | "extended"`), `threat_model` (`"remote" |
"remote_and_local"`), `runner_type` (`"standard" | "labeled"`) and
`runner_label` (required when `runner_type = "labeled"`)[^config-schema].

The default-setup language enum is `actions`, `c-cpp`, `csharp`, `go`,
`java-kotlin`, `javascript-typescript`, `python`, `ruby` and
`swift`[^config-schema] — deliberately narrower than the CodeQL analyzer's
own language list, since default setup does not cover every language the
analyzer does (Rust, for one). `actions` is filtered differently from
every other entry in `languages`: it is not a repository language at all,
so the phase checks it against a count of files under
`.github/workflows/` instead of the repository's detected languages.

A group references code-scanning groups through `code_scanning: string[]`;
multiple references merge last-write-wins. The PATCH endpoint returns
`202 Accepted` and configures asynchronously — nothing in reposets polls
for completion.

## Cleanup configuration

`[groups.<name>.cleanup]` is per group, never global. `CleanupScopeSchema`
is a three-way union: `false` (disabled, the default), `true` (delete
every undeclared resource in that scope), or `{ preserve = [...] }`
(delete every undeclared resource except the named ones)[^common-schema].

Scopes nest as `cleanup.secrets.{actions,dependabot,codespaces,environments}`,
`cleanup.variables.{actions,environments}`, `cleanup.rulesets` and
`cleanup.environments`[^common-schema]. All default to `false`. Cleanup
runs as the last phase, so newly synced items in the same run are never
deleted[^cleanup-phase]. Security features and code scanning have no
cleanup scope at all — omitting a field there always means "leave alone".

See
[`enabled-cleanup-scope-deletes-everything-undeclared`](../decisions/enabled-cleanup-scope-deletes-everything-undeclared.md)
for what an enabled scope with nothing declared does, and
[`cleanup-properties`](../invariants/cleanup-properties.md) for the three
properties the `cleanup` phase holds by construction.

[^config-schema]: `package/src/schemas/config.ts`
[^common-schema]: `package/src/schemas/common.ts`
[^ruleset-schema]: `package/src/schemas/ruleset.ts`
[^environment-schema]: `package/src/schemas/environment.ts`
[^cleanup-phase]: `package/src/sync/phases/cleanup.ts`
[^config-refs]: `package/src/lib/config-refs.ts`
