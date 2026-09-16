---
title: Repository subsystems reposets does not manage
description: A table of repository-level GitHub subsystems a declarative tool could own that reposets has no config shape for, and what each would take upstream.
type: Limitation
status: draft
bounds: ../modules/reposets.md
tags: [github, architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: be12e99721d72a294452fe9ab0403635b08065abce655a2e0fbcabbb9eb360d6
sources:
  - id: config-schema
    resource: ../../package/src/schemas/config.ts
  - id: github-repository
    resource: ../../package/node_modules/@effected/github/GitHubRepository.js
---

# Repository subsystems reposets does not manage

## The condition and the symptom

Each subsystem below is a repository-level setting exposed by GitHub's API that a declarative sync tool could reasonably own, alongside what reposets already manages (repository settings, secrets, variables, rulesets, deployment environments, security features, CodeQL default setup). None has a config shape today. Nothing in the schema or the CLI warns when a config author reaches for one of these: `reposets.config.toml` simply has no top-level table or group field that names it, so the gap is silent rather than reported.

| Subsystem | Endpoint family | Note |
| :--- | :--- | :--- |
| Topics | `repos/replace-all-topics` | a whole-list `PUT`, so it is naturally declarative — the closest thing to free |
| Actions default token permissions | `actions/set-github-actions-default-workflow-permissions-repository` | read-vs-write default for `GITHUB_TOKEN`, and whether PRs can be approved by Actions; a security control |
| Actions permissions | `actions/set-github-actions-permissions-repository`, `actions/set-allowed-actions-repository` | whether Actions runs at all, and which actions are allowed |
| Fork PR policy | `actions/set-fork-pr-contributor-approval-permissions-repository`, `actions/set-private-repo-fork-pr-workflows-settings-repository` | who can run workflows from forks |
| Retention | `actions/set-artifact-and-log-retention-settings-repository`, `actions/set-actions-cache-retention-limit-for-repository` | artifact/log days, cache size |
| OIDC subject claim | `actions/set-custom-oidc-sub-claim-for-repo` | matters for anyone federating cloud credentials |
| Labels | `issues/create-label`, `update-label`, `delete-label` | per-item, so it needs the same three-way cleanup model as secrets |
| Autolinks | `repos/create-autolink`, `delete-autolink` | per-item, no update endpoint — changing one is delete-then-create |
| Webhooks | `repos/create-webhook`, `update-webhook`, `delete-webhook` | carries a secret, so it belongs to the credential model |
| Deploy keys | `repos/create-deploy-key`, `delete-deploy-key` | keys are write-only after creation, like secrets |
| Collaborators | `repos/add-collaborator`, `remove-collaborator` | access control; the same blast-radius argument as the fields in [settings fields deliberately not typed](../decisions/settings-fields-deliberately-not-typed.md) applies |
| Pages | `repos/create-pages-site`, `update-information-about-pages-site` | source branch/path, custom domain, HTTPS enforcement |
| Custom properties | `repos/custom-properties-for-repos-create-or-update-repository-values` | org-defined key/values; a natural fit for group-level defaults |
| Immutable releases | `repos/enable-immutable-releases`, `disable-immutable-releases` | a boolean toggle in the shape `security` already uses |

## Why this is acceptable

Everything reposets manages today is either a repository **toggle** — one PATCH-style call, merged last-write-wins across the groups that reference it — or a **collection of named resources** with create/update/delete and a three-way `CleanupScope`, the shape `secrets`, `variables`, `rulesets` and `environments` already share. Both patterns are established, and phases are data the engine walks rather than a hardcoded sequence, so adding a ninth phase for a new toggle or a new resource collection is cheap in principle.

What the config genuinely has no shape for is a **per-repository value** — a description, a homepage, a custom property — because a `[groups.*]` group applies the same set of resources to every repository it lists. Several of the subsystems above, and the `description`/`homepage` fields discussed in [settings fields deliberately not typed](../decisions/settings-fields-deliberately-not-typed.md), hit that same wall independently. That is the next structural decision this config format needs, not a per-feature one, and it is why none of the sketches below tries to solve it.

## What each would take

Every candidate below needs `@effected/github` to expose new surface before reposets can consume it; none of the eight resource services `sync` already merges (`GitHubRepository`, `Ruleset`, `RepositorySecurity`, `CodeScanning`, `DeploymentEnvironment`, `RepositorySecret`, `RepositoryVariable`, `WorkflowDispatch`) covers any of them.

- **Topics** needs two members on `GitHubRepository` — a `topics()` read and a `setTopics()` whole-list replace — filed as `effected#359`, open as of this writing. Because `PUT` replaces the whole set, the endpoint is already declarative and would cost no new concept in the config; the one caveat is that GitHub lowercases every topic name on write, so the applied-state baseline this tool records must come from the response rather than from the request the config sent, or every run after the first would report spurious drift.
- **Actions default token permissions** — and the wider Actions-policy surface — is the highest-value gap here: `default_workflow_permissions = "read"` is a meaningful supply-chain control, it is per-repository, and nothing else in the tool sets it. It reads like a new phase beside `security` rather than an extension of an existing one, since it is several endpoints answering to one concept.
- **Labels** need identity and deletion, so they follow the `secrets`/`variables` shape rather than the `settings` shape — the same three-way `CleanupScope` union already models exactly the reconcile labels would need.
- **Autolinks, webhooks, deploy keys, Pages, custom properties** are each per-item create/update/delete against an endpoint family `@effected/github` does not expose today, and each needs its own new upstream service before a config shape is worth sketching.

These sketches are illustrative, not proposed schemas — no field name or table shape below is committed:

```toml
# Topics — a settings-style group. GitHub lowercases every name, so the
# applied baseline is recorded from the response, not this list.
[topics.oss]
topics = ["effect", "typescript", "github"]

[groups.mine]
topics = ["oss"]
```

```toml
# Actions policy — a new phase beside `security`.
[actions.hardened]
enabled = true
allowed_actions = "selected"          # all | local_only | selected
allowed_patterns = ["actions/*", "github/*"]
default_workflow_permissions = "read" # read | write
can_approve_pull_requests = false
artifact_retention_days = 30

[groups.mine]
actions = ["hardened"]
```

```toml
# Labels — a per-item group with the same three-way cleanup as secrets.
[labels.standard.value]
bug = { color = "d73a4a", description = "Something is broken" }
enhancement = { color = "a2eeef" }

[groups.mine]
labels = ["standard"]

[groups.mine.cleanup]
labels = { preserve = ["wontfix"] }
```

Requests for this surface stay unfiled until something is about to drive them against real repositories, on purpose: asking upstream for a capability this project is not yet exercising is how a kit accumulates code nobody exercises, and this project's own history is evidence that unexercised surface is where silent defects live — the security phase had no tests because its service was never wired into the test harness, and `has_discussions` shipped inert for the whole v3 line before anyone drove it against a real repository and read the result back (see [`has_discussions` shipped inert](../incidents/has-discussions-shipped-inert.md)).
