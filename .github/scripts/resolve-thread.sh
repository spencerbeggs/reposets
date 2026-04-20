#!/usr/bin/env bash
# Reply to a PR review comment thread and mark it as resolved
# Usage: resolve-thread.sh <comment_id> <pr_number> <commit_sha> [repo_owner] [repo_name]
#
# Arguments:
#   comment_id  - The numeric ID of the review comment to reply to
#   pr_number   - The pull request number
#   commit_sha  - The current commit SHA (included in reply message)
#   repo_owner  - Repository owner (optional, defaults to GITHUB_REPOSITORY_OWNER)
#   repo_name   - Repository name (optional, defaults to GITHUB_REPOSITORY name)
#
# Environment:
#   GITHUB_PAT  - Personal access token with permissions to resolve threads (preferred)
#   GH_TOKEN    - Fallback token if GITHUB_PAT not set

set -euo pipefail

# Arguments
COMMENT_ID="${1:?Error: comment_id is required}"
PR_NUMBER="${2:?Error: pr_number is required}"
COMMIT_SHA="${3:?Error: commit_sha is required}"
REPO_OWNER="${4:-${GITHUB_REPOSITORY_OWNER:-}}"
REPO_NAME="${5:-${GITHUB_REPOSITORY##*/}}"

# Validate required values
if [[ -z "$REPO_OWNER" || -z "$REPO_NAME" ]]; then
  echo "Error: Could not determine repository owner/name" >&2
  echo "Either set GITHUB_REPOSITORY or provide repo_owner and repo_name arguments" >&2
  exit 1
fi

# Use GITHUB_PAT if available, otherwise fall back to GH_TOKEN
TOKEN="${GITHUB_PAT:-${GH_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "Error: No authentication token found. Set GITHUB_PAT or GH_TOKEN" >&2
  exit 1
fi

echo "Resolving thread for comment $COMMENT_ID on $REPO_OWNER/$REPO_NAME#$PR_NUMBER"

# Step 1: Reply to the comment thread
REPLY_BODY="Issue addressed at commit ${COMMIT_SHA:0:7}."

gh api "repos/$REPO_OWNER/$REPO_NAME/pulls/$PR_NUMBER/comments/$COMMENT_ID/replies" \
  --method POST \
  -f body="$REPLY_BODY" \
  --silent || {
    echo "Warning: Failed to create reply (comment may already be resolved)" >&2
  }

# Step 2: Get the GraphQL node ID for the comment
NODE_ID=$(gh api "repos/$REPO_OWNER/$REPO_NAME/pulls/comments/$COMMENT_ID" --jq '.node_id' 2>/dev/null) || {
  echo "Error: Failed to get node ID for comment $COMMENT_ID" >&2
  exit 1
}

if [[ -z "$NODE_ID" ]]; then
  echo "Error: Could not retrieve node ID for comment" >&2
  exit 1
fi

echo "Got node ID: $NODE_ID"

# Step 3: Resolve the thread using GraphQL
# Note: We need to use GITHUB_PAT for this operation as it requires special permissions
ORIGINAL_TOKEN="${GH_TOKEN:-}"
export GH_TOKEN="$TOKEN"

gh api graphql -f query='
  mutation ResolveThread($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) {
      thread {
        isResolved
      }
    }
  }
' -f threadId="$NODE_ID" --silent || {
  echo "Warning: Failed to resolve thread (may require different permissions)" >&2
  # Restore original token
  if [[ -n "$ORIGINAL_TOKEN" ]]; then
    export GH_TOKEN="$ORIGINAL_TOKEN"
  fi
  exit 0  # Don't fail the workflow for this
}

# Restore original token
if [[ -n "$ORIGINAL_TOKEN" ]]; then
  export GH_TOKEN="$ORIGINAL_TOKEN"
fi

echo "Thread resolved successfully"
