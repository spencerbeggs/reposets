---
module: reposets
title: GitHub API coverage and gaps
category: architecture
status: current
completeness: 90
created: 2026-08-14
updated: 2026-08-14
last-synced: 2026-08-14
related:
  - config-format.md
  - cli.md
  - architecture.md
dependencies: []
---

## What this is

An audit of what reposets sets against what GitHub's API accepts, at 1.0.0. Every claim here was read from `@octokit/openapi-types@28.0.0` — the request-body schema of each endpoint, brace-walked rather than grepped — and from `@effected/github@0.4.0`'s source, not from documentation or memory.

Its purpose is to record **one confirmed defect**, the fields we deliberately do not set, and the subsystems we do not touch, with proposed config shapes. Nothing here is a commitment to implement.

## The settings phase, field by field

`SettingsGroupSchema` types 20 fields. `PATCH /repos/{owner}/{repo}` accepts 25. They overlap by 17.

| Our field | Route | Status |
| :--- | :--- | :--- |
| `has_issues`, `has_projects`, `has_wiki` | REST `PATCH /repos` | works |
| `is_template` | REST | works |
| `allow_squash_merge`, `allow_merge_commit`, `allow_rebase_merge` | REST | works |
| `allow_auto_merge`, `allow_update_branch`, `allow_forking` | REST | works |
| `delete_branch_on_merge` | REST | works |
| `squash_merge_commit_title`, `squash_merge_commit_message` | REST | works |
| `merge_commit_title`, `merge_commit_message` | REST | works |
| `web_commit_signoff_required` | REST | works |
| `security_and_analysis` | REST, reshaped by `transformSecurityAndAnalysis` | works |
| `has_sponsorships` | GraphQL `updateRepository.hasSponsorshipsEnabled` | works |
| `has_pull_requests` | GraphQL `updateRepository.hasPullRequestsEnabled` | works |
| **`has_discussions`** | **nowhere** | **inert — see below** |

### `has_discussions` is inert

`PATCH /repos/{owner}/{repo}` does **not** accept `has_discussions`. Confirmed by walking the request body's braces: the field appears 59 times in the OpenAPI types — on the repository *response* object, and on repository *creation* — but not in the update body's field set, whose boolean toggles are exactly:

```text
allow_auto_merge, allow_forking, allow_merge_commit, allow_rebase_merge,
allow_squash_merge, allow_update_branch, archived, delete_branch_on_merge,
has_issues, has_projects, has_wiki, is_template, private,
use_squash_pr_title_as_default, web_commit_signoff_required
```

`@effected/github` routes two fields to GraphQL — `has_sponsorships` and `has_pull_requests` — and `has_discussions` is not among them. So it goes into the REST patch, GitHub ignores the unrecognised key, the request succeeds, and **the run reports it as applied**.

That is the same failure shape as a misspelled settings field, and for the same reason: GitHub accepts unknown keys silently. The difference is that a typo is the user's mistake and this one is ours — we type the field, so the schema tells the user it is supported.

GraphQL's `updateRepository` does have `hasDiscussionsEnabled`, so the fix is upstream: add it to `GRAPHQL_ONLY_SETTINGS` in `@effected/github`. Filed as **spencerbeggs/effected#358**, which also asks for the more general thing — a field that is neither REST-accepted nor GraphQL-routed currently takes the REST path by default, and that default is what makes this class of bug invisible.

Until it lands, the honest options are to drop the field from `SettingsGroupSchema` or to document it as unsupported. It has been in our schema since the v3 line, so anyone who set it has been told it applied on every run since.

**Not yet verified live.** The reasoning is from the API types and the package source; a real sync setting `has_discussions` on a repository with discussions disabled, followed by reading the repository back, would settle it. That is the check this file is least confident without.

## PATCH fields we deliberately do not type

| Field | Why not |
| :--- | :--- |
| `name` | renaming a repository from a config file is a destructive operation with no undo, and the config identifies repositories *by* name |
| `description`, `homepage` | plausible additions; see proposals |
| `private`, `visibility` | changing visibility can delete forks and break links. A config that can silently publish a private repository is a different risk class from one that toggles a merge button |
| `archived` | archiving makes every other phase fail; ordering it correctly against the rest of a sync is a design problem, not a field |
| `default_branch` | GitHub does not move commits — setting this on a branch that does not exist errors, and on one that does it changes what every ruleset targeting `default` applies to |
| `use_squash_pr_title_as_default` | deprecated by GitHub in favour of `squash_merge_commit_title`, which we do set |

The first five are all "possible, but the blast radius exceeds what a declarative sync should do without a confirmation step". Worth revisiting only alongside something like a `--allow-destructive` flag.

## Subsystems we do not touch

Each of these is a repository-level setting a declarative tool could reasonably own. Verified present in the API; none is implemented.

