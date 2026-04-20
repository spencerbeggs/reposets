---
"repo-sync": patch
---

## Documentation

- Added comprehensive user-facing documentation across 12 new Markdown files: `README.md`, `package/README.md`, `CONTRIBUTING.md`, and nine pages under `docs/` covering commands, configuration, credentials, secrets and variables, rulesets, environments, cleanup, and token permissions.

## Maintenance

- Renamed the project from `gh-sync` to `repo-sync` throughout the codebase: npm package name, CLI binary (`repo-sync`), config filenames (`repo-sync.config.toml`, `repo-sync.credentials.toml`), XDG config directory, GitHub Packages scope, all source files, tests, generated JSON schemas, and design docs.
- Removed stale plan and spec files from `.claude/plans/` and `.claude/specs/` that covered the earlier redesign phase.
