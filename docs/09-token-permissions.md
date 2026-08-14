# Token permissions

## Overview

reposets requires a fine-grained personal access token, not a classic token. Fine-grained tokens let you scope access to specific repositories and permissions.

## Required permissions

| Category | Permission | Access | Purpose |
| :--- | :--- | :--- | :--- |
| Repository | Administration | Read and write | Sync repository settings |
| Repository | Secrets | Read and write | Manage Actions, Codespaces and environment secrets, and fetch the public keys used to encrypt them |
| Repository | Variables | Read and write | Manage Actions and environment variables |
| Repository | Environments | Read and write | Create and configure deployment environments |
| Repository | Code scanning alerts | Read and write | Configure CodeQL default setup (`[code_scanning.*]`) |
| Repository | Dependabot alerts | Read and write | Toggle vulnerability alerts and automated security fixes (`[security.*]`) |
| Repository | Secret scanning alerts | Read and write | Configure `security_and_analysis` secret scanning fields |
| Repository | Dependabot secrets | Read and write | Manage Dependabot secrets |
| Repository | Actions | **Read** | Count workflow files, to decide whether the `actions` CodeQL language can be set |
| Organization | Members | Read | Resolve team slugs in `delegated_bypass_reviewers` to numeric reviewer IDs (org-owned repos only) |

The security-related permissions — Actions, Code scanning alerts, Dependabot alerts, Secret scanning alerts and Members — are only needed if you use the matching config sections (`[settings.*.security_and_analysis]`, `[security.*]`, `[code_scanning.*]`). A token without them still syncs settings, secrets, variables, rulesets and environments.

`Metadata: Read` is mandatory for every fine-grained token and is granted automatically, so there is nothing to enable for it.

### Actions is Read, deliberately

reposets **lists** workflows so the code-scanning phase can tell whether the `actions` CodeQL language is settable — GitHub validates that language against workflow files, and the language endpoint cannot report it. It never starts, stops, enables or disables a workflow, so write is not required and should not be granted: it would let a tool that only counts workflows disable all of them.

### No account-level permission is required

Earlier versions of this document listed **Account permissions > GPG keys (Read and write)** as the scope needed to encrypt secrets. **That was wrong, and following it granted an account-wide scope that reposets never uses.**

The GitHub API does not accept secret values in plaintext: reposets fetches a public key, seals the value with libsodium sealed-box encryption, and sends the sealed payload. But those keys come from **repository-scoped** endpoints — `GET /repos/{owner}/{repo}/actions/secrets/public-key` and the Dependabot, Codespaces and environment equivalents — which are covered by the Secrets permissions already in the table above.

Account-level GPG keys governs `/user/gpg_keys`, a user's commit-signing keys. reposets never touches it. If you granted it on the strength of the old instructions, you can revoke it.

## Creating a token

1. Go to GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens
2. Click "Generate new token"
3. Set a token name and expiration
4. Under "Repository access", select "All repositories" or choose specific repos
5. Under "Repository permissions", enable the permissions listed above: Administration, Secrets, Variables, Environments and Dependabot secrets, plus Actions (Read), Code scanning alerts, Dependabot alerts and Secret scanning alerts if you use the security config sections
6. Under "Organization permissions", enable Members (Read) if you use `delegated_bypass_reviewers` with team slugs on org-owned repos
7. Click "Generate token" and copy it

## Storing the token

**reposets never stores a token value.** The credentials file holds a *reference* to where the token lives, so the file itself is safe to read, back up and leave in a terminal scrollback.

Put the token in 1Password and reference the item:

```bash
reposets credentials create --profile personal --username your-username --op "op://Private/github/token"
# Created profile 'personal' (username: your-username, github_token: op op://Private/github/token) in /path/to/reposets.credentials.toml.
```

Or, for CI and anywhere a secret store injects the value, reference an environment variable:

```bash
reposets credentials create --profile ci --org your-org --env REPOSETS_GITHUB_TOKEN
# Created profile 'ci' (org: your-org, github_token: env REPOSETS_GITHUB_TOKEN) in /path/to/reposets.credentials.toml.
```

Either produces a profile you can also write by hand:

```toml
[profiles.personal]
username = "your-username"
github_token = { op = "op://Private/github/token" }
```

Resolving `op://` references needs `OP_SERVICE_ACCOUNT_TOKEN` in the environment. See [Credentials](04-credentials.md) for the whole profile format.

## Scope recommendations

Under "Repository access" when creating the token, you have two choices:

- **All repositories** -- simpler to maintain, especially if you manage many repos or frequently add new ones to your config groups.
- **Only select repositories** -- tighter security, granting access only to the specific repositories listed in your config's group `repos` arrays. However, if you add new repos to your config later, you will need to update the token's repository scope to include them or API calls for those repos will fail.

## Verifying the token

`reposets doctor` resolves each profile's token and calls `GET /user` with it, which is the cheapest question that proves the credential is live:

```bash
reposets doctor
# Token [personal]: resolved, authenticates as your-username — matches username
```

It also prints the required permissions, and says plainly that they are a requirement rather than a verification:

```text
Required fine-grained token permissions:
  Repository > Administration (Read and write) — settings sync
  ...
  (Metadata: Read is mandatory and granted automatically)
  These are NOT verified — GitHub does not expose a fine-grained token's own scopes.
```

GitHub reports a permission set for App installation tokens only, so a fine-grained token's own scopes cannot be read back through the API. Compare the list by hand when a call fails with a 403.
