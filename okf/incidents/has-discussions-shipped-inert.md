---
title: has_discussions shipped inert since v3
description: SettingsGroupSchema typed has_discussions but PATCH /repos never accepted it, so every run reported it applied while the repository never changed.
type: Incident
status: draft
occurred: 2026-08-14
tags: [github, testing]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: b077a97357a6047f6f2b698020aa1cc927beef3e504282ba662d7b6d6c25dafe
sources:
  - id: config-schema
    resource: ../../package/src/schemas/config.ts
  - id: github-repository
    resource: ../../package/node_modules/@effected/github/GitHubRepository.js
  - id: package-json
    resource: ../../package/node_modules/@effected/github/package.json
  - id: effected-358
    resource: https://github.com/spencerbeggs/effected/issues/358
---

# `has_discussions` shipped inert since v3

## What shipped broken

`SettingsGroupSchema` has typed `has_discussions` as an optional boolean since the v3 line[^config-schema], but `PATCH /repos/{owner}/{repo}` — the endpoint every other settings field rides on — does not accept it. Its update body's boolean toggles are exactly `allow_auto_merge, allow_forking, allow_merge_commit, allow_rebase_merge, allow_squash_merge, allow_update_branch, archived, delete_branch_on_merge, has_issues, has_projects, has_wiki, is_template, private, use_squash_pr_title_as_default, web_commit_signoff_required` — `has_discussions` is not among them. GitHub does return the field on the repository *response* object and accepts it on repository *creation*, which is what made the omission from the update body easy to miss. `@effected/github` routed exactly two fields to the GraphQL `updateRepository` mutation instead of REST — `has_sponsorships` and `has_pull_requests` — and `has_discussions` was not one of them, so it took the REST path by default.

## What it looked like to the consumer

A `has_discussions` value set on a `[settings.*]` group reached the REST PATCH as an unrecognized key. GitHub ignores unknown body fields and answers `200`, so the request succeeded, `applySettings` reported the field as applied, and the repository's discussions setting never actually changed. There was no error, no warning, and no difference in the sync's reported outcome between a config that set `has_discussions` and one that never touched it — a setting that silently never took effect, with every run confirming it had.

## Root cause

A field that is neither accepted by the REST PATCH nor routed to GraphQL takes the REST path by default in the code as it existed, and that default is what made the whole class of bug invisible rather than merely this one field's bug: nothing failed loudly, because REST's own contract is to accept and ignore unknown keys rather than reject them.

## Resolution

Filed as `spencerbeggs/effected#358`, "`has_discussions` is routed to REST, which does not accept it," closed 2026-08-15[^effected-358]. The installed `@effected/github` (`package/node_modules/@effected/github/package.json`, version `0.10.1`[^package-json]) now carries `has_discussions: "hasDiscussionsEnabled"` in its `GRAPHQL_ONLY_SETTINGS` map alongside `has_sponsorships` and `has_pull_requests`[^github-repository]. That map's own docstring calls `has_discussions` "the treacherous one" precisely because the REST *read* returns it, which makes routing its *write* to the same PATCH look symmetric when it silently is not, and names this incident by issue number[^github-repository].

No test in this repository ever exercised the live behavior before the fix landed: the original finding was reasoned entirely from `@octokit/openapi-types`' request-body field set and `@effected/github`'s source, never confirmed against a real sync setting `has_discussions` on a repository and reading it back. The gap is closed by the routing fix itself rather than by a guard in this repository — there is no local test pinning `has_discussions` specifically, because the field's correctness now depends on `@effected/github` continuing to route it to GraphQL, which is upstream's contract to keep. See [unknown settings fields report as applied](../gotchas/unknown-settings-fields-report-as-applied.md) for the general shape of this failure — a REST PATCH accepting and silently discarding a field it does not recognize.

[^config-schema]: `package/src/schemas/config.ts`
[^github-repository]: `package/node_modules/@effected/github/GitHubRepository.js`
[^package-json]: `package/node_modules/@effected/github/package.json`
[^effected-358]: `https://github.com/spencerbeggs/effected/issues/358`
