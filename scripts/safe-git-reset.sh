#!/bin/bash
# safe-git-reset.sh — ALWAYS run this before `git reset --hard origin/main`
# Standing rule added 2026-05-20 after git reset wiped public assets, db.js,
# package.json, lib/, jobs/, services/, providers/ across TorahTxt and Spokesbox.
#
# Usage:  bash scripts/safe-git-reset.sh          (audit only — safe)
#         bash scripts/safe-git-reset.sh --reset   (audit then reset if approved)

set -euo pipefail
WS="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WS"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Git Reset Safety Audit — $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════════════════"

# 1. Tracked files that would be deleted (exist locally, not in origin/main)
echo ""
echo "📋 TRACKED FILES THAT WOULD BE LOST (not in origin/main):"
LOST=$(git diff --name-only HEAD origin/main 2>/dev/null | head -60)
if [ -z "$LOST" ]; then
  echo "  (none — HEAD matches origin/main)"
else
  echo "$LOST" | sed 's/^/  - /'
  LOST_COUNT=$(echo "$LOST" | wc -l | tr -d ' ')
  echo "  → $LOST_COUNT file(s) would be deleted"
fi

# 2. Untracked files (not in git at all — reset won't touch these, but good to know)
echo ""
echo "📂 UNTRACKED FILES (git reset won't touch these):"
UNTRACKED=$(git ls-files --others --exclude-standard | grep -v "node_modules" | head -40)
if [ -z "$UNTRACKED" ]; then
  echo "  (none)"
else
  echo "$UNTRACKED" | sed 's/^/  ? /'
  UNTRACKED_COUNT=$(echo "$UNTRACKED" | wc -l | tr -d ' ')
  echo "  → $UNTRACKED_COUNT untracked file(s)"
fi

# 3. Modified tracked files that would revert
echo ""
echo "🔄 LOCALLY MODIFIED FILES (would revert to origin/main):"
MODIFIED=$(git diff --name-only origin/main 2>/dev/null | head -30)
if [ -z "$MODIFIED" ]; then
  echo "  (none)"
else
  echo "$MODIFIED" | sed 's/^/  ~ /'
fi

# 4. Binary/asset check — flag any images, audio, etc. in the loss list
if [ -n "$LOST" ]; then
  echo ""
  echo "⚠️  ASSET WARNING — binary files that would be deleted:"
  echo "$LOST" | grep -iE "\.(png|jpg|jpeg|svg|ico|gif|webp|mp3|mp4|wav|pdf)" | sed 's/^/  ⚠ /' || echo "  (none)"
fi

echo ""
echo "══════════════════════════════════════════════════════"

# 5. If --reset flag passed, confirm before proceeding
if [[ "${1:-}" == "--reset" ]]; then
  if [ -n "$LOST" ] && [ "$LOST_COUNT" -gt 0 ]; then
    echo ""
    echo "⛔  $LOST_COUNT file(s) will be permanently deleted from working tree."
    echo "    Type YES to confirm git reset --hard origin/main, or anything else to abort:"
    read -r CONFIRM
    if [ "$CONFIRM" != "YES" ]; then
      echo "Aborted."
      exit 1
    fi
  fi
  echo "Running: git reset --hard origin/main"
  git reset --hard origin/main
  echo "Done."
else
  echo "  Audit complete. Run with --reset to perform the reset."
fi
echo ""
