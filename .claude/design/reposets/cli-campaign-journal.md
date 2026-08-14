---
module: reposets
title: CLI campaign journal
category: testing
status: current
completeness: 100
created: 2026-08-13
updated: 2026-08-14
last-synced: 2026-08-14
related:
  - cli.md
  - config-format.md
  - sandbox.md
  - session-handoff.md
dependencies: []
---

## What this is

**Closed.** This is the finished record of the campaign that took the CLI to 1.0.0 — ten passes, 28 numbered findings, all but one closed. It is a historical log rather than a description of the system: nothing here is authoritative about how reposets works today, and where it disagrees with `architecture.md`, `services.md`, `cli.md` or `config-format.md`, they win. Its value is the evidence behind decisions those docs assert, and the record of what a green test suite failed to catch. Read it when you need to know *why*, not *what*.

A running log of driving the CLI by hand against the `reposets-sandbox` scratch repos, starting from `init` on a machine with no config at all. One entry per finding: what was done, what happened, what was expected, and whether it is a **bug**, a **papercut**, or a **doc lie**.

It exists because the unit suite passes against fixtures, and this session has
already produced two cases where a green fixture suite hid something a consumer
would hit immediately — an exported module no consumer could reach, and a route
census that could not fail. Driving the binary is the only check that does not
share the code's assumptions.

Fix inline only what blocks the next step; everything else lands here, or the
campaign turns into a refactor and stops finding things.

## Scope

Three repositories in the `reposets-sandbox` org: `sandbox-alpha`, `sandbox-beta`,
`sandbox-gamma`. `spencerbeggs/reposets-scratch` is deliberately excluded — see
finding 3.

## Findings

### 1. `cli.md` lists flags `credentials create` does not have — **doc lie**

The design doc says `create --profile [--github-token] [--op-token]`. The real
flags are `--profile`, `--op`, `--env`. I wrote that line during the docs pass
from the old command tree and never checked it against the source, in the same
pass where I corrected two other stale claims.

Found before running a single command.

### 2. `init` scaffolds a config that fails `validate` — **bug, fixed inline**

The first two commands a new user runs, in order:

~~~text
$ reposets init --project
Created: …/reposets.config.toml
Created: …/reposets.credentials.toml

$ reposets validate
ConfigValidationError: Config validation failed
  Missing key at groups
~~~

Both scaffolded templates are **entirely commented out**, so the config decodes
as an empty document — and `groups` was the one top-level section without a
decoding default. Every sibling had one:

~~~text
settings ✓  secrets ✓  variables ✓  rulesets ✓
environments ✓  security ✓  code_scanning ✓  groups ✗
~~~

That made it an inconsistency rather than a decision: a config with no groups is
no less valid than one with no settings, and both mean "nothing to do here yet".

**Fixed** by giving `groups` the same `withDecodingDefaultKey(Effect.succeed({}))`.
The JSON-schema generator classified the regeneration as a `contract` change,
which is correct — `required` shrank.

Worth noting how it survived: nothing tested that `init`'s output satisfies the
schema. The templates are string constants and the schema is a separate module,
so no test ever put one through the other.

### 3. One credential profile per run blocks a four-repo campaign — **known limitation**

`sync.ts` refuses more than one profile:

~~~text
`${names.length} credential profiles found; reposets cannot yet choose between them.`
~~~

The two tokens have disjoint reach — `ORG_TOKEN` covers the `reposets-sandbox`
org, `PERSONAL_TOKEN` only `spencerbeggs/reposets-scratch` — so all four
repositories cannot be driven from one config. A group's
`credentials = "profile"` selects that profile's `[resolve]` values but **not**
its token.

Ported deliberately from v3 and flagged at the time. It scopes this campaign to
the three org repositories rather than four.

### 5. `doctor` never checks the token it tells you about — **gap, worth closing**

It reports the reference and that `OP_SERVICE_ACCOUNT_TOKEN` is set, then prints
the nine permissions a full sync needs. It never **resolves** the reference and
never asks GitHub anything. So all of these pass `doctor` and fail at the first
write:

- a revoked or expired token
- a typo in the `op://` path (the item simply is not there)
- a token missing `Administration`, or scoped to the wrong repositories

That is the opposite of what a doctor command is for — it is the one command
whose entire job is "will the real thing work". `@effected/github` ships
`TokenPermissions`, so this is a wiring job rather than new capability.

### 6. `validate` does not say the config is valid — **papercut**

On success it prints:

~~~text
sources found: 1
owner: (not set)
~~~

Nothing states the outcome. A user reasonably reads "owner: (not set)" as a
complaint and cannot tell whether the command passed.

### 4. "Run 'reposets doctor' for suggested spellings" on a missing key — **papercut**

The hint is right for an unknown key and wrong for a missing one; there is no
spelling to suggest. Minor, but it points a confused user at a command that will
not help them.

## Wave 1 — cold start: complete

`init --project` → `validate` → `credentials create --op …` → `credentials list`
→ `doctor`, on a machine with no config anywhere.

Worked after fixing finding 2. What behaved correctly and is worth not
regressing:

- **`credentials create` wrote to the project-local file** `init` had just
  created, rather than defaulting to XDG. A split-brain there — two credentials
  files, the user editing the one the CLI does not read — was the specific risk
  and it is not present.
- **`credentials list` prints the reference, never a value.** There is a test
  asserting `doctor` never prints a secret; `list` is a different command and is
  not covered by it, so this was checked by hand.
- **`init`'s closing hint uses the real flags** (`--op`), unlike the design doc
  in finding 1.

## Wave 2 — settings, one repository

### 7. The org-only gate models one dimension of a two-dimensional rule — **bug**

`ORG_ONLY_SETTINGS` holds `allow_forking`, and the settings phase strips it when
`ownerType` is `User`. The owner here **is** an organization, so it passed the
gate and GitHub refused it:

~~~text
error   settings: PATCH /repos/{owner}/{repo} failed (422): Allow forks setting
can only be changed on org-owned private repositories
~~~

The real constraint is org-owned **and private**. Our gate checks the first half
and calls it done, so every public repository in an org-owned group fails the
moment anyone sets `allow_forking`.

`GitHubRepository.settings` returns `private`, so the information is one read
away — but the settings phase does not currently read the repository, so closing
this properly means deciding whether that read is worth it per repository or
whether the field simply belongs in a "conditional" list with a clearer error.

### 8. One rejected field discards every other setting in the group — **design limit**

