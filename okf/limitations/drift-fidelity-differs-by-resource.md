---
title: Drift fidelity differs by resource
description: Settings, variables and environments compare live values; secrets and rulesets compare only presence, for different reasons
type: Limitation
status: draft
bounds: ../decisions/drift-is-reported-and-still-converged.md
tags:
  - github
  - performance
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 9d97ec69878dd509ef85f380432d24b0e5f2d5a36868def14799321030bd200d
sources:
  - id: secrets-phase
    resource: "../../package/src/sync/phases/secrets.ts"
  - id: rulesets-phase
    resource: "../../package/src/sync/phases/rulesets.ts"
---

# Drift fidelity differs by resource

`decide` compares three fingerprints regardless of resource kind, but the
`livePrint` fed into it is not always a fingerprint of the live value —
two phases substitute a presence check instead, and for different
reasons.

## Value-level: settings, variables, environments

For settings, variables, and environments, the live fingerprint is taken
over what GitHub actually reports for the resource right now. An edit
made outside reposets that changes the value — not just its presence —
is detectable: the live fingerprint no longer matches the applied
baseline, and `decide` reports `Drift`.

## Presence-level: secrets

Secrets cannot be lifted to value-level drift, ever, because GitHub never
returns a secret's value from any endpoint — that is the entire point of
a secret store. A secret edited in the GitHub UI is indistinguishable
from the one reposets wrote: both are unreadable. `secretsPhase` treats
any secret GitHub still lists as present as matching the applied
baseline, on the theory that there is nothing else to compare it
against[^secrets-phase]. What is detectable is a secret that has been
*deleted* — it vanishes from the listing, compares unequal to the
baseline (fingerprinted as `" absent"`), and gets restored. There is no
fix available inside reposets' control: lifting this would require GitHub
to expose secret plaintext, which would defeat the feature.

## Presence-level: rulesets

Rulesets are presence-level too, but for a cost reason rather than an API
limit. `GET /rulesets` returns only summaries — name, id, source type —
not the rules a ruleset actually enforces; reading the full configuration
needs `GET /rulesets/{id}`, one request per ruleset per repository.
`rulesetsPhase` treats a ruleset GitHub still lists by name as matching
the applied baseline and only detects deletion, the same presence
comparison `secrets` uses[^rulesets-phase]. Lifting this is possible and
cheap to wire — only the `livePrint` computation would change, to fetch
each ruleset's full configuration and fingerprint that instead of
assuming presence means match — but it costs one extra GitHub request per
ruleset per repository per sync, and nobody has yet needed value-level
ruleset drift enough to justify it.

[^secrets-phase]: `../../package/src/sync/phases/secrets.ts`
[^rulesets-phase]: `../../package/src/sync/phases/rulesets.ts`
