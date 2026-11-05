---
"reposets": patch
---

## Bug Fixes

- `reposets init` now always explains a failed write. `Could not write: <path>` was a log record, so `--log-level none` left a run that exited 1 with no output at all; it is now a failure line on stderr that no log level hides.
- `reposets nuke` now always names a file it could not remove. Under `--log-level none` the `could not remove <path>` lines were hidden while the closing summary still said the failures were listed above; they are now failure lines on stderr.
- `reposets init` now writes every file atomically, so a crash leaves an existing `.gitignore`'s old contents or the new, never a truncated file, and never a partial new file that later runs would report as `Already exists`. The file's directory must now be writable: in a read-only directory the run reports `Could not write` and exits 1 and an existing `.gitignore` is left unchanged.
- `reposets credentials create` and `credentials delete` now report a credentials file they cannot write as one line, `Could not write: <path> — <reason>`, with exit 1, instead of the raw `ConfigFileWriteError`.
