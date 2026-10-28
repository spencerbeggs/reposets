---
"reposets": patch
---

## Bug Fixes

* Passing a single-valued flag more than once, such as `reposets sync --group a --group b`, is now a usage error that exits 64. Previously the first value was silently kept and the rest ignored. Pass the flag once, or use a flag that accepts multiple values.
