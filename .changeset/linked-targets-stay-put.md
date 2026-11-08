---
"reposets": patch
---

## Bug Fixes

* `init` no longer writes through a symlink. A dangling link at `reposets.config.toml` or `reposets.credentials.toml` is replaced by the scaffolded file instead of creating a file wherever it points. A `.gitignore` that is a symlink is left alone, neither read nor written, and `init` warns that the credentials file was not added to it.