| Subsystem | Endpoint | Note |
| :--- | :--- | :--- |
| **Topics** | `repos/replace-all-topics` | a whole-list PUT, so it is naturally declarative — the closest thing to free. Upstream support requested in **effected#359** |
| **Actions default token permissions** | `actions/set-github-actions-default-workflow-permissions-repository` | read-vs-write default for `GITHUB_TOKEN`, and whether PRs can be approved by Actions. A security control, arguably the highest-value gap here |
| **Actions permissions** | `actions/set-github-actions-permissions-repository`, `actions/set-allowed-actions-repository` | whether Actions runs at all, and which actions are allowed |
| **Fork PR policy** | `actions/set-fork-pr-contributor-approval-permissions-repository`, `actions/set-private-repo-fork-pr-workflows-settings-repository` | who can run workflows from forks |
| **Retention** | `actions/set-artifact-and-log-retention-settings-repository`, `actions/set-actions-cache-retention-limit-for-repository` | artifact/log days, cache size |
| **OIDC subject claim** | `actions/set-custom-oidc-sub-claim-for-repo` | matters for anyone federating cloud credentials |
| **Labels** | `issues/create-label`, `update-label`, `delete-label` | per-item, so it needs the same three-way cleanup model as secrets |
| **Autolinks** | `repos/create-autolink`, `delete-autolink` | per-item, no update endpoint — changing one is delete-then-create |
| **Webhooks** | `repos/create-webhook`, `update-webhook`, `delete-webhook` | carries a secret, so it belongs to the credential model |
| **Deploy keys** | `repos/create-deploy-key`, `delete-deploy-key` | keys are write-only after creation, like secrets |
| **Collaborators** | `repos/add-collaborator`, `remove-collaborator` | access control; the blast radius argument applies |
| **Pages** | `repos/create-pages-site`, `update-information-about-pages-site` | source branch/path, custom domain, HTTPS enforcement |
| **Custom properties** | `repos/custom-properties-for-repos-create-or-update-repository-values` | org-defined key/values; a natural fit for group-level defaults |
| **Immutable releases** | `repos/enable-immutable-releases`, `disable-immutable-releases` | a boolean toggle in the shape `security` already uses |

## Proposed shapes

Sketches, not decisions. Each follows an existing pattern in the config so it costs no new concept.

### Topics — a settings-style group

Whole-list replacement matches `replace-all-topics` exactly, and a group can compose them the way settings groups do. **GitHub lowercases every name**, so the applied-state baseline must be recorded from the response rather than the request or every run after the first reports drift:

```toml
[topics.oss]
topics = ["effect", "typescript", "github"]

[groups.mine]
topics = ["oss"]
```

Later groups win, as everywhere else. Cleanup is implicit: the endpoint replaces the whole list, so an omitted topic is removed — which means this needs the same "an enabled scope with nothing declared deletes everything" warning that `cleanup` carries.

### Actions policy — a new phase beside `security`

The Actions controls are several endpoints but one concept, and they read like `security` does:

```toml
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

This is the proposal worth taking most seriously: `default_workflow_permissions = "read"` is a meaningful supply-chain control, it is per-repository, and nothing else in the tool sets it.

### Labels — a per-item group with cleanup

Labels need identity and deletion, so they follow `secrets` rather than `settings`:

```toml
[labels.standard.value]
bug = { color = "d73a4a", description = "Something is broken" }
enhancement = { color = "a2eeef" }

[groups.mine]
labels = ["standard"]

[groups.mine.cleanup]
labels = { preserve = ["wontfix"] }
```

The three-way `CleanupScope` union already models exactly this.

### Description and homepage — plain settings fields

The only reason these are not already supported is that nobody asked:

```toml
[settings.oss]
description = "Sync GitHub repository settings from a TOML file"
homepage = "https://github.com/spencerbeggs/reposets"
```

Both are ordinary `PATCH /repos` fields. The one caveat is that a shared settings group would give every repository in it the same description, which is almost never wanted — so these probably belong per-repository, which the config has no shape for today. That is the actual open question, not the fields.

## What each proposal needs upstream

`@effected/github@0.4.0` exposes 28 modules:

```text
ArtifactMetadata Attestation CheckRun CodeScanning DeploymentEnvironment
GitBranch GitCommit GitHubApp GitHubClient GitHubCommit GitHubContent
GitHubError GitHubIssue GitHubRelease GitHubRepository GitTag GraphQL
PullRequest PullRequestComment Repo RepositorySecret RepositorySecurity
RepositoryVariable Resilience Rest Ruleset TokenPermissions WorkflowDispatch
```

None of the proposed subsystems is covered. The only label route in the package is `/repos/{owner}/{repo}/issues/{issue_number}/labels` — applying labels to an issue, not managing a repository's set.

| Proposal | Upstream need | Filed |
| :--- | :--- | :--- |
| `description`, `homepage` | **none** — ordinary `PATCH /repos` fields `applySettings` already routes | — |
| Topics | two members on `GitHubRepository` | **effected#359** |
| `has_discussions` | one entry in `GRAPHQL_ONLY_SETTINGS` | **effected#358** |
| Actions policy | a new service; several endpoints, one concept | not filed |
| Labels | a new service | not filed |
| Autolinks, webhooks, deploy keys, Pages, custom properties | a new service each | not filed |

**The unfiled ones are unfiled on purpose.** Requesting surface we may not use is how a kit accumulates code nobody exercises, and this project's own evidence is that unexercised surface is where silent defects live — the security phase had no tests because its service was never wired into the harness, and `has_discussions` shipped inert for the whole v3 line. Ask for a capability when something is about to drive it against real repositories.

Topics is the exception because its endpoint is *already* declarative: `PUT` replaces the whole set, which is the shape a config file describes. Every other candidate is per-item create/update/delete and needs a three-way reconcile before it is worth anything.

## The shape of the gap

Everything reposets manages today is either a repository *toggle* or a *collection of named resources*. Both patterns are established and the phases are data, so adding a phase is cheap.

What the config has no shape for is a **per-repository value** — a description, a homepage, a custom property — because a group applies the same resources to every repository in it. Several proposals above hit that wall independently, which suggests it is the next structural decision rather than a per-feature one.
