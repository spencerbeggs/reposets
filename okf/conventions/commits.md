---
type: Convention
title: Commits
description: Conventional commit format, DCO signoff, and the changeset expectation on a pull request.
stale_after: 2027-03-16T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 9eeb3de75d416430be916f620aa38f819296e3ec985a6a5ad0e78fe8f9924bb0
tags: [release, ci]
---

# Commits

Write every commit message in Conventional Commit format, enforced locally
by commitlint through `@savvy-web/silk/commitlint`'s `CommitlintConfig.silk()`
(`lib/configs/commitlint.config.ts`). The allowed types are `build`, `chore`,
`ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `release`, `revert`, `style`,
`test`.

Every commit needs a DCO signoff line, `Signed-off-by: Name <email>`. This is
checked on every pull request against `main` by the `DCO` workflow
(`.github/workflows/dco.yml`), which runs `cpanato/dco-check-action` and
fails the check when a commit in the PR is missing the trailer.

A user-facing change is expected to carry a changeset under `.changeset/`
before it merges. Nothing in this repository's Git hooks blocks a commit
over a missing changeset — that judgment belongs to a human reviewing the
pull request, not to an automated gate a commit can trip.
