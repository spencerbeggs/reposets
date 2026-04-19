---
"gh-sync": minor
---

## Features

### Sync command logging with SyncLogger service

A new `SyncLogger` service instruments the entire sync pipeline with structured, tiered output.

- Added a `--log-level` flag to the root `gh-sync` command. Accepted values: `silent`, `info`, `verbose`, `debug`.
- Added a `log_level` field to `gh-sync.config.toml` that sets the default verbosity. The `--log-level` flag overrides it at runtime.
- `info` (default) prints per-group and per-repo summaries with counts of synced resources.
- `verbose` adds per-operation lines showing exactly which secret, variable, or ruleset was created or updated.
- `debug` extends `verbose` output with the source of each resolved value (file path, credential label, or 1Password reference).
- In dry-run mode, all verbs are prefixed with `would` so it is immediately clear no changes were made.
- Errors caught during a sync run are accumulated rather than aborting the run. A final summary is printed after all repos are processed, listing every failure by repo and context.

```text
group: personal (3 repos)
  repo: spencerbeggs/repo-one
    synced  3 secrets (actions)
    synced  2 variables (actions)
    applied settings
  repo: spencerbeggs/repo-two
    error   secrets: Failed to read file for 'DEPLOY_KEY': no such file
Sync complete with 1 error:
  spencerbeggs/repo-two: secrets — Failed to read file for 'DEPLOY_KEY': no such file
```

### Inline ruleset schema — 22 GitHub rule types in TOML

Rulesets are now defined entirely inline in `gh-sync.config.toml` using an Effect Schema that covers all 22 GitHub repository rule types. JSON file references are no longer required.

- Supported rule types: `creation`, `update`, `deletion`, `required_linear_history`, `required_signatures`, `non_fast_forward`, `pull_request`, `required_status_checks`, `required_deployments`, `merge_queue`, `commit_message_pattern`, `commit_author_email_pattern`, `committer_email_pattern`, `branch_name_pattern`, `tag_name_pattern`, `file_path_restriction`, `file_extension_restriction`, `max_file_path_length`, `max_file_size`, `workflows`, `code_scanning`, and `copilot_code_review`.
- Bypass actor `actor_id`, status check `integration_id`, and workflow `repository_id` fields accept either a literal integer or a `{ resolved = "LABEL" }` reference that is substituted from the active credential profile at runtime.
- The top-level config key for repository groups is now `groups` (previously `repos`). Within each group the list of repository names uses the key `repos` (previously `names`).

```toml
[rulesets.branch-protection]
name = "branch-protection"
enforcement = "active"
target = "branch"

[rulesets.branch-protection.conditions.ref_name]
include = ["~DEFAULT_BRANCH"]

[[rulesets.branch-protection.rules]]
type = "pull_request"

[rulesets.branch-protection.rules.parameters]
dismiss_stale_reviews_on_push = true
require_code_owner_review = false
require_last_push_approval = true
required_approving_review_count = 1
required_review_thread_resolution = true
```

### Resolved template system for distributable configs

Config files can now be committed to version control as distributable templates by moving all environment-specific values into the credentials file.

- Credential profiles in `gh-sync.credentials.toml` gain a `[profiles.<name>.resolve]` section with three sub-groups: `op` (1Password references), `file` (file paths), and `value` (inline strings or JSON objects). Each entry is a named label.
- Secret and variable groups in `gh-sync.config.toml` are now typed by kind: `file`, `value`, or `resolved`. A `resolved` group maps secret or variable names to credential labels, indirecting the actual values through the active profile.
- The `ValueResolver` service has been replaced by `CredentialResolver`. It resolves all labels in the active credential profile's `[resolve]` section up front, producing a map used throughout the sync run.
- Ruleset fields that hold GitHub integer IDs (bypass actor IDs, integration IDs, workflow repository IDs) accept `{ resolved = "LABEL" }` to pull the integer at runtime from the credential map.

```toml
# gh-sync.credentials.toml
[profiles.personal]
github_token = "ghp_xxxx"

[profiles.personal.resolve.op]
DEPLOY_TOKEN = "op://Private/deploy-token/credential"

[profiles.personal.resolve.value]
REGISTRY_URL = "https://registry.npmjs.org"
```

```toml
# gh-sync.config.toml — no secrets committed here
[secrets.deploy]
resolved = { DEPLOY_TOKEN = "DEPLOY_TOKEN", REGISTRY_URL = "REGISTRY_URL" }
```
