#!/bin/bash
# safe-git-reset.sh — ALWAYS run this before `git reset --hard origin/main`
#
# ╔══════════════════════════════════════════════════════════════════════╗
# ║  ⛔  RAW `git reset --hard` IS FORBIDDEN ON THIS WORKSPACE           ║
# ║  ALWAYS use this script instead.                                    ║
# ║                                                                      ║
# ║  WHY: 2026-05-20 incident — git reset reverted subscribers.db to a  ║
# ║  March snapshot, silently wiping 50+ SMS subscribers. Also wiped    ║
# ║  public/, lib/, db.js, package.json, node_modules.                  ║
# ╚══════════════════════════════════════════════════════════════════════╝
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

# ── DB Guard: check for tracked runtime databases ─────────────────────────────
echo ""
echo "🗄️  DATABASE GUARD:"
TRACKED_DBS=$(git ls-files | grep -E '\.db$|\.sqlite$|\.sqlite3$' || true)
if [ -n "$TRACKED_DBS" ]; then
  echo ""
  echo "  ╔══════════════════════════════════════════════════════════╗"
  echo "  ║  🚨 CRITICAL: LIVE DATABASES ARE TRACKED IN GIT!         ║"
  echo "  ║  git reset --hard WILL REVERT THEM to an old snapshot,   ║"
  echo "  ║  silently wiping any subscribers added since that commit. ║"
  echo "  ║                                                            ║"
  echo "  ║  Fix FIRST:                                               ║"
  echo "  ║    git rm --cached <db-file>                              ║"
  echo "  ║    echo '*.db' >> .gitignore                              ║"
  echo "  ║    git commit -m 'chore: untrack live databases'          ║"
  echo "  ╚══════════════════════════════════════════════════════════╝"
  echo ""
  echo "  Tracked DB files:"
  echo "$TRACKED_DBS" | sed 's/^/    ⚠️  /'
  echo ""
  echo "⛔  Refusing to proceed. Fix tracked DBs first."
  exit 1
else
  echo "  ✅ No tracked databases found (*.db not in git)"
fi

# ── Backup freshness check ────────────────────────────────────────────────────
echo ""
echo "📦  BACKUP FRESHNESS CHECK:"
CRITICAL_DBS=("torahtxt/subscribers.db" "skytuned/subscribers.db" "spokesbox/subscribers.db")
BACKUP_STALE=0
for db in "${CRITICAL_DBS[@]}"; do
  if [ ! -f "$WS/$db" ]; then
    echo "  ⏭  $db not present (skip)"
    continue
  fi
  # Find most recent backup of this DB
  dbname=$(basename "$db")
  latest_backup=$(find "$WS/backups" -name "$dbname" -newer "$WS/$db" 2>/dev/null | head -1)
  if [ -z "$latest_backup" ]; then
    # check if any backup exists at all
    any_backup=$(find "$WS/backups" -name "$dbname" 2>/dev/null | sort | tail -1)
    if [ -z "$any_backup" ]; then
      echo "  ❌ NO BACKUP FOUND for $db"
      BACKUP_STALE=1
    else
      backup_age=$(( ( $(date +%s) - $(stat -f %m "$any_backup" 2>/dev/null || stat -c %Y "$any_backup" 2>/dev/null || echo 0) ) / 3600 ))
      echo "  ⚠️  $db — backup is ${backup_age}h old (latest: $any_backup)"
      if [ "$backup_age" -gt 48 ]; then
        BACKUP_STALE=1
      fi
    fi
  else
    echo "  ✅ $db — backup is current"
  fi
done

if [ "$BACKUP_STALE" -eq 1 ]; then
  echo ""
  echo "  ╔══════════════════════════════════════════════════════════╗"
  echo "  ║  ⚠️  STALE OR MISSING DB BACKUPS DETECTED                 ║"
  echo "  ║  Run backup first:                                        ║"
  echo "  ║    bash scripts/backup-production-critical.sh             ║"
  echo "  ╚══════════════════════════════════════════════════════════╝"
  if [[ "${1:-}" == "--reset" ]]; then
    echo ""
    echo "  Type BACKUP-STALE-OK to proceed anyway, or anything else to abort:"
    read -r STALE_CONFIRM
    if [ "$STALE_CONFIRM" != "BACKUP-STALE-OK" ]; then
      echo "Aborted. Run backup-production-critical.sh first."
      exit 1
    fi
  fi
fi

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
