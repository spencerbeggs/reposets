---
module: gh-sync
title: Configuration Format
status: current
completeness: 95
last-synced: 2026-04-18
---

## Files

| File | Purpose | Location |
| :--- | :------ | :------- |
| `gh-sync.config.toml` | Repos, settings, secrets, variables, rulesets, cleanup | XDG or project-local |
| `gh-sync.credentials.toml` | Named credential profiles (gitignored) | XDG config dir |

## Config Path Resolution

Resolution order (first match wins):

1. `--config` flag (directory or file path)
2. Walk up from cwd looking for `gh-sync.config.toml`
3. `$XDG_CONFIG_HOME/gh-sync/` or `~/.config/gh-sync/`

File references (e.g., `file = "./rulesets/workflow.json"`) resolve relative
to the directory containing `gh-sync.config.toml`.

## Config Structure

```toml
owner = "spencerbeggs"

[settings.default]
has_wiki = false

[secrets.deploy]
NPM_TOKEN = { file = "./private/NPM_TOKEN" }
API_KEY = { op = "op://vault/item/field" }

[variables.common]
NODE_ENV = { value = "production" }

[rulesets.standard]
workflow = { file = "./rulesets/workflow.json" }

[cleanup]
secrets = true
variables = true

[repos.my-projects]
names = ["repo-one", "repo-two"]
settings = ["default"]
secrets = { actions = ["deploy"], dependabot = ["deploy"] }
variables = { actions = ["common"] }
rulesets = ["standard"]
```

## Value Source Model

All secrets, variables, and rulesets use a uniform value resolution model.
Each entry maps to exactly one source type:

- `{ file = "path" }` - read from disk relative to config dir
- `{ value = "string" }` - inline string
- `{ json = { key = "val" } }` - TOML object serialized to JSON string
- `{ op = "op://vault/item/field" }` - resolved via 1Password SDK

## Secret Scopes

Scoping is at the repo group level, not the secret definition:

- `actions` - GitHub Actions repository secrets
- `dependabot` - Dependabot secrets
- `codespaces` - Codespaces secrets

The same secret group can be assigned to different scopes on different
repo groups.

## Credentials

```toml
[profiles.personal]
github_token = "ghp_..."
op_service_account_token = "ops_..."
```

If only one profile exists, it is used implicitly. Multiple profiles are
referenced by name from repo groups via `credentials = "profile-name"`.

## JSON Schema Generation

Effect Schema definitions generate JSON schemas via `JSONSchema.make()`.
The generation script (`package/lib/scripts/generate-json-schema.ts`):

1. Generates schemas from Effect Schema definitions
2. Inlines the root `$ref` so Tombi can read root-level properties
3. Adds `x-tombi-toml-version` at the root
4. Outputs to `package/schemas/`

Tombi annotations are defined inline on schemas via `jsonSchema: { ... }`
annotation property. Standard annotations (title, description, examples,
default) are also set on all fields.