The 422 above cost the *whole* PATCH: `has_issues`, `has_wiki`,
`delete_branch_on_merge` and the `security_and_analysis` block were all in that
request and none of them applied. GitHub's endpoint is atomic, so this is its
behaviour rather than ours — but the consequence is that **one unsupported field
silently costs a repository its entire settings sync**, and the error names only
the field GitHub complained about.

Options, none free: split the PATCH per field (many more requests), pre-filter
known-conditional fields against the repository's own state (one read), or leave
it and make the error say what else was lost.

### What went right, and is the point of the campaign

**The error was diagnosable on the first try.** Route, status, GitHub's own
sentence, and the documentation link — reported per repository, with the run
continuing. An earlier version of this code collapsed a 403, a 404 and a network
failure alike into `could not read current state`; this is what the `read`/
`capture` rework bought, seen for the first time against a real API.

### 9. `would apply settings` does not say what it would apply — **papercut**

The variables phase names each variable and cleanup names every deletion, but
the settings dry run prints one line for the whole group. A user reviewing
before applying cannot tell whether `merge_commit_title` was dropped by the
dependent-key rule or whether an org-only field survived the gate — which is
exactly what someone checks a dry run for.

### Wave 2 verified against the live repository

Read back through the API rather than trusted from the CLI's own report, because
the CLI cannot tell you what it decided *not* to send:

| Behaviour | Evidence |
| :--- | :--- |
| plain pass-through | `has_issues=true`, `has_wiki=false`, `delete_branch_on_merge=true`, `allow_merge_commit=false` |
| **dependent-key drop** | `merge_commit_title` is `MERGE_MESSAGE` — GitHub's value, **not** the `PR_TITLE` the config asked for |
| **`security_and_analysis` fold** | bare `"enabled"` in TOML arrived as `{ status: "enabled" }` |

The drop is the one worth stating plainly: had the title been sent alongside
`allow_merge_commit = false`, GitHub would have answered 422 exactly as it did
for `allow_forking`. It did not, because the rule dropped it. Until now that path
had fixture coverage only.

## Wave 3 — fan out to three repositories

Ran the wave-2 settings group against all three. The discriminating outcome, and
it is the right one:

~~~text
sandbox-alpha            (silent)
sandbox-beta   applied settings
sandbox-gamma  applied settings
3 repo(s), 2 change(s)
~~~

`alpha` was already in the desired state and reported nothing, so the
applied-state baseline is keyed per repository and consulted per repository. Two
changes, not three. The failure this was watching for — a baseline recorded under
the wrong slug, so `beta` compares against `alpha`'s fingerprint — is not
present.

## Wave 4 — secrets, variables, environments, rulesets

First live run of four phases. Twelve writes across three repositories, all
accepted, all verified by reading the API back:

~~~text
secret:      CAMPAIGN_MARKER
variable:    CAMPAIGN_VAR=wave-4
environment: staging
ruleset:     protect-default [Repository] enforcement=active
~~~

Two things worth recording.

**Phase order held under a real dependency.** `environments` ran before `secrets`
and `variables` on every repository, with an environment that did not yet exist.
That ordering is documented as load-bearing and had never been exercised against
an API that would actually reject an environment-scoped write to a missing
environment.

**The secret's value never appeared in output.** Named with its scope
(`secret CAMPAIGN_MARKER (actions)`) and nothing more, on both the dry run and
the real one.

### 10. Sealed-box correctness cannot be verified from outside — **known limit**

GitHub never returns a secret's value, and it accepts the sealed box on
structural grounds. So this campaign proves we sent something GitHub **accepted**
— not that it decrypts to the intended plaintext. A box encrypted against the
wrong key, or with the nonce inputs concatenated in the wrong order, would be
accepted identically and fail only when a workflow reads it.

The round-trip test in `@effected/github` (`crypto.test.ts`) opens the box with
`nacl.box.open` and is the only proof of correctness that exists. Closing this
end-to-end would mean committing a workflow to a scratch repository that echoes
a marker derived from the secret — worth doing once, not per run.

## Wave 5 — cleanup, drift, history

**Cleanup, scoped to variables**, with one genuinely undeclared resource
(`KEEP_ME`, left on `alpha` by an earlier migration test):

~~~text
sandbox-alpha  deleted 1 variable (KEEP_ME)
sandbox-beta   (silent)
sandbox-gamma  (silent)
~~~

One repository, one variable, named before deletion. `CAMPAIGN_VAR` — declared,
and written by this same run minutes earlier — was untouched on all three, which
is the check that `declaredNames` agrees with what the variables phase actually
wrote. A mismatch there would delete the config's own resources.

**Drift** across all three came back clean, exit 0.

**`history`** — the last command never run — rendered every run of the campaign,
and recorded the wave-2 failure as `partial` rather than `success`, with 0
changes, without being asked to distinguish them.

### The timings are an unplanned cache measurement

~~~text
22:30  dry-run    1 change     8ms      ← everything cached, zero API calls
22:33  applied   12 changes   4.3s
22:02  dry-run    0 changes   11.7s     ← cold: no cache, 1Password resolution
~~~

An 8ms dry run is only possible if the run made no network calls at all: owner
type served from `RepoCache`, fingerprints compared locally. The cold runs at
~12s are the same work with an empty cache and a 1Password round trip. Nothing
asked for this measurement; it fell out of `history` recording durations.

### 11. `history` shows counts, never *what* changed — **gap**

Every run is a row with a change count. The journal stores per-resource
`ChangeRecord`s — repo, kind, name, action — and nothing surfaces them. After a
run that reports `12 changes`, there is no way to ask which twelve without
re-reading the SQLite file by hand. A `history <run-id>` or `--verbose` would
make the record useful rather than merely present.

## Campaign summary

Five waves, from `init` on a machine with no config to a three-repository group
carrying settings, a secret, a variable, an environment and a ruleset — then
cleaning one resource up and confirming no drift.

**Eleven findings: one bug fixed inline, two bugs open, one design limit, five
papercuts, two known limits.** Every phase has now run against real GitHub except
`security` and `code-scanning`.

The single most valuable output was not a bug but a confirmation: the wave-2 422
arrived with its route, status, GitHub's own sentence and a documentation link,
scoped to one repository, with the run continuing. That is the failure path
working exactly as designed, seen for the first time against an API that could
actually refuse us.

### Not yet exercised

- `security` and `code_scanning` phases
- `--group`, `--repo`, `--skip` filters
- `credentials delete`
- environment-scoped secrets and variables
- `--fail-on-drift` as a non-zero gate (drift has only ever been clean here)

