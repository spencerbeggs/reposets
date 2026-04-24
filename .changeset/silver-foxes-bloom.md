---
"reposets": minor
---

## Features

- Added `makeConfigFilesLive(configFlag)` factory function that builds a declarative `xdg-effect` resolver chain from the `--config` CLI flag. When the flag points to a directory, a `StaticDir` resolver is prepended; when it points to a file, an `ExplicitPath` resolver is prepended. Both cases fall through to `UpwardWalk` and `XdgConfigResolver` as standard fallbacks. Each CLI command now calls `makeConfigFilesLive` directly rather than sharing a single global layer, so the config flag is correctly scoped per command.

- Added `validateConfigRefs(config)` callback that validates all internal cross-references in a parsed config file. It checks that every group's `settings`, `secrets`, `variables`, `rulesets`, and `environments` references point to defined top-level sections, and that environment-scoped secret/variable groups reference defined environments. All errors are collected into a single `ConfigError` rather than failing on the first mismatch. This callback is wired in as the `validate` option on the config spec so it runs automatically on every load.

- Exported `CONFIG_FILENAME` and `CREDENTIALS_FILENAME` constants from the public package index so consumers do not need to hard-code the canonical filenames.

- Exported `makeConfigFilesLive` and `validateConfigRefs` from the public package index, replacing the now-removed `resolveConfigFlag` and `loadConfigWithDir` exports.

## Dependencies

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| `xdg-effect` | dependency | updated | `^0.3.3` | `^1.0.0` |

## Refactoring

- Upgraded to `xdg-effect` v1.0.0 ergonomic API throughout. `XdgConfigLive` is now called as `XdgConfigLive.multi` with a single `configs` array, `XdgConfig` resolver references are replaced with `XdgConfigResolver`, and `ConfigError as XdgConfigError` aliasing is no longer needed.

- All CLI commands (`sync`, `validate`, `list`, `doctor`, `init`, `credentials`) replaced `Console.log` / `Console.error` calls with `Effect.log` / `Effect.logError`. A `CliLogger` is installed at the root entrypoint that routes `Effect.log` to `console.log` and log levels at or above `Error` to `console.error`, keeping observable output identical while flowing through the structured Effect logging pipeline.

- The `generate-json-schema.ts` build script now uses the singular `generate` / `validate` / `write` API from `xdg-effect` v1.0.0 instead of the previous multi-step pattern.
