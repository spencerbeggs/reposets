---
title: '--config replaces the upward walk'
description: A --config flag swaps out the upward-walk resolver tier rather than being prepended to it, and fails loudly on a missing path.
type: Decision
status: stable
tags: [dx, effect]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 372b305533f742c099193891dc75d2c7fea91a2f001db855539d622a27fad8ae
sources:
  - id: config-files
    resource: ../../package/src/services/ConfigFiles.ts
verified:
  - by: human:spencer
    at: 2026-09-16T15:16:26Z
---

# `--config` replaces the upward walk

## Context

`makeConfigFilesLive(configFlag)` builds the resolver chain for `reposets.config.toml`, and `AppConfig.layer` appends its own XDG tier after whatever tiers this function hands it[^config-files]. With no `--config` flag, the chain is `ConfigResolver.upwardWalk` from the current directory, then XDG[^config-files]. With `--config <file>`, `resolversFor` stats the path: a directory yields `ConfigResolver.staticDir` over it, and anything else yields `ConfigResolver.explicitPath` — either way followed by the same XDG tier[^config-files]. The upward walk is not in the chain at all once a flag is given.

## Decision

A flag naming a path that does not exist fails with `ConfigFlagNotFound` rather than falling through to XDG[^config-files]. `resolversFor` calls `fs.stat` on the flag's value and raises `ConfigFlagNotFound` when it resolves to `Option.None`[^config-files]; that fits the resolver contract only because it is enforced here rather than pushed into `ConfigResolver` itself — every `ConfigResolver` carries `never` in its error channel, which is correct for a probe (try this tier, move on) and wrong for an explicit `--config /nope.toml`, which should fail loudly rather than quietly load whatever XDG config happens to exist[^config-files].

Both `ReposetsConfigFile` and `ReposetsCredentialsFile` decode with `STRICT_KEYS`: `onExcessProperty: "error"` and `errors: "all"`[^config-files]. `onExcessProperty: "error"` turns a typo'd section name or a field removed in a breaking schema change into a rejection instead of a silent no-op; `errors: "all"` collects every rejection in one decode instead of surfacing them one run at a time, so a config with three mistakes is fixed in one pass rather than three[^config-files]. Strictness does not break the `[settings.*]` pass-through, because those keys are absorbed by a `StructWithRest` index signature and are therefore never excess[^config-files]. `discover` propagates a decode failure rather than swallowing it — `sync` and other commands read `configFile.discover.pipe(Effect.result)` and render the structured `issue` on `Failure` rather than reporting "no config found" for a file that is present and one key wrong.

`ReposetsCredentialsFile` uses a separate chain with no `--config` tier at all: `CredentialsFilesLive` is built from `ConfigResolver.upwardWalk({ filename: CREDENTIALS_FILENAME })` alone, plus the XDG tier `AppConfig.layer` appends[^config-files]. `--config` names the *config* file; a credentials file is found next to the project or in the XDG config directory and nowhere else.

## Alternatives rejected

- **Prepending `--config` ahead of the upward walk rather than replacing it.** Would make `--config /nope.toml` silently load whatever config the walk or XDG happened to find, which defeats the purpose of naming a file explicitly.
- **Pushing the missing-path check into the `ConfigResolver` contract.** Every resolver's error channel is `never` by design, matching its role as a best-effort probe; special-casing one tier's failure mode there would break that contract for every other caller.

## Consequences

- The `STRICT_KEYS` docstring in `ConfigFiles.ts` still reads "Applied to credentials only, for now"[^config-files], but `makeConfigFilesLive` passes `STRICT_KEYS` as `parseOptions` for the config file too — both files decode strictly today.
- `discover`'s no-swallow behavior means a caller that wants "no config is fine" must ask for that explicitly (`loadOrDefault`), rather than getting it as a side effect of a broad `Effect.orElseSucceed`.

[^config-files]: `package/src/services/ConfigFiles.ts`