## Wave 6 — security and code scanning

### What worked

**The security phase diffs before it toggles.** The config set all three toggles
to `true`; the dry run reported only two. `vulnerability_alerts` was already
enabled, so the probe read it and skipped a no-op rather than issuing a
redundant PUT. Six writes across three repositories, all applied.

**The code-scanning language filter fired and explained itself:**

~~~text
skip    code_scanning language javascript-typescript (not detected in repository)
~~~

That is what finding 9 looks like when it is done right — the phase names the
resource, the action and the reason. The settings phase prints `applied settings`
for a whole group.

**`--only` accepts a repeated flag.** `--only security --only code-scanning` ran
exactly those two.

### 12. `actions` is exempted from the language filter and GitHub validates it anyway — **bug**

The filter removed `javascript-typescript` correctly, leaving `["actions"]`, and
GitHub refused that too:

~~~text
error   code_scanning default setup: PATCH …/code-scanning/default-setup failed
(422): One or more languages you selected are not present in the repository.
~~~

The source comment asserts:

> The `actions` pseudo-language always passes through because it is not a repo
> language.

The first half is true and the conclusion does not follow. Probed: these
repositories have **zero workflows** and a single `README.md`. `actions` **is** a
real CodeQL language that GitHub validates — against workflow files, not against
linguist. `listRepoLanguages` cannot see it, which is why it is exempt from our
filter, and the exemption quietly turns *"we cannot check this"* into *"this
needs no check"*.

Closing it means a second read (`GET /repos/{o}/{r}/actions/workflows`, whose
`total_count` is the thing to test) or accepting that one configured language is
unverifiable and saying so in the error.

### The three open bugs are one bug with three faces

| Finding | What we model | What GitHub actually requires |
| :--- | :--- | :--- |
| 7 `allow_forking` | org-owned | org-owned **and private** |
| 12 `actions` language | unfilterable, therefore exempt | validated against workflow files |
| 5 `doctor` permissions | listed for the user to read | never checked against the token |

Each is an approximation of a GitHub rule that holds until it does not, and in
every case the gap surfaces as a 422 at write time — after other work in the same
request has already been discarded (finding 8).

That is an argument for one deliberate fix rather than three patches: **the phases
should ask GitHub what is true before writing, wherever a rule has a
precondition we cannot see from the config alone.** Deferring the fixes until
after this wave is what made the family visible; fixing finding 7 in isolation
would have produced a narrow `private` check and taught nothing.

### The merge-contradiction guard works, and it is the template for the fix

Two security groups, neither invalid alone, referenced in an order that merges to
`automated_security_fixes = true` with `vulnerability_alerts = false` — a state a
single group's schema rejects and merging can recreate. `validate` passed,
correctly, because neither group is individually wrong.

~~~text
error   security merge: automated_security_fixes = true requires
        vulnerability_alerts to be enabled (or omitted); skipping security sync
3 repo(s), 0 change(s), 0 drifted, 3 error(s)
~~~

It named both fields, stated the rule, said what it did about it, and issued
**zero requests** — per repository, run continuing.

This is the counter-example to findings 5, 7 and 12: the codebase already knows
how to check a GitHub precondition *before* writing, and does it here. Those
three are not a missing capability, they are places that do not follow this
phase's example.

### Filters

`--repo sandbox-beta` processed one repository and reported `1 repo(s)`.

`--skip` over five phases ran clean, but the result is **not discriminating**:
security was already in its desired state and cleanup had nothing undeclared, so
"skipped" and "ran and found nothing" are indistinguishable from the output. The
filter is exercised; its correctness is not established.

### 13. The header repo count and the summary repo count disagree — **papercut**

~~~text
group: sandbox (3 repos)      ← the group's declared size
  repo: reposets-sandbox/sandbox-beta
1 repo(s), …                  ← what the run actually touched
~~~

Both true, and a reader scanning a filtered run sees 3 and 1 for the same
operation.

### `--fail-on-drift` gates, verified against real drift

`CAMPAIGN_VAR` was edited on `sandbox-gamma` **through the API, bypassing
reposets**, then:

~~~text
sandbox-alpha  (silent)
sandbox-beta   (silent)
sandbox-gamma  drift   variable CAMPAIGN_VAR changed outside reposets — would overwrite
3 repo(s), 1 change(s), 1 drifted
exit: 1
~~~

Per-repository detection, and the first time the non-zero path has ever run —
every earlier drift check in this campaign was clean, so the gate had never
actually gated. The failure worth catching was "reports drift, exits 0", which
would be useless in CI while looking correct.

Converging then flipped the verb from `would overwrite` to `overwritten`, the
value returned to `wave-4`, and the next drift check was clean at exit 0. The
policy is report-and-converge, and it does both.

## Campaign summary, waves 1-6

**Thirteen findings: one bug fixed inline, three bugs open, one design limit, six
papercuts, two known limits.** Every phase has now run against real GitHub.

The three open bugs are one family — a GitHub precondition we model approximately
and discover as a 422 at write time — and the security phase's merge guard is the
working template for fixing them.

### Still unexercised

- `credentials delete`
- environment-scoped secrets and variables (only repository-scoped so far)
- `--only` versus `--skip` precedence, which is documented but untested
- whether `--skip` genuinely skips, as opposed to running a phase with nothing to do

## The fix: preconditions are checked before writing

Findings 5, 7 and 12 were one bug with three faces — a GitHub rule modelled
approximately and discovered as a 422 at write time. The security phase's merge
guard was already the working template. The others now follow it.

**The principle: check a precondition only when the config uses the field that
has one.** Cost is proportional to usage and zero otherwise; no blanket extra
read per repository.

| Field | Precondition | Read, when configured |
| :--- | :--- | :--- |
| `allow_forking` | org-owned **and private** | repository `private` flag, cached |
| `actions` language | workflow files exist | workflow `total_count`, cached |

Both are cached per repository under the same TTL as languages, and a config
that mentions neither field issues neither request — pinned by a test asserting
`GET …/actions/workflows` is *not* called when `actions` is unconfigured.

### A fourth instance, found by writing the test

Filtering every configured language out left the phase still sending
`state: configured` with an **empty** language list — a request GitHub refuses
with the same 422 the filtering exists to avoid, arrived at from the other
direction. An existing test asserted that PATCH still went, so the suite was
pinning the bug. It now asserts the phase sends nothing and says why.

### Verified against the repositories that produced the failures

The identical config that produced **four errors on each of three repositories**
now produces none:

