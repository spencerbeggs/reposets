---
"reposets": minor
---

## Features

### Advanced Security configuration

Sync GitHub Advanced Security settings, vulnerability alert toggles, and CodeQL default setup across reposets. The feature spans three distinct GitHub API surfaces, each with its own config shape.

#### Nested `security_and_analysis` block

Configure secret scanning, push protection, AI detection, non-provider patterns, delegated dismissal/bypass, and Dependabot security updates inside any settings group. Folded into the same `PATCH /repos/{owner}/{repo}` call already used for repository settings.

```toml
[settings.oss-defaults.security_and_analysis]
secret_scanning = "enabled"
secret_scanning_push_protection = "enabled"
secret_scanning_ai_detection = "enabled"
dependabot_security_updates = "enabled"

[[settings.oss-defaults.security_and_analysis.delegated_bypass_reviewers]]
team = "security-team"
mode = "ALWAYS"
```

Team slugs in `delegated_bypass_reviewers` are resolved to numeric reviewer IDs at sync time. Org-only fields are silently skipped on personal repos with a warning.

#### Top-level `[security.*]` groups

Toggle vulnerability alerts, automated security fixes, and private vulnerability reporting. Each maps to a dedicated `PUT`/`DELETE` endpoint and is diffed against current state — only changed values are applied.

```toml
[security.oss-defaults]
vulnerability_alerts = true
automated_security_fixes = true
private_vulnerability_reporting = true
```

#### Top-level `[code_scanning.*]` groups

Configure CodeQL default setup with full enum-validated state, languages, query suite, threat model, and runner. Configured languages are filtered against repository languages detected by GitHub; mismatches are warned and dropped.

```toml
[code_scanning.oss-defaults]
state = "configured"
languages = ["javascript-typescript", "python"]
query_suite = "extended"
threat_model = "remote"
```

Reference both new section types from any group:

```toml
[groups.personal]
repos = ["repo-a", "repo-b"]
security = ["oss-defaults"]
code_scanning = ["oss-defaults"]
```

### License and ownership awareness

Schema accepts every field regardless of repository visibility or GHAS license. At sync time, reposets:

* Detects ownership type once per group via the cached `getOwnerType` API
* Drops org-only fields (`secret_scanning_delegated_alert_dismissal`, `secret_scanning_delegated_bypass`, `delegated_bypass_reviewers`) on personal repos with a logged warning
* Logs warnings on `422`/`403`/`404` errors from GHAS-licensed fields without failing the run
* Filters configured CodeQL languages to those GitHub detects in the repo and warns about the rest

### CLI updates

* `list` summarises `security` and `code_scanning` group references per group
* `validate` rejects unknown `security`/`code_scanning` references with the same error format as other refs
* `doctor` documents the additional fine-grained token permissions required (Code scanning alerts, Dependabot alerts, Secret scanning alerts, Members:read)
* `init` template includes commented-out advanced security examples

## Documentation

* New JSON schema sections for `security_and_analysis` (nested in settings groups), `[security.*]`, and `[code_scanning.*]` with `(GHAS-licensed)` and `(org-only)` annotations on relevant fields
* CodeQL default-setup language enum constrained to GitHub's nine accepted values; Rust support deferred until GitHub adds it
