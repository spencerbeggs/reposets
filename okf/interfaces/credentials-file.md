---
title: reposets.credentials.toml
description: The gitignored TOML file naming credential profiles, token references, and resolved value labels.
type: Interface
kind: config
resource: ../../package/src/schemas/credentials.ts
tags: [security, github]
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 7acd04e1668513ea9196bf31f637eb3495af816dbb3ef17a8c1a5631e1d98cab
sources:
  - id: credentials-schema
    resource: ../../package/src/schemas/credentials.ts
  - id: credential-resolver
    resource: ../../package/src/services/CredentialResolver.ts
---

# reposets.credentials.toml

## Contract

`reposets.credentials.toml` holds `[profiles.<name>]` tables, each naming
exactly one of `username` or `org` (mutually exclusive — declaring both,
or neither, is a decode error), a `github_token` reference, an optional
`op_service_account`, and an optional `[resolve]` section[^credentials-schema]:

```toml
[profiles.personal]
username = "spencerbeggs"
github_token = { op = "op://Private/github/token" }

[profiles.personal.resolve.op]
SILK_APP_ID = "op://vault/item/field"

[profiles.personal.resolve.file]
DEPLOY_KEY = "./private/deploy.key"

[profiles.personal.resolve.value]
BOT_NAME = "mybot[bot]"
REGISTRIES = { npm = "https://registry.npmjs.org" }

[profiles.sandbox]
org = "reposets-sandbox"
github_token = { env = "GITHUB_TOKEN" }
```

`github_token` is a *reference*, never a value: `CredentialSourceSchema`
is a union of exactly `{ op = "op://..." }` (a 1Password reference,
resolved through the 1Password SDK at run time) or `{ env = "VAR_NAME" }`
(an environment variable, for CI where no 1Password service account is
available)[^credentials-schema]. `op_service_account` is likewise an
`{ env }` reference — the 1Password service-account token itself always
comes from the `OP_SERVICE_ACCOUNT_TOKEN` environment variable, never from
a field in this file.

`[profiles.<name>.resolve]` defines named labels in four sub-groups — `op`
(1Password references), `env` (environment variable names), `file` (file
paths) and `value` (inline strings or JSON-serializable objects) — that
all contribute to **one flat label namespace**[^credentials-schema]. A
`{ resolved = "LABEL" }` reference anywhere in `reposets.config.toml` (a
`resolved`-kind secret or variable group, a ruleset's `default_integration_id`,
an `actor_id`, an `integration_id`, a `repository_id`) looks up that label
against whichever sub-group produced it, without needing to know which one
that was. `resolve.file` paths resolve relative to the directory holding
`reposets.config.toml`, the same base path used for `{ file }`-kind
secret and variable groups.

Every resolved value — the token and every `[resolve]` label — comes back
as `Redacted.Redacted<string>` from `CredentialResolver`, never a plain
string[^credential-resolver].

## Discovery

Credentials use their own resolver chain: an upward walk from the current
working directory for `reposets.credentials.toml`, then the XDG config
directory. There is **no `--config` tier** for this file — that flag
names the config file, and a credentials file is found only next to the
project or in the XDG config directory.

## Keeping it out of version control

No credential is ever written to this file — `github_token` is a
reference and the 1Password service-account token is not in the schema at
all. `resolve.value` can still hold an inline value, because that
sub-group serves named values generally and a common use is structured,
non-secret data such as a registry list; the file is credential-free, not
categorically secret-free. `reposets init` appends `reposets.credentials.toml` to `.gitignore` in
both its XDG and `--project` modes, and the recommendation holds
regardless of where the file lives.

See
[`owner-lives-on-the-credential-profile`](../decisions/owner-lives-on-the-credential-profile.md)
and
[`tokens-are-references-never-values`](../decisions/tokens-are-references-never-values.md).

[^credentials-schema]: `package/src/schemas/credentials.ts`
[^credential-resolver]: `package/src/services/CredentialResolver.ts`
