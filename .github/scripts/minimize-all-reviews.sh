#!/usr/bin/env bash
# Minimize all old review summary comments from a bot
# Usage: minimize-all-reviews.sh <pr_number> <current_sha> [bot_login] [repo_owner] [repo_name]
#
# Arguments:
#   pr_number    - The pull request number
#   current_sha  - The current commit SHA (comments mentioning this SHA are NOT minimized)
#   bot_login    - Bot username to filter by (optional, defaults to app bot from APP_BOT_NAME env)
#   repo_owner   - Repository owner (optional, defaults to GITHUB_REPOSITORY_OWNER)
#   repo_name    - Repository name (optional, defaults to GITHUB_REPOSITORY name)
#
# Environment:
#   GITHUB_PAT       - Personal access token with permissions to minimize comments (preferred)
#   GH_TOKEN         - Fallback token if GITHUB_PAT not set
#   APP_BOT_NAME     - Default bot login name if not provided as argument
#   CLAUDE_COMMENT_ID - ID of sticky comment to exclude from minimization

set -euo pipefail

# Arguments
PR_NUMBER="${1:?Error: pr_number is required}"
CURRENT_SHA="${2:?Error: current_sha is required}"
BOT_LOGIN="${3:-${APP_BOT_NAME:-}}"
REPO_OWNER="${4:-${GITHUB_REPOSITORY_OWNER:-}}"
REPO_NAME="${5:-${GITHUB_REPOSITORY##*/}}"

# Validate required values
if [[ -z "$REPO_OWNER" || -z "$REPO_NAME" ]]; then
  echo "Error: Could not determine repository owner/name" >&2
  exit 1
fi

if [[ -z "$BOT_LOGIN" ]]; then
  echo "Error: Bot login not specified. Provide as argument or set APP_BOT_NAME" >&2
  exit 1
fi

# Use GITHUB_PAT if available, otherwise fall back to GH_TOKEN
TOKEN="${GITHUB_PAT:-${GH_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "Error: No authentication token found. Set GITHUB_PAT or GH_TOKEN" >&2
  exit 1
fi

# Sticky comment ID to exclude (if set)
STICKY_ID="${CLAUDE_COMMENT_ID:-0}"

echo "Minimizing old review comments on $REPO_OWNER/$REPO_NAME#$PR_NUMBER"
echo "Bot: $BOT_LOGIN, Current SHA: ${CURRENT_SHA:0:7}, Sticky ID: $STICKY_ID"

# Get all comments from the PR
COMMENTS=$(gh api "repos/$REPO_OWNER/$REPO_NAME/issues/$PR_NUMBER/comments" --paginate 2>/dev/null) || {
  echo "Error: Failed to fetch comments" >&2
  exit 1
}

# Filter comments:
# 1. From the specified bot
# 2. Contain review markers (## Code Review or <!-- claude-code-review -->)
# 3. NOT the sticky comment
# 4. NOT mentioning the current SHA
COMMENTS_TO_MINIMIZE=$(echo "$COMMENTS" | jq -r --arg bot "$BOT_LOGIN" --arg sha "$CURRENT_SHA" --arg sticky "$STICKY_ID" '
  .[] | select(
    .user.login == $bot and
    (.body | test("## Code Review|<!-- claude-code-review -->")) and
    (.id | tostring) != $sticky and
    (.body | contains($sha) | not)
  ) | "\(.id) \(.node_id)"
')

if [[ -z "$COMMENTS_TO_MINIMIZE" ]]; then
  echo "No old review comments to minimize"
  exit 0
fi

# Count comments
COUNT=$(echo "$COMMENTS_TO_MINIMIZE" | wc -l | tr -d ' ')
echo "Found $COUNT old review comment(s) to minimize"

# Minimize each comment
ORIGINAL_TOKEN="${GH_TOKEN:-}"
export GH_TOKEN="$TOKEN"

MINIMIZED=0
FAILED=0

while read -r LINE; do
  COMMENT_ID=$(echo "$LINE" | cut -d' ' -f1)
  NODE_ID=$(echo "$LINE" | cut -d' ' -f2)

  echo "Minimizing comment $COMMENT_ID..."

  gh api graphql -f query='
    mutation MinimizeComment($id: ID!, $classifier: ReportedContentClassifiers!) {
      minimizeComment(input: {subjectId: $id, classifier: $classifier}) {
        minimizedComment {
          isMinimized
        }
      }
    }
  ' -f id="$NODE_ID" -f classifier="OUTDATED" --silent && {
    MINIMIZED=$((MINIMIZED + 1))
    echo "  Minimized successfully"
  } || {
    FAILED=$((FAILED + 1))
    echo "  Failed to minimize"
  }
done <<< "$COMMENTS_TO_MINIMIZE"

# Restore original token
if [[ -n "$ORIGINAL_TOKEN" ]]; then
  export GH_TOKEN="$ORIGINAL_TOKEN"
fi

echo "Done: $MINIMIZED minimized, $FAILED failed"
