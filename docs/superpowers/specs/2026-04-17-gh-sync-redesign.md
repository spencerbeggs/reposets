# gh-sync Redesign Specification

## Overview

Redesign of the github-repo-sync CLI tool into gh-sync -- a composable,
Effect-based CLI for syncing GitHub repository settings, secrets, variables,
and rulesets across personal repos. Targets individual developers managing
repos outside GitHub Organization accounts.

## Goals

- Migrate CLI framework from Commander.js to @effect/cli
- Define config schema with Effect Schema, generate JSON Schema for Tombi
  TOML LSP completion
- Switch config format from JSON to TOML
- Store config in XDG-compliant locations with home directory fallback
- Enable composable config groups that can be mixed and matched across repo
  groups
- Integrate 1Password SDK for programmatic secret resolution alongside
  existing file/value/JSON sources

## Config File Structure

Two config files stored in XDG config directory:

- `gh-sync.config.toml` -- declarative repo definitions (safe to commit/sync)
- `gh-sync.credentials.toml` -- auth tokens (gitignored, stays local)

### Config Path Resolution

Resolution order (first match wins):

1. CLI `--config` flag -- overrides all other resolution. Accepts either a
   directory (containing gh-sync.config.toml and gh-sync.credentials.toml)
   or a direct path to a gh-sync.config.toml file (gh-sync.credentials.toml
   is expected in the same directory).
2. Directory walk -- starting from cwd, walk up parent directories looking
   for gh-sync.config.toml. Stops at the first match. This finds
   project-local configs created with `init --project`.
3. `$XDG_CONFIG_HOME/gh-sync/` if XDG_CONFIG_HOME is set.
4. `~/.config/gh-sync/` as fallback.

File references in gh-sync.config.toml (e.g., `file = "./rulesets/workflow.json"`)
resolve relative to the directory containing gh-sync.config.toml.

### gh-sync.config.toml

```toml
owner = "spencerbeggs"

# --- Settings groups ---
[settings.oss-defaults]
has_wiki = false
has_issues = true
has_projects = true
delete_branch_on_merge = true
allow_squash_merge = true
squash_merge_commit_title = "PR_TITLE"
squash_merge_commit_message = "BLANK"

[settings.private]
has_wiki = false
has_issues = false

# --- Secret groups ---
# Each secret: { file, value, json, or op }
[secrets.deploy]
NPM_TOKEN = { op = "op://Private/npm-token/credential" }
CUSTOM_REGISTRIES = { json = { "github" = "https://npm.pkg.github.com" } }

[secrets.app]
APP_ID = { value = "123456" }
APP_PRIVATE_KEY = { file = "./private/APP_PRIVATE_KEY" }

# --- Variable groups ---
# Same value shapes as secrets, actions scope only (for now)
[variables.common]
NODE_ENV = { value = "production" }
SBOM = { file = "./private/sbom.json" }

# --- Ruleset groups ---
# Same value shapes: file refs to JSON, inline json, or op
[rulesets.standard]
workflow = { file = "./rulesets/workflow.json" }
release = { file = "./rulesets/release.json" }

# --- Cleanup defaults ---
[cleanup]
secrets = true
variables = true
dependabot_secrets = false
codespaces_secrets = false
rulesets = true

[cleanup.preserve]
secrets = ["LEGACY_TOKEN"]

# --- Repo groups ---
[repos.oss-projects]
names = ["repo-one", "repo-two", "repo-three"]
settings = ["oss-defaults"]
secrets = { actions = ["deploy"], dependabot = ["deploy"], codespaces = ["deploy"] }
variables = { actions = ["common"] }
rulesets = ["standard"]

[repos.private-work]
owner = "savvy-web"
names = ["work-repo"]
credentials = "work"
settings = ["private"]
secrets = { actions = ["deploy", "app"], dependabot = ["deploy"] }
variables = { actions = ["common"] }
rulesets = ["standard"]
cleanup = { rulesets = false }
```

### gh-sync.credentials.toml

