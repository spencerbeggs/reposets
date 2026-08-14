---
module: reposets
title: Session handoff
category: process
status: current
completeness: 95
created: 2026-08-14
updated: 2026-08-14
last-synced: 2026-08-14
related:
  - cli-campaign-journal.md
  - sandbox.md
  - architecture.md
dependencies: []
---

## Read this first

Detail lives in [cli-campaign-journal.md](cli-campaign-journal.md) — 28 findings with evidence, now closed. This file is **state and traps**: what is in flight, and what costs an hour to rediscover.

It is a session artifact, not a description of the system. Nothing here is authoritative; `architecture.md`, `services.md`, `cli.md` and `config-format.md` are. Delete it once the branch merges.

## Where the work is

Branch `feat/effect-v4-kit-rebuild`, closing. The Effect v4 / `@effected/*` migration is done and verified against real GitHub; the CLI has been driven by hand end to end across ten passes.

**The campaign's goal is met.** One config, two credential profiles, four repositories across a personal account and an organization, applied in a single run recorded as one journal entry — none of which was expressible at the start of the day, when `sync` refused to run with two profiles configured. Every campaign finding is closed except the settings dry run, which needs an upstream change nobody has asked for.

## Operational traps, in the order they cost me time

**`pn reposets` runs `dist/dev/pkg`, not prod.** After any source change, rebuild with `pnpm --filter reposets build:dev`. Building `prod` and re-testing looks exactly like "the fix did not work".

**The 1Password token must be sourced in the same command**, because shell state does not persist between invocations:

~~~bash
source /Users/spencer/.config/zsh/.zenv.private && pn reposets <cmd>
~~~

That applies to the user's `!` shell too — a bare `SB=…` on its own line is gone by the next command.

**`rg -rn` is `--replace`, not recursive.** It silently rewrites every match to `n` and hands back mangled output that reads like evidence. Cost me two wrong conclusions. Use `grep -rn`, or `rg -n`.

**Several source files contain NUL bytes** (`AppliedState.ts`, the secrets and variables phases — the composite-key separator, deliberately). `grep` treats them as binary and prints nothing; use `grep -a`. A silent no-match here looks like a clean result.

**Never run `vitest` inside `/Users/spencer/workspaces/spencerbeggs/effected`.** That session runs its own tests and the two collide on the coverage directory. It also killed a build mid-flight, leaving a stale `dist` that made 330 passing tests prove nothing.

**Verify a build by content, not by mtime.** A `dist` whose mtime is *older* than its source can still be current — a lint pass touches source after the build. Grep the built chunk for the symbol, and grep a known-present symbol as a control.

**`pnpm run test` regenerates `package/schemas/*.json`.** `vitest.setup.ts` runs `pnpm turbo run build:dev` as a global setup, and `build:dev` depends on `generate:json-schema`. Two consequences: the test suite mutates tracked files, and it writes them unformatted, so `pnpm test` followed by `pnpm lint` fails on formatting until `lint:fix` folds them back. This cost me three wrong conclusions about the schema generator, which was correct every time — its `unchanged` means "the file already matches what I would write", not "the schema did not change".

**The push guard false-positives on unrelated repos.** Pushing `reposets-sandbox/sandbox-alpha` — a repo with three files and no manifest — was blocked because *this* repo carries `file:` overrides. Worth reporting to the silk plugin; the guard appears to read the session's cwd rather than the push target. Do not work around it; ask.

## Sandbox state, as left

**Full setup, activation and campaign procedure: [sandbox.md](sandbox.md).** The two `reposets.*.toml.bk` files in the repository root become the active sandbox config by dropping the `.bk`. What follows is the short version.

Local clones: `/Users/spencer/workspaces/reposets/{sandbox-alpha,beta,gamma,reposets-scratch}`.

| Repo | State |
| :--- | :--- |
| `sandbox-alpha` | a workflow (`.github/workflows/ci.yml`, **disabled**) and `src/index.ts`; CodeQL default setup **configured** |
| `sandbox-beta` | README only, but **no longer pristine**: default setup was configured and removed during the finding-21 probe, and the synthetic `dynamic/github-code-scanning/codeql` workflow persists. It reports `total_count: 1` forever |
| `sandbox-gamma` | the untouched control — README only, no workflows, no languages, never configured |
| `reposets-scratch` | first synced today. Carries `.github/workflows/verify-secret.yml` (`workflow_dispatch`, prints a truncated digest of `CAMPAIGN_MARKER`) — **keep it**, it is finding 10's permanent regression check |

**Changed for testing and not changed back:**

- `reposets.config.toml` has `has_wiki = true` and `query_suite = "extended"`.
- `sandbox-alpha`'s `ci` workflow is disabled.
- `reposets-scratch` now has a workflow, so it is no longer a "no workflow files" repository — the next sync will configure the `actions` CodeQL language there rather than skipping it.

The control/experiment split is what made the code-scanning findings visible — keep `beta` and `gamma` clean unless a test needs otherwise.

