---
"reposets": major
---

## Breaking Changes

### Exit codes distinguish usage errors from findings

The CLI now runs on `@effected/cli`, and its exit codes follow one contract:

| Code | Meaning |
| :--- | :--- |
| `0` | Success. `doctor` always exits `0`; use `validate` as the gate. |
| `1` | A finding: an invalid or missing config, a dangling reference, an undeclared credential label, an org-only violation, sync errors, drift, or a file `init`/`nuke` could not write or remove. |
| `64` | A usage error (`EX_USAGE`): a parse failure, an unknown subcommand, flag, `--only`/`--skip` phase or `--group`, a `history show` with no or an ambiguous match, `nuke` refused without `--force` in a non-interactive shell, or a refused `credentials create`/`delete`. |

Changes from 1.x:

- Usage errors exit `64` instead of `1`. Help printed alongside a usage error now goes to stderr.
- `credentials create` refusals and `credentials delete` of a missing profile exit `64` instead of `0`.
- `list` with no config found exits `1` instead of `0`.
- `nuke` and `init` exit `1` when a file cannot be removed or written, instead of `0`. `init` also reports a failed `.gitignore` write it previously skipped silently.

**Migration:** a script that tests for `$? -eq 1` to detect a bad invocation should test for `64`. A script that only tests for non-zero needs no change.

### Command output on stdout, diagnostics on stderr

Command results — `validate`, `list`, `doctor`, `history`, `credentials`, `init`, `nuke`, and the `sync`/`drift` report — are written to stdout. Every diagnostic, progress line and error is written to stderr. `--log-level` now filters only those stderr diagnostics and no longer silences command output.

**Migration:** replace `--log-level error` or `--log-level none` with a redirect:

```bash
reposets sync > /dev/null        # quiet on success, errors still shown
reposets sync > /dev/null 2>&1   # nothing printed; rely on the exit code
```

### Empty environment credentials are rejected

An `{ env = "VAR" }` credential whose variable is set to an empty string now fails with "environment variable VAR is not set" instead of resolving to an empty token that GitHub later rejects.

## Features

- A config that fails validation reports one `unknown key at <path>` line per issue on stderr, with a hint to run `reposets doctor` when a key is misspelled. This now applies to `sync` and `drift` as well as `validate`.

## Bug Fixes

- `reposets doctor` now prints the real package version instead of `0.0.0 (dev build)`.
