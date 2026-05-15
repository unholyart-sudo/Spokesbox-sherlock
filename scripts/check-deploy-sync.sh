#!/usr/bin/env bash
# check-deploy-sync.sh
# CI guard: fails if the deploy branch's wizard.html diverges from main.
# Run before any deploy. Prevents a feature branch silently overwriting
# a hotfix that landed on main after the feature branch was cut.
#
# Usage:
#   ./scripts/check-deploy-sync.sh                   # checks current branch vs main
#   ./scripts/check-deploy-sync.sh feat/my-branch    # checks named branch vs main
#
# Exit code: 0 = in sync, 1 = diverged (deploy blocked)

set -euo pipefail

DEPLOY_BRANCH="${1:-$(git branch --show-current)}"
MAIN_BRANCH="main"
CRITICAL_FILES=(
  "spokesbox/public/wizard.html"
  "spokesbox/server.js"
)

echo "🔍 Deploy sync check: $DEPLOY_BRANCH vs $MAIN_BRANCH"
echo ""

FAILED=0

for FILE in "${CRITICAL_FILES[@]}"; do
  # Get the merge-base (common ancestor)
  BASE=$(git merge-base "$MAIN_BRANCH" "$DEPLOY_BRANCH" 2>/dev/null) || {
    echo "❌ Could not find merge-base for $DEPLOY_BRANCH and $MAIN_BRANCH"
    exit 1
  }

  # Check if file changed on main since the branch point
  CHANGED_ON_MAIN=$(git diff --name-only "$BASE" "$MAIN_BRANCH" -- "$FILE" 2>/dev/null)
  # Check if deploy branch has that change
  BRANCH_HAS_CHANGE=$(git diff --name-only "$BASE" "$DEPLOY_BRANCH" -- "$FILE" 2>/dev/null)

  if [ -n "$CHANGED_ON_MAIN" ] && [ -z "$BRANCH_HAS_CHANGE" ]; then
    echo "⚠️  DIVERGED: $FILE"
    echo "   main has changes since branch point ($BASE) that are NOT in $DEPLOY_BRANCH"
    echo "   → Run: git merge $MAIN_BRANCH or git rebase $MAIN_BRANCH before deploying"
    FAILED=1
  elif [ -n "$CHANGED_ON_MAIN" ]; then
    # Both changed — check if deploy branch has all of main's changes
    MAIN_HASH=$(git show "$MAIN_BRANCH:$FILE" 2>/dev/null | sha256sum | awk '{print $1}')
    BRANCH_HASH=$(git show "$DEPLOY_BRANCH:$FILE" 2>/dev/null | sha256sum | awk '{print $1}')
    if [ "$MAIN_HASH" != "$BRANCH_HASH" ]; then
      echo "⚠️  CONTENT MISMATCH: $FILE"
      echo "   main and $DEPLOY_BRANCH both modified this file since branch point"
      echo "   but the final content differs — check for missing hotfix merges"
      echo "   main sha256:   $MAIN_HASH"
      echo "   branch sha256: $BRANCH_HASH"
      FAILED=1
    else
      echo "✅  $FILE — in sync"
    fi
  else
    echo "✅  $FILE — no main changes since branch point"
  fi
done

echo ""
if [ "$FAILED" -eq 1 ]; then
  echo "❌ Deploy sync check FAILED — merge main before deploying"
  exit 1
else
  echo "✅ Deploy sync check PASSED"
fi