~~~text
would skip  setting allow_forking (org-owned private repositories only; this one is public)
would skip  code_scanning language actions (no workflow files)
would skip  code_scanning language javascript-typescript (not detected in repository)
would skip  code_scanning default-setup (no configured language is present in this repository)
3 repo(s), 0 change(s), 0 drifted, 0 error(s)
~~~

And the sharper proof, for finding 8: with `has_issues` genuinely needing a
change *alongside* the unsettable `allow_forking`, all three repositories
reported `skip … / applied settings` and the API confirms `has_issues=false` on
each, with `allow_forking` untouched. Before the fix that combination cost every
repository its entire settings sync.

### Finding 5 was overstated, and is narrowed

`doctor` cannot enumerate a fine-grained PAT's permissions: `TokenPermissions`
takes a permissions record rather than fetching one, because GitHub only reports
permissions for **App installation tokens**. What `doctor` can check is that the
reference resolves and the token authenticates, which covers the revoked-token
and typo'd-path cases. Recorded as narrowed rather than closed.

### 14. `@effected/github` cannot list workflows — **upstream gap**

The workflow count is read through `GitHubClient` directly, because the package
has no member for `GET /repos/{owner}/{repo}/actions/workflows`. That is the
consumer-side stand-in, not the final home; filed upstream.

## Output legibility

- `group: sandbox (1 of 3 repos)` when a filter narrows the run, so the header
  and the summary no longer disagree (finding 13). The noun agrees with the
  number nearest it — a test caught `1 of 3 repo` immediately.
- `validate` states the outcome first: `Valid: <path>`, then owner and group
  count, rather than opening with `sources found: 1` (finding 6).
- The "suggested spellings" hint appears only when something was actually
  misspelled (finding 4).

## Second fix pass

**Finding 5 (narrowed) — `doctor` now makes one live check per profile.**
Resolve the `github_token` reference, then `GET /user` with it. Verified both
ways: a working profile reports `resolved, authenticates as spencerbeggs`, and a
deliberately broken reference reports

~~~text
Token [broken]: could not resolve — ResolveError: Failed to resolve
op://…/does-not-exist/NOPE: no section matched the secret reference
~~~

The permissions list now states in the output that it is **not** verified, since
GitHub exposes a permission set for App installation tokens only.

**Finding 9 — the settings summary names its fields.** `applied settings` became
`applied settings (allow_merge_commit, has_issues, has_wiki)`, sorted, with a
count-plus-head form beyond six. Reading a dry run is how you check whether a
conditional field survived its gate, which the old line could never show.

**Finding 1 — `cli.md` corrected.** `credentials create` takes
`--profile (--op <ref> | --env <var>)`, not the `--github-token` / `--op-token`
the doc claimed.

**Finding 4, 6, 13** — fixed in the first pass.

### `credentials delete` exercised

Removing the deliberately broken profile ran the last command in the CLI that
had never been executed. Every command is now covered.

## Status

| Finding | State |
| :--- | :--- |
| 1 doc lie, `credentials create` flags | fixed |
| 2 `init` scaffold fails `validate` | fixed |
| 3 one credential profile per run | open, needs per-group tokens |
| 4 spelling hint on a missing key | fixed |
| 5 `doctor` never checks the token | fixed as narrowed; scopes remain unverifiable |
| 6 `validate` never says it passed | fixed |
| 7 `allow_forking` gate | fixed |
| 8 one rejected field discards the group | mitigated — preconditions now filter before sending |
| 9 settings summary named nothing | fixed |
| 10 sealed-box correctness unverifiable externally | open, needs a workflow |
| 11 `history` shows counts, not changes | open |
| 12 `actions` language exempt from validation | fixed |
| 13 header and summary repo counts disagreed | fixed |
| 14 no workflow listing in `@effected/github` | open, filed upstream |

Nine fixed, one mitigated, four open — three of which need either a feature
(per-group tokens), a workflow (sealed-box proof), or an upstream member.

## Third pass: history detail, local teardown, and the service-account reference

**Finding 11 closed — `history show <run>`.** The change records were always
stored and nothing surfaced them. It takes a unique id **prefix**, groups the
output by repository, and **refuses an ambiguous prefix** rather than picking
one: showing the wrong run's changes is worse than asking for another character.

**`history prune --keep N` and `history clear` are journal-only, deliberately.**
The same database holds the drift baselines, and deleting those does not tidy
anything — it disarms the check, so the next run reports a first sync where an
out-of-band edit actually happened. Both commands say in their output that
applied state and the cache are untouched.

**`reposets nuke` is the "leave no trace" command**, and it is separate for that
reason. It walks the config resolver's own chain, lists **only paths that exist**
— a prompt that overstates is one people learn to skim — and names what each
deletion costs, including the one irreversible consequence:

~~~text
/Users/…/.local/state/reposets/store.db
  state database — loses run history AND the drift baselines —
  drift detection restarts from nothing
~~~

Two safety properties, both verified:

- **It refuses a non-interactive shell** without `--force`, exit 1. Prompting on
  a pipe either hangs or reads whatever happens to be on stdin; a destructive
  command that proceeds because nobody was there to answer is the failure worth
  engineering against.
- **Nothing on GitHub is touched**, said in the output, because "nuke" invites
  exactly the wrong assumption.

### The 1Password service account is now a per-profile reference

~~~toml
[profiles.personal]
github_token       = { op = "op://Private/github/token" }
op_service_account = { env = "OP_SERVICE_ACCOUNT_TOKEN" }   # optional; the default
~~~

An **address, not a value**, so the rule the schema already stated — never store
the credential that unlocks every other credential — still holds. The original
objection to a field here was that it "would need resolving before anything else
could resolve"; that applies to an `{ op }` reference and not to an `{ env }`
one, which needs no resolution machinery.

It exists because a single ambient variable cannot express two profiles
authenticating against different vaults. Omitting it keeps today's behaviour.

Rejected: namespacing to `REPOSETS_OP_SERVICE_ACCOUNT_TOKEN`, which breaks
1Password's own convention so anyone with the standard variable exported would
need a second one; and auto-sourcing an adjacent `.env`, which means silently
reading files nobody named, with precedence that is hard to reason about.

### R18 adopted, stand-in deleted

`WorkflowDispatch.list` replaced the raw `GitHubClient` route in the
code-scanning phase. Adopting it caught a real difference: the listing's
**length** is the count, not the response's `total_count` — the two diverge once
a repository has more workflows than fit one page, and the test fixture had only
set `total_count`.

