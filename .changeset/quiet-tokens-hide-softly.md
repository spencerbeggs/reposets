---
"reposets": minor
---

## Features

### `REPOSETS_SPANS` environment variable

Controls the span trail printed on failure reports. Values (case-insensitive):

* `app` (default) — show only reposets' own spans; the CLI kit's internal spans are now hidden
* `all` — show every span, including the kit's internals
* `off` — omit the span trail

```bash
REPOSETS_SPANS=all reposets sync
```

## Bug Fixes

### Credential safety

* `reposets credentials create` masks the reference prompt while a token-looking value is typed or pasted. Real `op://` references and environment variable names stay readable, and once masked the field stays masked until it is cleared.
* Token detection is stricter: a token embedded inside a value (for example `op://Vault/ghp_…/field`) and a bare 40-character hex legacy GitHub classic token are now refused on both flags and prompts instead of being stored and echoed. Ordinary names such as `devops_team` are still accepted.

### Output

* `sync` failure lines, including the indented per-repo error lines, now carry a coloured ✗ for people (plain text for agents).
* Human output piped to a file or another program is no longer wrapped at 80 columns.
* Sync progress counters pluralise correctly (`1/1 repo`, `1/3 repos`).
