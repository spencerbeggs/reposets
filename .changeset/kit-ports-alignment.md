---
"reposets": major
---

## Breaking Changes

### `makeConfigFilesLive` requires `Invocation`

Config discovery now starts from the invocation's working directory instead of reading the process cwd, and a relative `--config` path resolves against that directory. As a result, the layer returned by `makeConfigFilesLive` has `Invocation` in its requirements. `Invocation` is now exported from the package root.

Programs that embed the library must provide it:

```ts
import { Invocation, makeConfigFilesLive } from "reposets";
import { Layer } from "effect";

const ConfigLive = makeConfigFilesLive(undefined).pipe(
  Layer.provide(Invocation.layer({ cwd: process.cwd(), version: "embedded" })),
);
```

The CLI is unaffected: it provides `Invocation` from its entry point.

### `--only` / `--skip` reject unknown phases at parse time

`reposets sync --only` and `--skip` now accept only the known phase names, and the flag parser rejects anything else. The message changes from `Unknown phase name(s): x. Valid phases: …` to the parser's `Invalid value for flag --only: "x". Expected: …`, with help printed on stderr. The exit code is still `64`.

## Features

* A config file that fails to parse now reports its path and a 1-based position, e.g. `reposets.config.toml: TOML parse failed with 1 error: ExpectedTableHeaderClose at 1:8 …`, without the redundant `TomlParseError:` prefix
* `reposets doctor` names the broken file directly from the load failure

## Refactoring

Output now goes through `@effected/cli`'s shared formatters, so wording matches other kit-based CLIs:

* Error lines in `doctor` and `nuke` drop the `Tag: ` prefix, e.g. `could not resolve — Failed…`
* Counts are pluralized properly: `3 warnings found`, `1 profile`
* `history` durations read `1m 3s` and `2s` instead of `1m03s` and `2.0s`
* An unreadable `file:` reference in a secrets or variables group reports the filesystem error, e.g. `NotFound: FileSystem.readFile (/abs/path)`