```toml
[profiles.personal]
github_token = "ghp_..."
op_service_account_token = "ops_..."

[profiles.work]
github_token = "ghp_..."
op_service_account_token = "ops_..."
```

If only one profile is defined, it is used implicitly for all repo groups
without requiring `credentials = "profile-name"` on each group.

## Value Source Model

All secrets, variables, and rulesets use a uniform value resolution model.
Each named entry maps to one of four source types:

- `file` -- path to a file, resolved relative to gh-sync.config.toml directory.
  Contents read as string.
- `value` -- inline string, passed through directly.
- `json` -- inline TOML object, serialized to JSON string via
  JSON.stringify.
- `op` -- 1Password secret reference (`op://vault/item/field`), resolved at
  runtime via the 1Password SDK using the credential profile's service
  account token.

Exactly one source key must be present per entry. The schema enforces this
as a tagged union.

## Secret Scopes

GitHub has three secret scopes:

- `actions` -- repository action secrets
- `dependabot` -- Dependabot secrets
- `codespaces` -- Codespaces secrets (new addition)

Variables currently only have `actions` scope, but the config uses object
syntax (`variables = { actions = [...] }`) to support future environment
variable scopes.

Scoping is declared at the repo group level, not on the secret definitions
themselves. The same secret group can be synced to different scopes on
different repo groups.

## Owner Resolution

Top-level `owner` field provides the default. Repo groups can override with
their own `owner` field. Users are responsible for ensuring the credential
profile's GitHub token has access to the specified owner's repos.

## Cleanup

Top-level `[cleanup]` block defines defaults for all repo groups:

- Per-resource-type booleans: `secrets`, `variables`, `dependabot_secrets`,
  `codespaces_secrets`, `rulesets`
- `preserve` sub-table with arrays of names to never delete

Repo groups can override cleanup settings. The override merges with defaults
-- a group-level `cleanup = { rulesets = false }` disables ruleset cleanup
for that group while inheriting other defaults.

Cleanup only deletes resources with `source_type = "Repository"` (preserves
organization-level rulesets).

## Effect Schema Definitions

### Schema Hierarchy

```text
ConfigSchema
  owner: string (optional)
  settings: Record<string, SettingsGroupSchema>
  secrets: Record<string, SecretsGroupSchema>
  variables: Record<string, VariablesGroupSchema>
  rulesets: Record<string, RulesetsGroupSchema>
  cleanup: CleanupSchema
  repos: Record<string, RepoGroupSchema>

CredentialsSchema
  profiles: Record<string, CredentialProfileSchema>
```

### ValueSourceSchema

Tagged union shared across secrets, variables, and rulesets:

```typescript
const ValueSourceSchema = Schema.Union(
  Schema.Struct({ file: Schema.String }),
  Schema.Struct({ value: Schema.String }),
  Schema.Struct({
    json: Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }),
  }),
  Schema.Struct({ op: Schema.String }),
)
```

### SecretsGroupSchema / VariablesGroupSchema / RulesetsGroupSchema

All are `Record<string, ValueSourceSchema>` -- each key is the resource
name, each value is a source.

### RepoGroupSchema

```typescript
Schema.Struct({
  owner: Schema.optional(Schema.String),
  names: Schema.Array(Schema.String),
  credentials: Schema.optional(Schema.String),
  settings: Schema.optional(Schema.Array(Schema.String)),
  secrets: Schema.optional(Schema.Struct({
    actions: Schema.optional(Schema.Array(Schema.String)),
    dependabot: Schema.optional(Schema.Array(Schema.String)),
    codespaces: Schema.optional(Schema.Array(Schema.String)),
  })),
  variables: Schema.optional(Schema.Struct({
    actions: Schema.optional(Schema.Array(Schema.String)),
  })),
  rulesets: Schema.optional(Schema.Array(Schema.String)),
  cleanup: Schema.optional(CleanupSchema),
})
```

### JSON Schema Generation

A build script runs `JSONSchema.make(ConfigSchema)` and
`JSONSchema.make(CredentialsSchema)`, outputting JSON Schema files. Users
configure Tombi to point at these schemas for TOML completion in their
editor.

