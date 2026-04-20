---
"repo-sync": minor
---

## Features

- Rewrote CLI from Commander.js to `@effect/cli`, adding six commands: `sync`, `list`, `validate`, `doctor`, `init`, and `credentials` (with `create`, `list`, and `delete` subcommands).
- Replaced the JSON config format with TOML. Config now lives in `repo-sync.config.toml` and credentials in `repo-sync.credentials.toml`.
- Introduced composable named resource groups — settings, secrets, variables, and rulesets are defined as named groups and assigned to named repo groups, allowing the same group to be reused across multiple sets of repositories.
- Added per-scope secret assignment: secrets groups can be assigned independently to `actions`, `dependabot`, and `codespaces` scopes within each repo group.
- Integrated the 1Password SDK for resolving `op://` secret references at runtime, enabling secrets to be pulled directly from a 1Password vault without storing plaintext values locally.
- Added XDG config path resolution (`$XDG_CONFIG_HOME/repo-sync/`) with a directory-walk fallback that searches parent directories from cwd, mirroring the lookup strategy used by tools like `git` and `eslint`.
- Added JSON Schema generation for both config files, annotated with `x-tombi-*` hints for TOML LSP completion and key ordering in editors that support the Tombi language server.
- Added credential profiles in `repo-sync.credentials.toml` for multi-account support. Each profile holds a GitHub fine-grained token and an optional 1Password service account token. A repo group can reference a named profile; if only one profile exists it is selected automatically.
- Added a `cleanup` configuration block (global and per repo group) that controls deletion of secrets, variables, Dependabot secrets, Codespaces secrets, and rulesets not declared in config, with per-resource `preserve` lists to protect named resources from deletion.

### Value sources

Every secret, variable, and ruleset entry accepts one of four value source shapes:

```toml
# Inline string
MY_SECRET = { value = "literal" }

# File path (resolved relative to config dir)
MY_SECRET = { file = "./private/my-secret.txt" }

# Inline JSON object (serialized before upload)
MY_SECRET = { json = { registry = "https://registry.npmjs.org" } }

# 1Password reference (resolved via SDK at runtime)
MY_SECRET = { op = "op://Private/npm-token/credential" }
```

### Minimal config example

```toml
owner = "spencerbeggs"

[repos.personal]
names = ["repo-one", "repo-two"]
secrets.actions = ["deploy"]
rulesets = ["standard"]

[secrets.deploy]
DEPLOY_TOKEN = { op = "op://Private/deploy-token/credential" }

[rulesets.standard]
branch-protection = { file = "./rulesets/branch-protection.json" }
```
