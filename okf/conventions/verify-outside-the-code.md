---
type: Convention
title: Verify outside the code
description: Before closing a finding about something reposets writes, check the result somewhere the code under test cannot reach.
stale_after: 2027-03-16T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: b848e098b10dab25253b67df4120ae16f0f1482b4dcba7a207f06c65408addfa
tags: [testing, dx]
---

# Verify outside the code

Before closing a finding about something reposets writes, run the built CLI
and check the result somewhere the code under test cannot reach: GitHub's
API directly, the built artifact on disk, a consumer import of the published
package, a control repository nothing else touches, or a runner actually
decrypting a secret reposets sealed. The worst defects found in this
codebase's own history were the ones that looked green: an exported module
no consumer could actually reach, a route census built so it could never
fail, a test asserting a request GitHub itself rejects, a precondition
satisfied only by the tool's own prior writes rather than by GitHub's
independent state, and a dry-run change count that hid four fifths of its
own list — and every one of them passed its own test suite. A test that only
re-checks the assumptions its own implementation made cannot catch the
implementation being wrong about those assumptions; only an observation from
outside that boundary can.

A few corollaries follow from the same principle:

- When an observation contradicts a tool's output, suspect the reading
  before the tool. One controlled run — reproduce the exact command against
  the exact state — settles which one is wrong faster than arguing from
  memory of what the tool "should" have done.
- Verify a build actually ran by its content, not by its file's modification
  time. A build that failed partway through can still touch `mtime` on
  files it never finished writing.
- When a dry run or a summary reports a count, compare that count against
  the full list it is summarizing, not just against expectations. A count
  that is technically correct can still describe a list four-fifths
  suppressed.
- Treat a resource that has gone quiet — stopped producing new log lines,
  stopped changing between runs — as suspect rather than as settled. Quiet
  is also what "broken and no longer trying" looks like.
- Keep at least one control fixture in the sandbox environment that a
  campaign run is not supposed to touch; see
  [sandbox-campaign](../runbooks/sandbox-campaign.md). A control that starts
  changing is itself a finding.
- Never run `vitest` inside a sibling checkout of `effected` while this
  repository's own suite might also be running: the two share coverage
  output directories, and a build killed mid-write in one leaves a stale
  `dist` the other can silently pick up.
