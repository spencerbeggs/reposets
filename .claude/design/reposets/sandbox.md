---
module: reposets
title: Sandbox and live testing
category: process
status: current
completeness: 95
created: 2026-08-14
updated: 2026-08-14
last-synced: 2026-08-14
related:
  - cli-campaign-journal.md
  - session-handoff.md
  - config-format.md
dependencies: []
---

## What this is for

reposets writes to GitHub, and the defects that matter most are the ones no test suite can see: a request GitHub rejects, a precondition satisfied by our own writes, a secret that encrypts to garbage. Every one of those was found by running the tool against real repositories and checking the result somewhere the code could not reach.

This describes that setup — four repositories across two accounts, deliberately in different states — and how to activate it.

## Activating the sandbox config

Two gitignored backups sit in the repository root:

~~~text
reposets.config.toml.bk
reposets.credentials.toml.bk
~~~

Drop the `.bk` and they become the active config, because the resolver walks up from the working directory and finds the repository root before it reaches XDG:

~~~bash
mv reposets.config.toml.bk reposets.config.toml
mv reposets.credentials.toml.bk reposets.credentials.toml
~~~

Rename them back to restore whatever config was there before. `.gitignore` covers `reposets.config.toml`, `reposets.credentials.toml` and any suffixed variant, so neither the live files nor the backups can be committed.

**The working directory decides which config is read.** A `cd` out of the repository picks up a different one, and running from a temp directory picks up XDG. This is worth knowing before concluding a config change did nothing.

## The repositories

| Repository | Owner | State, and what it is for |
| :--- | :--- | :--- |
| `sandbox-alpha` | `reposets-sandbox` (org) | Has `src/index.ts` and `.github/workflows/ci.yml`, **disabled**; CodeQL default setup **configured**. The "already converged" case, and the only repo where the `actions` CodeQL language is satisfiable |
| `sandbox-beta` | `reposets-sandbox` (org) | README only — but **no longer pristine**. Default setup was configured and removed during the finding-21 probe, and the synthetic `dynamic/github-code-scanning/codeql` workflow persists, so it reports `total_count: 1` forever |
| `sandbox-gamma` | `reposets-sandbox` (org) | README only, no workflows, no languages, never configured. **The clean control.** Keep it that way |
| `reposets-scratch` | `spencerbeggs` (user) | The personal-account case. Carries `.github/workflows/verify-secret.yml` — see below |

Local clones: `/Users/spencer/workspaces/reposets/{sandbox-alpha,sandbox-beta,sandbox-gamma,reposets-scratch}`.

**The control/experiment split is the point.** Finding 21 was answered by asking the same question of a repository with one disabled workflow and a repository with none, and getting different answers. A sandbox where every repository is in the same state can only tell you that the tool ran.

## The config

Two groups, one per identity — which is what makes this exercise the per-group credential work:

| Group | Repos | Profile | Owner |
| :--- | :--- | :--- | :--- |
| `sandbox` | the three org repos | `sandbox` | `org = "reposets-sandbox"` |
| `scratch` | `reposets-scratch` | `personal` | `username = "spencerbeggs"` |

Both groups assign the same resources — `settings.baseline`, `rulesets.protect-default`, `environments.staging`, `security.baseline`, `code_scanning.baseline`, and the `campaign` secret and variable groups — so a difference in outcome between the two groups is a difference in **owner type or token**, never in what was asked for. `sandbox` additionally enables `cleanup.variables.actions`, so the cleanup phase has something to delete.

Both profiles resolve their `github_token` from 1Password, so `OP_SERVICE_ACCOUNT_TOKEN` must be in the environment of the same command:

~~~bash
source /Users/spencer/.config/zsh/.zenv.private && pn reposets sync --dry-run
~~~

## Token permissions

The two tokens have **disjoint reach** — the org token cannot see `reposets-scratch` and the personal token cannot see the org — which is exactly why this configuration is worth having: it is the only way to exercise a run under two identities.