## Effect Service Architecture

Five core services, each a Context.Tag with Live and Test layer
implementations.

### ConfigLoader

Loads and validates both config files.

- `loadConfig(path?: string): Effect<Config, ConfigError>`
- `loadCredentials(path?: string): Effect<Credentials, CredentialsError>`
- Dependencies: filesystem (@effect/platform)

### ValueResolver

Resolves file/value/json/op sources to string values.

- `resolve(source: ValueSource, basePath: string): Effect<string, ResolveError>`
- For `file`: read from disk relative to basePath
- For `value`: pass through
- For `json`: JSON.stringify the object
- For `op`: delegate to OnePasswordClient
- Dependencies: OnePasswordClient, filesystem

### OnePasswordClient

Wraps 1Password SDK.

- `resolve(reference: string, serviceAccountToken: string): Effect<string, OnePasswordError>`
- Live implementation uses @1password/sdk
- Test implementation returns deterministic stub values
- No service dependencies (token passed as parameter)

### GitHubClient

Wraps Octokit.

- Sync methods: syncSecrets, syncVariables, syncSettings, syncRulesets
- Query methods: listSecrets, listVariables, listRulesets
- Delete methods: deleteSecret, deleteVariable, deleteRuleset
- Includes encryptSecret (NaCl sealed box encryption)
- Constructed with a token; different credential profiles yield different
  instances
- No service dependencies (token passed at construction)

### SyncEngine

Orchestrates the full sync workflow.

- `syncRepoGroup(group: ResolvedRepoGroup): Effect<SyncResult, SyncError>`
- `syncAll(config: Config, credentials: Credentials): Effect<SyncReport, SyncError>`
- Resolves credential profile per group
- Resolves all value sources for the group's secrets/variables/rulesets
- Calls GitHubClient for each repo in the group
- Runs cleanup phase
- Handles dry-run by skipping mutating calls
- Dependencies: GitHubClient, ValueResolver, ConfigLoader

### Layer Composition Per Repo Group

```text
ConfigLoader (singleton)
  -> reads config + credentials
    -> per repo group:
      -> OnePasswordClient (with group's OP token)
      -> ValueResolver (with OnePasswordClient)
      -> GitHubClient (with group's GitHub token)
      -> SyncEngine (with all of the above)
```

### Error Types (TaggedError)

- ConfigError -- invalid TOML, schema validation failure, file not found
- CredentialsError -- missing credentials file, missing profile
- ResolveError -- file not found, OP resolution failed, invalid JSON
- GitHubApiError -- API call failures, auth failures, rate limiting
- SyncError -- orchestration-level failures (missing group references)

## CLI Commands

Binary name: `gh-sync`. Built with @effect/cli.

### Command Tree

```text
gh-sync
  sync [options]            sync repos with GitHub
  list                      show config summary
  validate                  validate config without API calls
  doctor                    deep config diagnostics with typo detection
  init                      scaffold config files
  credentials
    create                  add a credential profile
    list                    list profiles (tokens redacted)
    delete                  remove a profile
```

### sync

- `--config <path>` -- override gh-sync.config.toml location
- `--group <name>` -- sync only a specific repo group
- `--repo <name>` -- sync only a specific repo (within its group)
- `--dry-run` -- preview changes, no mutations
- `--no-cleanup` -- skip cleanup phase

### list

- `--config <path>` -- override gh-sync.config.toml location
- Outputs repo groups with their referenced settings, secrets, variables,
  rulesets, resolved owner, and credential profile

### validate

- `--config <path>` -- override gh-sync.config.toml location
- Parses both gh-sync.config.toml and gh-sync.credentials.toml
- Validates schema compliance
- Checks that all references resolve: secret groups exist, credential
  profiles exist, file paths exist
- Does not call the GitHub API

### init

- `--project` -- create config files in the current working directory
  instead of the XDG/home location. Appends gh-sync.credentials.toml to the
  project's existing .gitignore (creates one if missing).