Effected declined to answer whether a **disabled** workflow satisfies GitHub's
validation, on the grounds that it is a server-side rule the package cannot test
— `state` is reported verbatim and the caller decides. That is the right call and
leaves the question open here: our repositories had zero workflows, so only the
empty case has ever been exercised.

## Fourth pass — five findings, all from using the commands rather than building them

### 15. `history` printed no run id, so `history show` had nothing to take — **bug, fixed**

The two commands did not compose. `show` accepts a run id and the table was the
only place one could come from, and it did not print one. Fixed with a `RUN`
column of the first eight characters — what a person retypes, and `show` accepts
any unique prefix while refusing an ambiguous one, so a collision costs a second
attempt rather than the wrong run.

Building both and never running them together is exactly how this survives.

### 16. A partial run recorded that it failed and never why — **bug, fixed**

`finishRun` has always taken an optional error and the engine never passed one,
so the column was always null and `history show` on a failure showed an outcome
and nothing else — the one thing anyone opens a failed run to find out.

The engine now records the first error plus a count: a run over twenty
repositories can fail twenty times for one reason, and the per-resource records
carry the rest.

~~~text
run 019ffd8e-…
  2026-08-13 23:56 · applied · partial · 2ms

  error: --repo typo-here: no repository named 'typo-here' in group 'sandbox'
         (has: sandbox-alpha, sandbox-beta, sandbox-gamma)
~~~

Same shape as finding 11, one level down: stored faithfully, surfaced nowhere.

### 17. `--repo` naming nothing did nothing, successfully — **bug, fixed**

~~~text
$ reposets sync --repo does-not-exist
group: sandbox (0 of 3 repos)
Sync complete!
0 repo(s), 0 change(s), 0 drifted, 0 error(s)     ← exit 0
~~~

A CI job with a misspelled repository passed green having synced nothing. The
filter is applied against the group's declared repositories, so an unmatched name
is a typo and not a no-op. It is now an error naming what the group **does**
contain, counted through the same channel as a phase error so it reaches the exit
code.

### 18. A run-level error rendered with an empty repository slug — **papercut, fixed**

`: --repo does-not-exist — …`. An error belonging to no repository now omits
the prefix rather than printing a bare colon.

### 19. `settings settings` in the change list — **papercut, fixed**

The settings phase is one resource whose kind and name are both `settings`, so
naming both read as a rendering bug.

### The pluralisation and the doubled name were caught the same way

By reading real output. Neither is the kind of thing a test finds unless someone
thought to assert on the exact string — and the campaign's whole premise is that
the assertions we thought to write are not where the surprises are.

## Not adopted yet: `RepositoryVariable` now paginates

Effected changed variable listing from `request` to `paginate` upstream, which
fixes silent truncation past one page. **Our installed copy does not have it** —
a build was interrupted, and 330 passing tests proved nothing about it.

When it is adopted, the variables fixtures should **fail**: they stub that route
under `request` and `layerFixture` keys `paginate` separately. If they pass
instead, that is the thing to investigate.

## Fifth pass — adopting R19 and the pagination fix

### The `total_count` aside was the larger finding

Reporting the fixture mistake — that the listing's **length** is the count, not
`total_count` — led effected to probe whether those routes paginate at all. They
do, and **every list read in the new services returned one page**: eight reads
across five modules, each reporting a subset that looked complete.

The dangerous one is `Ruleset.upsert`. Its existence check decides
create-versus-update, so past the first page an existing ruleset was invisible
and **an update became a create**. `RepositoryVariable.set` had the same shape.
All eight paginate now, pinned by a genuine two-page test — a one-page test would
pass either way.

Worth being precise about how it was found: **by adopting, not by reviewing.**
The fixture that set only `total_count` is what put the two numbers side by side,
which is the only place the truncation is visible. Reading the code shows a list
being read; it does not show that the list stops at thirty.

### The prediction held, and that is the point

Before adopting, this journal recorded that the variables fixtures **should
fail**, because they stub `request` and `layerFixture` keys `paginate`
separately — and that passing would be the thing to investigate.

~~~text
297/330 passed, 33 failed
GitHubClient.paginate: no fixture for GET /repos/{owner}/{repo}/actions/variables
~~~

Thirty-three, on six routes. A fixture that could not tell the two calls apart
would have hidden a change to how every list in the program is read.

Routed centrally in the harness — one map of paginated routes and the key each
response wraps its items in — so each test still writes the shape GitHub returns.

### 20. The settings report now comes from the package — **finding 9, properly closed**

`applySettings` returns `{ rest, graphql }` taken **after** `preparePatch`, so a
real run reports what went on the wire:

~~~text
dry-run:  would apply settings (allow_merge_commit, delete_branch_on_merge,
                                has_issues, has_wiki, merge_commit_title,
                                security_and_analysis)
applied:  applied settings     (allow_merge_commit, delete_branch_on_merge,
                                has_issues, has_wiki, security_and_analysis)
~~~

`merge_commit_title` is named by the dry run and absent from the real one,
because `allow_merge_commit` is false and GitHub rejects the pair.

**The dry run remains approximate, and that is a real limit rather than an
oversight.** It never calls `applySettings`, so it has only the request to
report. Closing it would need a preview — "what would you send" without sending
— which is a second upstream ask and a different shape from a return value. The
rule is deliberately not re-derived here: two copies that can drift apart is what
the precondition pass just finished removing, and a reporting copy is worse
because nothing fails when it diverges.

## Sixth pass — the code-scanning success path, finally exercised

Local clones of the sandbox repositories made it possible to change repository
*state*, which is what the code-scanning phase branches on. A workflow file and a
TypeScript file went to **`sandbox-alpha` only**, leaving `beta` and `gamma` as
untouched controls.

~~~text
sandbox-alpha    workflows=1  languages=TypeScript
sandbox-beta     workflows=0  languages=none
~~~

One config, one command, opposite behaviour per repository:

~~~text
sandbox-alpha    sync    code_scanning configured
sandbox-beta     skip    code_scanning language actions (no workflow files)
                 skip    code_scanning language javascript-typescript (not detected)
                 skip    code_scanning default-setup (no configured language is present)
~~~

**Verified in GitHub's own state**, after allowing time for the asynchronous
apply:

~~~json
{ "state": "configured",
  "languages": ["actions", "javascript", "javascript-typescript", "typescript"],
  "updated_at": "2026-08-14T00:39:41Z", "schedule": "weekly" }
~~~

