# Token Permissions

## Overview

repo-sync requires a fine-grained personal access token (not a classic token). Fine-grained tokens let you scope access to specific repositories and permissions.

## Required Permissions

| Category | Permission | Access | Purpose |
| :--- | :--- | :--- | :--- |
| Repository | Administration | Read and write | Sync repository settings |
| Repository | Secrets | Read and write | Manage Actions, Dependabot, and Codespaces secrets |
| Repository | Variables | Read and write | Manage Actions and environment variables |
| Repository | Environments | Read and write | Create and configure deployment environments |
| Account | GPG keys | Read and write | Retrieve the public key for encrypting secrets |

## Creating a Token

1. Go to GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens
2. Click "Generate new token"
3. Set a token name and expiration
4. Under "Repository access", select "All repositories" or choose specific repos
5. Under "Repository permissions", enable the four required permissions listed above
6. Under "Account permissions", enable GPG keys (Read and write)
7. Click "Generate token" and copy it

## Adding the Token

Use `repo-sync credentials create`:

```sh
repo-sync credentials create --profile personal --github-token ghp_your_token_here
```

Or add directly to `repo-sync.credentials.toml`:

```toml
[profiles.personal]
github_token = "ghp_your_token_here"
```

See [Credentials](credentials.md) for more on credential profiles.

## Scope Recommendations

- If you manage many repos, "All repositories" is simpler to maintain
- For tighter control, select only the repos listed in your config's group `repos` arrays
- You can use `repo-sync doctor` to verify your setup and check for configuration issues

## Verifying Permissions

Run `repo-sync doctor` to check your environment. It validates config, detects typos, and lists the required token permissions:

```sh
repo-sync doctor
```