- Without `--project` (default): creates files in the XDG/home config
  directory and adds a .gitignore file to that directory containing
  `gh-sync.credentials.toml`.
- Creates gh-sync.config.toml with commented example structure
- Creates empty gh-sync.credentials.toml with comments

### doctor

- `--config <path>` -- override gh-sync.config.toml location
- Runs all validate checks (schema compliance, reference integrity)
- Additionally flags unknown keys that TOML parsed but the schema does not
  recognize (typos like `has_wikis` instead of `has_wiki`, or keys that are
  not valid GitHub API settings parameters)
- Reports warnings with suggestions for likely intended keys when possible
  (e.g., "unknown key 'has_wikis' in settings.oss-defaults -- did you mean
  'has_wiki'?")
- Uses Effect Schema's excess property checking to detect unrecognized
  fields

### credentials create

- `--profile <name>` -- profile name (required)
- `--github-token <token>` -- GitHub PAT
- `--op-token <token>` -- 1Password service account token (optional)
- Errors if profile name already exists

### credentials list

- Shows profiles with tokens redacted (e.g., `ghp_...7f3a`)

### credentials delete

- `--profile <name>` -- profile to remove

## Package Structure

Package stays in `package/` directory. Package name changes to
`@spencerbeggs/gh-sync`. GitHub repo renamed to `spencerbeggs/gh-sync`.

```text
package/
  src/
    index.ts                       public API exports
    cli/
      index.ts                     entry point, root command, NodeRuntime
      commands/
        sync.ts
        list.ts
        validate.ts
        doctor.ts
        init.ts
        credentials.ts             create, list, delete subcommands
    schemas/
      config.ts                    ConfigSchema, RepoGroupSchema
      credentials.ts               CredentialsSchema, ProfileSchema
      common.ts                    ValueSourceSchema, CleanupSchema
    services/
      ConfigLoader.ts
      ValueResolver.ts
      OnePasswordClient.ts
      GitHubClient.ts
      SyncEngine.ts
    lib/
      xdg.ts                       XDG directory resolution
      crypto.ts                    NaCl sealed box encryption
    errors.ts                      TaggedError definitions
  __test__/
    schemas/
    services/
    commands/
    lib/
  lib/
    scripts/
      generate-json-schema.ts
```

### Dependencies

Added:

- effect, @effect/cli, @effect/platform, @effect/platform-node
- smol-toml
- @1password/sdk

Kept:

- @octokit/rest
- tweetnacl, blakejs

Removed:

- commander
- dotenv

## Testing Strategy

### Unit Tests

No network, no filesystem access:

- Schemas -- decode valid/invalid TOML-parsed objects, verify validation
  catches bad config shapes
- ValueResolver -- test each source type with mock OnePasswordClient layer;
  file uses @effect/platform test filesystem; value and json are pure
  transforms; op delegates to mock
- SyncEngine -- mock GitHubClient and ValueResolver layers; verify correct
  API calls for each resource type/scope combination; verify cleanup logic
  respects preserve lists and per-group overrides; verify dry-run skips
  mutations
- crypto.ts -- verify NaCl sealed box encryption produces valid output
- xdg.ts -- verify env var resolution and fallback paths

### Integration Tests

Marked `.int.test.ts`:

- Full config load from TOML files on disk
- Value resolution with real file reads (no OP)
- End-to-end command parsing through @effect/cli

### Mock Layers

- GitHubClientTest -- records API calls, returns canned responses
- OnePasswordClientTest -- returns deterministic values for known op://
  references
- ConfigLoaderTest -- returns in-memory config objects

## Migration Path

This is a greenfield rewrite of a working tool. Recommended build order:

1. Schemas + config loading (TOML parsing, XDG resolution, validation)
2. CLI skeleton with @effect/cli (commands parse but do nothing)
3. ValueResolver + OnePasswordClient services
4. GitHubClient service (port existing Octokit/encryption logic)
5. SyncEngine (orchestration, cleanup, dry-run)
6. Wire CLI commands to services
7. JSON Schema generation script
8. Credentials management commands