Both configured languages took effect — including `actions`, which produced
three 422s earlier in this campaign. GitHub expanded the two into four by adding
the aliases it tracks alongside them.

Read too early it showed `state: configured` with `languages: []` and
`updated_at: null`, which is exactly what the phase's docstring warns about: the
endpoint answers **202 Accepted** and applies asynchronously, so a successful
call means the request was accepted, not that scanning is configured. Worth
recording that the intermediate state is *observable* and looks like a silently
dropped language list.

This also settles `REPO_LANG_TO_CODEQL` mapping `TypeScript` onto
`javascript-typescript`, which was fixture-only until now.

### Every code-scanning path has now run live

| Path | Where |
| :--- | :--- |
| language dropped, not detected | `beta`, `gamma` |
| `actions` dropped, no workflows | `beta`, `gamma` |
| every language dropped, send nothing | `beta`, `gamma` |
| languages pass, configure succeeds | `alpha` |

### 21. The disabled-workflow question stays open, and the token is why — **not a bug**

Effected declined to answer whether a **disabled** workflow satisfies GitHub's
validation for the `actions` language, on the grounds that it is a server-side
rule the package cannot test. Testing it here needs `Actions: write` to disable a
workflow, and the sandbox token answers **403** — correctly, because reposets
never needs that permission and it is not in the required list.

So the token being properly scoped is what blocks the test. Answering it needs a
disable from the UI, and until then both codebases are guessing: our filter
counts a listed workflow regardless of `state`, and a disabled one may or may not
satisfy GitHub.

## Seventh pass — the check that satisfies itself

### 22. Configuring CodeQL creates a workflow that then satisfies the `actions` check — **bug, fixed**

Disabling `sandbox-alpha`'s workflow to answer the open question turned up
something else: the repository now had **two** workflows.

~~~text
ci        state=disabled_manually    path=.github/workflows/ci.yml
CodeQL    state=active               path=dynamic/github-code-scanning/codeql
~~~

Configuring default setup makes GitHub add a **synthetic** workflow — not a file
in the repository — and it appears in the listing our `actions` precondition
counts. So the check satisfies itself:

1. A repository with no workflows drops `actions`, correctly.
2. Some other language configures default setup.
3. GitHub adds the `CodeQL` workflow.
4. Every run after that counts one workflow and sends `actions`, on the strength
   of a workflow **this phase caused to exist**.

Fixed by counting only workflows whose `path` starts with `.github/workflows/`.
Two tests pin it: the synthetic one alone does not satisfy the check, and a real
file alongside it still does.

This is the precondition family's fourth member, and the first where the
precondition was corrupted by our own writes rather than merely modelled wrongly.

### 21 stays open, and is now confounded rather than blocked

With `ci` disabled, a forced re-configure **succeeded** — but `CodeQL`'s own
workflow was active at the time, so it is unknowable from this run whether the
disabled file counted. Answering it needs a repository with exactly one workflow,
disabled, and no default setup configured.

### Actions permission: **Read**, not write

The token now has Actions read-write, and the requirement recorded is **Read**.
The phase lists workflows and never starts, stops, enables or disables one;
write was needed only to *disable* a workflow for the experiment above, which is
not something reposets does.

Recorded in `doctor`, `docs/09-token-permissions.md` and `CLAUDE.md` with that
reasoning attached, because the failure mode is the one the account-level GPG
entry already demonstrated: a requirement listed for a capability the tool never
exercises, granted by every user who follows the docs.

## Eighth pass — finding 21, settled

### 21. A disabled workflow **does** satisfy the `actions` check — **closed, no change needed**

Three requests against `reposets-sandbox`, each on a repository with no
detected languages and no default setup, differing only in what workflows
existed:

| Workflows present | `PATCH code-scanning/default-setup` with `languages: ["actions"]` |
| :--- | :--- |
| none (`sandbox-gamma`) | **422** — "one or more languages you selected are not present" |
| one, `disabled_manually` (`sandbox-beta`) | **accepted** |
| only `dynamic/github-code-scanning/codeql` (`sandbox-beta`) | **422** |

So GitHub's rule is the file's **path**, never its state. Both halves of the
filter shipped in the previous pass are now confirmed against the live API
rather than reasoned about: real files count regardless of state, and the
synthetic one never counts.

The earlier attempt was confounded because `CodeQL` was active during it. The
fix was to ask on a repository that had never been configured — `gamma` gave the
negative control the first attempt lacked, and it is the reason keeping two
untouched repositories was worth the discipline.

### The teardown was the more useful half

Setting default setup back to `not-configured` **does not remove the synthetic
workflow**. `sandbox-beta` now reports `total_count: 1` with only
`dynamic/github-code-scanning/codeql` in it, permanently.

That upgrades the previous pass's fix from prudent to load-bearing: any
repository that has *ever* had default setup keeps a workflow that a raw count
would believe forever, so `total_count` is not merely imprecise there — it is
wrong, and it stays wrong. The third row of the table above is that state, and
GitHub agrees with us about it.

`sandbox-beta` is therefore no longer a pristine control. `sandbox-gamma` is.

### The test that existed could not have failed

Every workflow fixture in the suite was `state: "active"`, so adding
`&& workflow.state === "active"` to the filter passed all 332 tests while
breaking the case just proven live. A test now pins the disabled case, and it
was checked by applying that exact mutation: one test fails, and it is the new
one.

This is the fifth green-passing defect of the campaign, caught before it existed
rather than after — the same lesson, applied forward for once.

### 3. Per-group credential tokens — **closed**

`credentials` is now required on every group and selects the profile's **token**,
not only its `[resolve]` values. `sync` partitions groups by profile and runs one
engine per partition.

The shape was forced by the package, not chosen: a token is fixed at
`GitHubClient` construction and every resource service is built from that client,
so a second identity is a second service graph. Partitioning states that honestly
— a sync under two identities is two runs' worth of authority.

**Required rather than optional** because an optional field would have to mean
"the only profile", which stops being well defined the day a second profile is
added. Adding an unrelated profile would then change which account an existing
group writes to, with nothing in that group having changed. It also removed two
implicit behaviours that could each pick the wrong account silently: `sync`
refusing to run with more than one profile at all, and the engine's
`Object.values(profiles)[0]` fallback, which made identity depend on TOML key
order.

Three details that were not obvious going in:

- **The run boundary had to move to the command.** `syncAll` opened and closed
  its own journal run, so N partitions meant N `history` rows for one `sync`,
  and `finishRun` overwriting the row N times would have kept only the last
  partition's outcome.
