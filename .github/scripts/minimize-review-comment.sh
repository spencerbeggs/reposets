#!/usr/bin/env bash
# Minimize a specific review comment as outdated
# Usage: minimize-review-comment.sh <comment_id> <commit_sha> [repo_owner] [repo_name]
#
# Arguments:
#   comment_id  - The numeric ID of the issue comment to minimize
#   commit_sha  - The current commit SHA (for logging purposes)
#   repo_owner  - Repository owner (optional, defaults to GITHUB_REPOSITORY_OWNER)
#   repo_name   - Repository name (optional, defaults to GITHUB_REPOSITORY name)
#
# Environment:
#   GITHUB_PAT  - Personal access token with permissions to minimize comments (preferred)
#   GH_TOKEN    - Fallback token if GITHUB_PAT not set

set -euo pipefail

# Arguments
COMMENT_ID="${1:?Error: comment_id is required}"
COMMIT_SHA="${2:?Error: commit_sha is required}"
REPO_OWNER="${3:-${GITHUB_REPOSITORY_OWNER:-}}"
REPO_NAME="${4:-${GITHUB_REPOSITORY##*/}}"

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

echo "Minimizing comment $COMMENT_ID on $REPO_OWNER/$REPO_NAME (current SHA: ${COMMIT_SHA:0:7})"

# Step 1: Get the GraphQL node ID for the comment
NODE_ID=$(gh api "repos/$REPO_OWNER/$REPO_NAME/issues/comments/$COMMENT_ID" --jq '.node_id' 2>/dev/null) || {
  echo "Error: Failed to get node ID for comment $COMMENT_ID" >&2
  exit 1
}

if [[ -z "$NODE_ID" ]]; then
  echo "Error: Could not retrieve node ID for comment" >&2
  exit 1
fi

echo "Got node ID: $NODE_ID"

# Step 2: Minimize the comment using GraphQL
ORIGINAL_TOKEN="${GH_TOKEN:-}"
export GH_TOKEN="$TOKEN"

gh api graphql -f query='
  mutation MinimizeComment($id: ID!, $classifier: ReportedContentClassifiers!) {
    minimizeComment(input: {subjectId: $id, classifier: $classifier}) {
      minimizedComment {
        isMinimized
        minimizedReason
      }
    }
  }
' -f id="$NODE_ID" -f classifier="OUTDATED" --silent || {
  echo "Warning: Failed to minimize comment (may require different permissions)" >&2
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

echo "Comment minimized successfully"
