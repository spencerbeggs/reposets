# Token Permissions

## Overview

reposets requires a fine-grained personal access token (not a classic token). Fine-grained tokens let you scope access to specific repositories and permissions.

## Required Permissions

| Category | Permission | Access | Purpose |
| :--- | :--- | :--- | :--- |
| Repository | Administration | Read and write | Sync repository settings |
| Repository | Secrets | Read and write | Manage Actions, Dependabot, and Codespaces secrets |
| Repository | Variables | Read and write | Manage Actions and environment variables |
| Repository | Environments | Read and write | Create and configure deployment environments |
| Account | GPG keys | Read and write | Retrieve the repository public key for encrypting secrets (see below) |

### Why GPG Keys Access Is Required

The GitHub API does not accept secret values in plaintext. Before uploading a secret, reposets must first fetch the repository's public encryption key via the API, use it to encrypt the secret value with libsodium sealed-box encryption, and then send the encrypted payload. The "Account permissions > GPG keys (Read and write)" scope grants access to this encryption key endpoint. Without it, reposets cannot create or update any secrets.

## Creating a Token

1. Go to GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens
2. Click "Generate new token"
3. Set a token name and expiration
4. Under "Repository access", select "All repositories" or choose specific repos
5. Under "Repository permissions", enable the four required permissions listed above
6. Under "Account permissions", enable GPG keys (Read and write)
7. Click "Generate token" and copy it

## Adding the Token

Use `reposets credentials create`:

```sh
reposets credentials create --profile personal --github-token ghp_your_token_here
```

Or add directly to `reposets.credentials.toml`:

```toml
[profiles.personal]
github_token = "ghp_your_token_here"
```

See [Credentials](credentials.md) for more on credential profiles.

## Scope Recommendations

Under "Repository access" when creating the token, you have two choices:

- **All repositories** -- simpler to maintain, especially if you manage many repos or frequently add new ones to your config groups.
- **Only select repositories** -- tighter security, granting access only to the specific repositories listed in your config's group `repos` arrays. However, if you add new repos to your config later, you will need to update the token's repository scope to include them or API calls for those repos will fail.

You can use `reposets doctor` to verify your setup and check for configuration issues.

## Verifying Permissions

Run `reposets doctor` to check your environment. It validates config, detects typos, and lists the required token permissions:

```sh
reposets doctor
```