- **The shared services must be provided once around the whole loop.** Layers
  memoize per build, so providing the logger per partition mints one logger per
  profile — each with its own error tally, so `finish()` would report one
  partition's errors and call it the run.
- **One policy for a bad profile, not two.** The first draft aborted the whole
  command for an unknown profile while an unresolvable token only failed its own
  groups. Now both fail their own groups, so a four-group sync is not lost to the
  fourth group's typo after three have already written.

### The order test that was wrong, and worth keeping

`partitionByProfile` was extracted so the partitioning logic could be tested at
all — the handler builds its own `GitHubClient`, so nothing above it can be
faked. The first test asserted that a group named `2` keeps its config position,
with a comment claiming `Map` guaranteed it.

It failed, and the comment was the wrong half: `Object.entries` hoists
integer-like keys before the `Map` ever sees them. The test now asserts the real
behaviour and says why it is not fixable at that layer.

### A pre-existing lint failure, found in passing

`pnpm run lint` was failing on committed code: `security.ts` carried two
`ctx: RepoContext` parameters left dead by the `Repo`-from-context refactor.
`lint-staged` only checks staged files, so an edit that stops using a parameter
leaves the failure in the tree until someone runs the full check. Removed the
parameters rather than underscore-prefixing them.

### The owner moved to the credential profile

`owner` is gone from `reposets.config.toml` entirely — top level and per group.
A profile declares who it acts as, as exactly one of `username` or `org`.

The reasoning is the same one that made `credentials` required, taken one step
further: a token authenticates *as* an identity, so the account belongs to the
credential rather than to the repositories being configured. What made it worth
doing rather than merely tidier is that the owner's **type** came with it.

**Two keys, not `owner` plus `owner_type`**, so an owner without a type is
unrepresentable. The branches forbid each other's key, and that detail was
forced by a probe rather than chosen: a plain `Schema.Union` of two structs
**accepts** a profile declaring both and silently drops the second. Verified
against the installed beta before committing to the shape — the same hole exists
in the pre-existing `CredentialSource` union (`{op} | {env}`), which is worth
knowing.

### What the declaration bought, and what it must not be trusted for

`validate` can now reject three organization-only constructs offline, with no
token: a `Team` ruleset bypass actor, a `Team` environment reviewer, and
delegated bypass. Before this the owner's type was only knowable by asking
GitHub, so the command whose entire contract is "no network" could not check
them at all — they surfaced as a 422 partway through a sync, after earlier
repositories had already been written.

Each is checked where it is **referenced**, not where it is defined. A ruleset
with a team actor is valid sitting in `[rulesets.*]`; it only becomes an error
when a personal-account group assigns it, and reporting the definition would
name a section shared across groups that the user cannot change without breaking
the groups legitimately using it.

**`sync` still verifies the declaration against GitHub.** Believing a
hand-written claim in the write path is exactly the shape of the four green bugs
this campaign already found — a precondition satisfied by our own assumption. It
is now a check rather than a lookup, failing the repository with a named error
on a mismatch. A side benefit: on a failed read the declaration stands, where
the old fallback assumed `Organization` for everyone and could send org-only
settings to a personal account.

Verified end to end against the built CLI, offline: a personal profile with a
team ruleset exits 1 naming the group and the path, the same config under an org
profile exits 0, and a profile declaring both keys is rejected by the schema.

### A correction worth recording

I read `generate:json-schema`'s `outcome: "unchanged"` as "the schema did not
change" and inferred a classifier bug, because `git diff` showed a large change
at the same moment. Both were true: `unchanged` means "the file already matches
what I would write", which is a different question from "differs from HEAD". The
file had been regenerated earlier in the session. Restoring the schemas to HEAD
and running once reported `written/contract` correctly.

Two things worth keeping from it: a large schema diff is usually **formatting**
(the generator writes expanded arrays, biome folds them), and an outcome report
answers the question it was asked, not the one in my head.

### Known rough edge

A profile declaring both `username` and `org` is rejected with `Expected never |
undefined at profiles.me.org` plus the matching line for `username`. Correct,
and the two lines together do say it, but neither says "you declared both".

## Ninth pass — the live four-repo run, and what it exposed

The first sync driving two identities from one config. Three of the four things
being checked held: no owner-type mismatches, `reposets-scratch` reached for the
first time ever, both groups in config order, and **one** `history` row for a run
that built two engines.

### 23. A dry run counted five changes and printed one — **bug, fixed**

The summary said `5 change(s)`; one `would apply settings` line appeared. All
five belonged to `reposets-scratch` — the sandbox repositories had genuinely
converged — so the miss was not spread across repositories, it was four fifths
of one repository's list.

`syncOperation` was gated at `verbose`, and it is the per-resource line for
every secret, variable, ruleset, environment and security toggle. `settings`
printed because it has its own call at `info`. So the tier boundary did not fall
between summary and detail; it fell between settings and everything else, which
is not a distinction any reader would predict.

**My first diagnosis was wrong** and the journal is what corrected it: I said the
sandbox group's changes were hidden. `history show` proved otherwise by naming
every change and its repository — the new command paying for itself on its first
real use.

### The tiers are gone entirely

Enumerating the guards settled it: `info` gated eight call sites, `verbose`
exactly one, `debug` two *suffixes*. So `info` versus `verbose` was never a tier
— it was a switch that hid the output.

`silent` was worse than useless: `syncError` and `finish` were both gated at
`info`, so a failing run printed nothing at all and the exit code was the only
signal. A config file that can silence errors is worse than `> /dev/null`, which
leaves them on stderr.

`log_level` is deleted from the schema. `debug` survives as `--debug` on `sync`
and `drift`, because it annotates lines that print either way rather than
unlocking new ones — a thing you reach for mid-diagnosis, not a stored
preference. This also permanently ends the `log_level` versus `--log-level`
confusion that had already been documented wrongly twice.

A test that asserted the old contrast — operation line dropped, drift line kept
— had its premise deleted with the tiers, and was rewritten to pin what still
matters: the two lines still read differently.

### 24. `history show` stated work a dry run never did — **fixed**

Every record rendered as `updated`, past tense, for a run that changed nothing.
The header says `dry-run` and the listing has a MODE column, so it was not
misleading in context, but a resource line claiming completed work is the wrong
tense to print. Dry-run records now render `would create`/`would update`/`would
delete`. `unchanged` and `drift-overwritten` are left alone: they are
observations, and a dry run observed them as truly as a real run would.

