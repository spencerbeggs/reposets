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
| `gh-sync.config.toml` | Groups, settings, secrets, variables, rulesets, cleanup | XDG or project-local |
| `gh-sync.credentials.toml` | Named credential profiles with resolve sections (gitignored) | XDG config dir |

## Config Path Resolution

Resolution order (first match wins):

1. `--config` flag (directory or file path)
2. Walk up from cwd looking for `gh-sync.config.toml`
3. `$XDG_CONFIG_HOME/gh-sync/` or `~/.config/gh-sync/`

File references in `file`-kind groups resolve relative to the directory
containing `gh-sync.config.toml`.

## Config Structure

```toml
owner = "spencerbeggs"
log_level = "info"

[settings.default]
has_wiki = false

[secrets.deploy.file]
NPM_TOKEN = "./private/NPM_TOKEN"

[secrets.api.resolved]
API_KEY = "SILK_API_KEY"

[variables.turbo.value]
NODE_ENV = "production"
DO_NOT_TRACK = "1"

[variables.bot.resolved]
BOT_NAME = "SILK_BOT_NAME"

[rulesets.branch-protection]
name = "branch-protection"
enforcement = "active"
target = "branch"

[rulesets.branch-protection.conditions.ref_name]
include = ["~DEFAULT_BRANCH"]

[[rulesets.branch-protection.rules]]
type = "pull_request"

[rulesets.branch-protection.rules.parameters]
required_approving_review_count = 1
dismiss_stale_reviews_on_push = false
require_code_owner_review = false
require_last_push_approval = false
required_review_thread_resolution = false

[[rulesets.branch-protection.rules.parameters.required_status_checks]]
context = "CI"
integration_id = { resolved = "SILK_APP_ID" }

[cleanup]
secrets = true
variables = true

[groups.my-projects]
repos = ["repo-one", "repo-two"]
settings = ["default"]
secrets = { actions = ["deploy", "api"], dependabot = ["deploy"] }
variables = { actions = ["turbo", "bot"] }
rulesets = ["branch-protection"]
```

## Resource Group Model

Secret and variable groups are discriminated by kind. Each group is
exactly one kind, determined by its sub-key:

- `{ file = { NAME = "path" } }` - read from disk relative to config dir
- `{ value = { NAME = "string" } }` - inline; strings as-is, TOML tables
  JSON-stringified
- `{ resolved = { NAME = "LABEL" } }` - map names to credential labels
  from the active profile's `[resolve]` section

Rulesets are defined inline as typed TOML tables (see Ruleset Schema).
Integer fields in rulesets accept `{ resolved = "LABEL" }` for runtime
substitution.

## Ruleset Schema

Rulesets are defined directly in TOML covering all 22 GitHub rule types:
`creation`, `update`, `deletion`, `required_linear_history`,
`required_signatures`, `non_fast_forward`, `pull_request`,
`required_status_checks`, `required_deployments`, `merge_queue`,
`commit_message_pattern`, `commit_author_email_pattern`,
`committer_email_pattern`, `branch_name_pattern`, `tag_name_pattern`,
`file_path_restriction`, `file_extension_restriction`,
`max_file_path_length`, `max_file_size`, `workflows`, `code_scanning`,
`copilot_code_review`.

Fields `actor_id`, `integration_id`, and `repository_id` accept either
a static integer or `{ resolved = "LABEL" }`.

## Secret Scopes

Scoping is at the group level, not the secret definition:

- `actions` - GitHub Actions repository secrets
- `dependabot` - Dependabot secrets
- `codespaces` - Codespaces secrets

The same secret group can be assigned to different scopes on different
groups.

## Credentials

```toml
[profiles.personal]
github_token = "ghp_..."
op_service_account_token = "ops_..."

[profiles.personal.resolve.op]
SILK_APP_ID = "op://vault/item/field"

[profiles.personal.resolve.file]
DEPLOY_KEY = "./private/deploy.key"

[profiles.personal.resolve.value]
BOT_NAME = "mybot[bot]"
REGISTRIES = { npm = "https://registry.npmjs.org" }
```

If only one profile exists, it is used implicitly. Multiple profiles are
referenced by name from groups via `credentials = "profile-name"`.

The `[resolve]` section defines named labels in three sub-groups:
`op` (1Password references), `file` (file paths), `value` (inline
strings or objects). All three contribute to a flat namespace of
labels referenced by config templates.

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