`doctor` prints the required permission list, and says plainly that it is a *requirement rather than a verification*, because GitHub does not expose a fine-grained token's own scopes. That limitation is not theoretical: mid-campaign the personal token authenticated fine, wrote settings, environments and rulesets, and then 403'd on secrets and variables. **Secrets** and **Variables** (both read and write) had to be granted before a full run succeeded.

## `verify-secret.yml` — the sealed-box regression check

`reposets-scratch` carries a `workflow_dispatch` workflow that prints a truncated SHA-256 of the `CAMPAIGN_MARKER` secret. **Keep it.**

It exists because GitHub never returns a secret, so nothing in reposets, its tests, or the API can distinguish a correct sealed box from one writing garbage — the write succeeds either way. Making the runner decrypt the value and report a digest is the only construction that closes that.

~~~bash
gh workflow run verify-secret.yml --repo spencerbeggs/reposets-scratch
gh run view <id> --repo spencerbeggs/reposets-scratch --log | grep -oE 'DIGEST=[0-9a-f]{16}'
~~~

Compare against the digest of the plaintext. `CAMPAIGN_MARKER` is a `value`-kind secret, so the plaintext is in `reposets.config.toml` and can be hashed without anyone handling it:

~~~bash
python3 -c "
import tomllib, hashlib
c = tomllib.load(open('reposets.config.toml','rb'))
v = c['secrets']['campaign']['value']['CAMPAIGN_MARKER']
print(hashlib.sha256(v.encode()).hexdigest()[:16])"
~~~

A digest rather than the value **by construction**: GitHub masks the secret itself in logs, while a hash is a different string that prints unmasked. Both sides read `a915c60c2f944504` when this was established.

The workflow fails explicitly on an empty marker, so "absent" is distinguishable from "wrong" — non-empty was never sufficient, since garbage is also non-empty.

## Running the campaign

In order, cheapest first — each catches what the next would otherwise waste a round trip on:

~~~bash
pn reposets validate                                    # offline: schema, refs, org-only, labels
source …/.zenv.private && pn reposets doctor            # resolves both tokens, GET /user each
source …/.zenv.private && pn reposets sync --dry-run    # reads everything, writes nothing
source …/.zenv.private && pn reposets sync              # the real thing
source …/.zenv.private && pn reposets drift             # re-reads and compares to the baseline
~~~

`drift` immediately after `sync` is the sharpest of these: it compares against the baseline the sync just wrote, so a fingerprint that does not round-trip shows up as drift on something that was applied seconds earlier.

**Rebuild first.** `pn reposets` runs `dist/dev/pkg`, so a source change is invisible until `pnpm --filter reposets build:dev`.

## What to watch in the output

Things that have been wrong before and would be wrong quietly again:

- **The change count must match the printed list.** A summary naming more changes than lines is how the verbosity tiers were caught hiding four fifths of a dry run.
- **A resource that goes quiet.** An error that stops appearing without a change appearing in its place is not necessarily fixed — twice it meant something was being skipped. Chase it with `history show`.
- **`history` rows per command.** One `sync` is one row however many identities it used. Two rows means the run boundary broke.
- **Owner-type mismatches.** `sync` verifies each profile's declared `username`/`org` against GitHub before writing; a mismatch fails that repository by name rather than sending a request GitHub rejects.

## State left behind, deliberately

- `sandbox-alpha`'s `ci` workflow is **disabled** and its CodeQL default setup is **configured** — that pairing is what makes it the converged case.
- `sandbox-beta` permanently reports the phantom CodeQL workflow. It cannot be removed; `not-configured` does not delete it.
- `reposets-scratch` has a workflow, so it is no longer a "no workflow files" repository and the `actions` CodeQL language is eligible there.
- `settings.baseline` and `code_scanning.baseline` carry two values changed during testing (`has_wiki`, `query_suite`) that were never reverted.
