---
"reposets": patch
---

## Bug Fixes

- `reposets init` now always explains a failed write. `Could not write: <path>` was a log record, so `--log-level none` left a run that exited 1 with no output at all; it is now a failure line on stderr that no log level hides.
- `reposets nuke` now always names a file it could not remove. Under `--log-level none` the `could not remove <path>` lines were hidden while the closing summary still said the failures were listed above; they are now failure lines on stderr.
- `reposets init` now adds to an existing `.gitignore` atomically, so a crash mid-write leaves the old contents or the new, never a truncated file. The file's directory must now be writable: in a read-only directory the run reports `Could not write` and exits 1 and the file is left unchanged.