## Dogfood loop: round 8, open

Counterpart `effected` at `../effected`. Journal `.claude/dogfood/effected.jsonl`.

**R18** (workflow listing) and **R19** (`applySettings` returns what it sent) both landed and are adopted. Reporting a fixture mistake about `total_count` led them to find that **every list read was truncated to one page** — eight reads, five modules, including the ruleset existence check that decides create-versus-update. Fixed upstream, adopted here.

**The release ran and the loop is closed.** `package/package.json` now carries published ranges rather than linked builds; read the current versions off it rather than from any table here. `@effected/cli` is **not** a dependency — the earlier note that our exit needed it was wrong.

The lesson worth keeping from the open period: **do not pin ranges from a linked build's version, and do not trust the registry to tell you whether a package is current.** Changesets bump at release, so a branch build reports the *previous* release's number while carrying unreleased code, and the registry serves that same number. A linked build and a published one look identical by version and differ in code. An earlier revision of this file listed guessed post-release versions as fact and nearly wrote three unresolvable ranges into `package/package.json`.

## Open work

**Campaign findings still open** (numbered as in the journal):

- ~~**3**~~ — **closed and exercised live**. `credentials` is required per group and selects the token; `sync` partitions groups by profile and runs one engine per partition. All four repositories now sync from one config in one run.
- ~~**10**~~ — **closed**. A `workflow_dispatch` workflow in `reposets-scratch` prints a truncated SHA-256 of `CAMPAIGN_MARKER`; runner and local digests both `a915c60c2f944504`. The R16 sealed-box port is correct end to end, and the workflow stays as a permanent regression check.
- ~~**21**~~ — **closed**. A disabled workflow *does* satisfy the `actions` check; the synthetic CodeQL workflow does not; zero workflows is a 422. The shipped filter is right on both counts, now confirmed live rather than reasoned about, and a test pins the disabled case (mutation-checked).
- The **settings dry run** is still approximate. It never calls `applySettings`, so it reports the request; a real run reports what was sent. Closing it needs a *preview* upstream, which is a different shape from R19's return value and has not been asked for.

**Also open, none blocking:**

- The **push-guard false positive** is still unreported to the silk plugin, pending the user's go-ahead — it is an issue on someone else's repo.
- `PERSONAL_TOKEN` needed **Secrets** and **Variables** (write) added mid-run for `reposets-scratch`. This is exactly the failure `doctor` says it cannot catch: it prints the permission list as a requirement and states plainly that GitHub does not expose a fine-grained token's own scopes.
- ~~doctor's identity line~~ — **closed**. `describeIdentity` words it per profile kind: a `username` profile gets the free exact check (`login === username`), an org profile is told the token's owner without any claim of having verified the pairing.

Found during the closing docs sweep:

- ~~**`validateConfigRefs` is gone and nothing replaced it**~~ — **closed**. v3 registered it as the config spec's `validate` callback; the rebuild dropped it, and every phase went on skipping unresolvable references silently while citing it by name as the thing that owned the check. Restored as `danglingReferences` (`package/src/lib/config-refs.ts`), called by `validate` and by `sync` before it writes, rather than on the spec — `ConfigValidationError.issue` is a schema-issue tree and `formatSchemaIssue` expects that shape. **This is the sharpest example of the pattern below**: the check was deleted, three comments went on naming it, and nothing failed. A doc/code mismatch was the only visible symptom.

Still open:

- **`doctor`'s `KNOWN_CONFIG_KEYS` still lists `owner` and `log_level`**, and `KNOWN_GROUP_KEYS` still lists `owner` — all removed from the schema on this branch. The migrating config is the one case this list exists to serve.
- **The changeset is `minor`.** From 0.4.3 that releases 0.5.0, not 1.0.0, for a set of changes it itself files under "Breaking Changes".
- **`tweetnacl` is still a dependency** and is imported nowhere, left behind when the sealed box moved to `@effected/github`.
- The `STRICT_KEYS` docstring in `ConfigFiles.ts` says it is "applied to credentials only, for now"; `makeConfigFilesLive` passes it too.
- `SyncOptions.failOnDrift` is threaded into the engine and never read there.

The docs pass is **done**; see the design docs for what the code now does.

## The one thing worth carrying forward

The worst bugs this session were **green**: an exported module no consumer could reach, a route census that printed "no overlap" twice, a test that asserted we send a request GitHub rejects, a precondition satisfied by our own writes, and a dry run reporting a change count with four fifths of the list suppressed. Every one passed its own tests.

The pattern that found them was always the same — run the thing, then check the result somewhere the code cannot reach: GitHub's API, a built artifact, a consumer import, a control repository, a runner decrypting a secret we wrote. A suite proves the code does what the suite says.

The corollary, learned the hard way three times today: **when an observation contradicts a tool, suspect the reading before the tool.** The schema generator, the change classifier and the stream routing were each accused and each exonerated by one controlled run.
