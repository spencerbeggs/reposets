---
title: Sandbox campaign
description: How to activate the gitignored sandbox config and run reposets against four real, deliberately-varied repositories
type: Runbook
tags:
  - testing
  - github
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: e35c93b4c52112a8e0a80b7a45c610b7ddc0f823b551d6856bd8d1f737ba7828
sources:
  - id: gitignore
    resource: "../../.gitignore"
---

# Sandbox campaign

reposets writes to GitHub, and the defects that matter most — a request
GitHub rejects, a precondition satisfied by reposets' own prior writes, a
secret that encrypts to garbage — are ones no unit test can see. This is
the procedure for finding them by running the tool against real
repositories and checking the result somewhere the code cannot reach.

**Trigger:** any change that touches what reposets writes to GitHub —
a settings field, a secrets or variables phase, a ruleset payload, an
environment, a security or code-scanning configuration.

**Observable end state:** `reposets drift` run immediately after
`reposets sync` reports nothing. That is the sharpest check available: it
compares against the baseline the sync run just wrote, so a fingerprint
that fails to round-trip shows up as drift on something applied seconds
earlier.

## Steps

1. **Activate the sandbox config.** Two gitignored backups sit in the
   repository root — `reposets.config.toml.bk` and
   `reposets.credentials.toml.bk`. Drop the `.bk` suffix on both:

   ```bash
   mv reposets.config.toml.bk reposets.config.toml
   mv reposets.credentials.toml.bk reposets.credentials.toml
   ```

   This works because the config resolver walks upward from the working
   directory and reaches the repository root before it ever falls back
   to the XDG config directory[^gitignore]. `.gitignore` covers both
   plain names and any suffixed variant (`reposets.config.toml.*`,
   `reposets.credentials.toml.*`), so neither the live files nor the
   `.bk` backups can be committed. Rename them back
   (`reposets.config.toml` → `reposets.config.toml.bk`) to restore
   whatever config was active before.

   **The working directory decides which config is read.** A `cd` out of
   the repository picks up a different config; running from a temp
   directory falls through to XDG. Confirm the working directory before
   concluding a config change did nothing.

2. **Rebuild.** `pnpm exec reposets` runs `dist/dev/pkg`, so a source
   change is invisible to the CLI until `pnpm --filter reposets
   build:dev` has run.

3. **Run the campaign, cheapest first** — each command catches what the
   next would otherwise waste a round trip discovering:

   ```bash
   pnpm exec reposets validate                                          # offline: schema, refs, org-only, labels
   source ~/.config/zsh/.zenv.private && pnpm exec reposets doctor      # resolves both tokens, GET /user each
   source ~/.config/zsh/.zenv.private && pnpm exec reposets sync --dry-run   # reads everything, writes nothing
   source ~/.config/zsh/.zenv.private && pnpm exec reposets sync        # the real thing
   source ~/.config/zsh/.zenv.private && pnpm exec reposets drift       # re-reads and compares to the baseline
   ```

   `OP_SERVICE_ACCOUNT_TOKEN` must be sourced in the **same** command as
   each invocation — both sandbox profiles resolve their `github_token`
   from 1Password, and shell state does not persist between separate
   tool invocations, so a `source` run once in an earlier command does
   not carry forward.

4. **Watch for these, in the output of every step:**
   - **The change count must match the printed list.** A summary naming
     more changes than lines actually shown means something is being
     hidden.
   - **A resource that goes quiet.** An error that stops appearing
     without a corresponding change appearing in its place does not mean
     it is fixed — it can mean the resource is silently being skipped.
     Chase it with `reposets history show`.
   - **One `history` row per invocation.** A single `sync` across
     multiple credential profiles should still produce exactly one
     journal row; two rows means the run boundary broke.
   - **Owner-type mismatches.** `sync` verifies each profile's declared
     `username`/`org` against GitHub before writing; a mismatch fails
     that repository by name rather than sending GitHub a request it
     would reject.

## Fixtures

Four repositories across two GitHub accounts, deliberately left in
different states so a difference in outcome is attributable to something
real rather than to every repository being in the same shape:

| Repository | Owner | State |
| --- | --- | --- |
| `sandbox-alpha` | `reposets-sandbox` (org) | Has `src/index.ts` and `.github/workflows/ci.yml`, **disabled**; CodeQL default setup **configured**. The converged case, and the only repo where the `actions` CodeQL language is satisfiable |
| `sandbox-beta` | `reposets-sandbox` (org) | README only, but **no longer pristine** — a phantom `dynamic/github-code-scanning/codeql` workflow persists from an earlier default-setup configure/remove cycle, so it reports `total_count: 1` from the workflow listing forever |
| `sandbox-gamma` | `reposets-sandbox` (org) | README only, no workflows, no languages, never configured. The clean control — keep it that way |
| `reposets-scratch` | `spencerbeggs` (user account) | Carries `.github/workflows/verify-secret.yml` — see [Verify a sealed-box secret](verify-sealed-box-secret.md). Keep it |

Local clones live under `~/workspaces/reposets/{sandbox-alpha,sandbox-beta,sandbox-gamma,reposets-scratch}`.

Two groups, one profile each, assigning the same resources
(`settings.baseline`, `rulesets.protect-default`, `environments.staging`,
`security.baseline`, `code_scanning.baseline`, and the `campaign` secret
and variable groups) — so any difference in outcome between the two
groups is a difference in **owner type or token**, never in what was
asked for:

| Group | Repos | Profile | Owner |
| --- | --- | --- | --- |
| `sandbox` | the three org repos | `sandbox` | `org = "reposets-sandbox"` |
| `scratch` | `reposets-scratch` | `personal` | `username = "spencerbeggs"` |

`sandbox` additionally enables `cleanup.variables.actions`, so the
cleanup phase has something to delete. The two tokens' reach is
disjoint — the org token cannot see `reposets-scratch` and the personal
token cannot see the org — which is exactly why running both groups is
worth doing: it is the only way to exercise a run under two identities in
one campaign.

Two config values in the active sandbox config were changed for testing
and deliberately never reverted, so their current values are not evidence
of anything: `has_wiki = true` and `query_suite = "extended"`.

[^gitignore]: `../../.gitignore`