### The schema-report mystery, finally named

`generate:json-schema` kept reporting `unchanged` while `git diff` showed the
schema had changed, and I twice drew a conclusion about it that was wrong — first
that the classifier was broken, then that I could not account for it.

The cause is `vitest.setup.ts`: it runs `pnpm turbo run build:dev` as a global
setup, and `build:dev` depends on `generate:json-schema`. **Every `pnpm run test`
regenerates the schemas.** So by the time the generator ran by hand it always had
nothing to do, and `unchanged` was always true. The classifier was correct every
time; three controlled runs reported `written/contract` for a contract change and
`written/annotations` for a description-only change.

Two consequences worth keeping: the test suite mutates tracked files, and it
writes them unformatted, so `pnpm test` followed by `pnpm lint` fails on
formatting until `lint:fix` folds them back.

### 10. The sealed box encrypts the value we meant — **closed, verified**

The last finding with substance, and the one that had no way of failing loudly.
GitHub never returns a secret, so nothing in the tool, the API, or the test suite
could distinguish a correct sealed box from one writing garbage into every secret
reposets has ever set.

Settled by making the runner do the reporting. A `workflow_dispatch` workflow in
`reposets-scratch` prints a truncated SHA-256 of `CAMPAIGN_MARKER` — a digest by
construction, not by good manners: GitHub masks the secret itself in logs, while
a hash is a different string that prints unmasked.

| Side | Digest |
| :--- | :--- |
| runner, decrypting what GitHub stored | `a915c60c2f944504` |
| local, hashing the config plaintext | `a915c60c2f944504` |

So the `tweetnacl` + `blakejs` port from R16 is correct end to end.

Two details that made the check trustworthy rather than merely green:

- **Non-empty was never sufficient.** Garbage is also non-empty; only the digest
  comparison proves the value survived. The workflow fails explicitly on an empty
  marker so that case is distinguishable from a mismatch.
- **Neither side handled the plaintext.** The local digest was computed by a
  script that reads the config and prints only the hash, so verifying the secret
  never required exposing it — which is the property that makes this repeatable
  rather than a one-off.

The workflow stays. It is a permanent, cheap regression check against any future
change to the encryption path, which is exactly what this finding lacked.

**Side effect, deliberate:** `reposets-scratch` is no longer a repository with no
workflow files, so the `actions` CodeQL language becomes eligible there and the
next sync will configure rather than skip it — finding 21's rule running in the
succeeding direction, on a personal account.

## Tenth pass — a real config, and three defects the sandbox could not produce

Run against the user's own 22-repo config rather than the four sandbox
repositories. It produced four errors; **three of them were ours**.

The count was right, which is worth saying first: 1 settings + 1 code_scanning

- 11 actions secrets + 11 dependabot secrets + 4 rulesets = 28, matching the
summary exactly. The tier removal holds on real output.

### 25. `--repo` reported an error for every group that lacked the repo — **fixed**

The typo guard fired per group. With `effect-playground` in `oss` and a second
group `private`, the run reported `no repository named 'effect-playground' in
group 'private'` — true, and not a mistake.

Consequence: **any multi-group config exited 1 on a successful run**, failing
exactly the CI gate the guard exists to protect. It was also misattributed, to
whichever repository happened to be current when it fired.

The test has to be *matched nothing anywhere*, not *matched not this group* —
"absent from this group" and "absent from the config" are different claims and
only the second is a mistake. Verified both directions live: the spurious error
gone, a genuine typo still caught and now listing every configured repository.

**Not covered by the suite.** `syncAll` has no test harness — the phase tests
construct a `RepoContext` directly — so this is verified only by those two runs.
An engine harness is the obvious gap.

### 26. The `[resolve]` section's `value` sub-group was never read — **fixed**

Three of the four errors said `credential label 'SILK_CUSTOM_REGISTRIES' is not
defined in the active profile's [resolve] section`. It was defined — under
`value`.

`resolveAll` iterated `op`, `env` and `file`. Its comment read "the order the
schema declares them"; the schema declares four. So every inline label resolved
to nothing, and consumers reported the wrong file and the wrong mistake.

**The root cause was a stale docstring.** The class comment stated that the
schema had *dropped* `value` from the section, and the implementation matched
the docstring rather than the schema. That decision was genuinely made and then
reversed — `value` survives for non-secret structured data, and the rule that
held is narrower: a *credential* is never inlined, enforced on `github_token`.
Two sources of truth disagreed and the code followed the prose.

Fixed, and the sub-group now has the three tests it never had, checked by
removing the loop again. The user's config went from 3 errors to 0, and 28
changes to 30 — the two entries that had been failing.

### 27. `validate` now rejects undeclared labels offline — **new check**

The sync-time check compares against resolved *values*, so it cannot fire until
a run has authenticated and reached the secrets phase — after settings,
environments and rulesets have already been written. Comparing against the
labels a profile *declares* is static, so it belongs in `validate`.

Deduplicated by (group, entry, label): a secret group assigned to both `actions`
and `dependabot` reported the same missing label twice in the real run.

It does not replace the runtime check — a declared label can still fail because
the `op://` item was renamed. It catches the commoner mistake, a rename on one
side of the pair.

### 28. The new check skipped half of a shared name — **fixed in the same pass**

`undefinedCredentialLabels` resolved a referenced group with
`config.secrets[name] ?? config.variables[name]`. A real config has `silk-v1` as
a **settings group, a secret group and a variable group at once**, so the
coalescing form checked whichever won and silently skipped the other.

Written twenty minutes earlier, with six tests, none of which used a shared
name — because a fixture author picks distinct names without thinking about it.
Caught by reading the real config's own `list` output while accounting for a
resource that had gone quiet.

Now iterates both sections. Pinned by a test, checked by restoring the `??`.

### The lesson this pass paid for

Every one of the three was invisible to a config I wrote myself. The sandbox had
one group, so the `--repo` guard never double-fired; it used no inline values, so
the missing sub-group never mattered; and its labels were all correct, so the
offline check had nothing to find.

**A test fixture is written by someone who already knows the answer.** A real
config is not, which is why running against one found more in ten minutes than
the previous nine passes found in a day — including a defect in the check
written to catch the previous defect.

The tell each time was **a resource that went quiet**: an error that stopped
appearing without a change appearing in its place. Chasing the one that vanished
(`SILK_RELEASE_SBOM_TEMPLATE`) is what surfaced the shared-name bug, and the
answer came from the tool's own `list` output rather than from reading a config
that may hold inline values.
