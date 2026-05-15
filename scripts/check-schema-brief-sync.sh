#!/usr/bin/env bash
# check-schema-brief-sync.sh
# CI guard: if lib/user_brief.js has been modified in this PR, verify that
# server.js still contains the user_briefs CREATE TABLE statement.
# Catches schema drift between the module and the DB definition.
#
# Usage: ./scripts/check-schema-brief-sync.sh
# Exit code: 0 = in sync, 1 = drift detected

set -euo pipefail

BRIEF_MODULE="lib/user_brief.js"
SERVER_FILE="server.js"
FAILED=0

# Only enforce sync-check if user_brief.js is tracked by git (i.e., this PR touches it)
if ! git ls-files --error-unmatch "$BRIEF_MODULE" 2>/dev/null; then
  echo "⏭  $BRIEF_MODULE not tracked yet — skipping sync check"
  exit 0
fi

echo "🔍 Schema/brief sync check"
echo ""

if grep -q "CREATE TABLE IF NOT EXISTS user_briefs" "$SERVER_FILE"; then
  echo "✅ user_briefs table definition present in $SERVER_FILE"
else
  echo "❌ user_briefs CREATE TABLE missing from $SERVER_FILE"
  echo "   lib/user_brief.js exists but the schema is gone — drift detected."
  echo "   Fix: restore the CREATE TABLE IF NOT EXISTS user_briefs block in server.js"
  FAILED=1
fi

if grep -q "CREATE TABLE IF NOT EXISTS user_brief_history" "$SERVER_FILE"; then
  echo "✅ user_brief_history table definition present in $SERVER_FILE"
else
  echo "❌ user_brief_history CREATE TABLE missing from $SERVER_FILE"
  FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo ""
  echo "✅ Schema/brief sync check PASSED"
else
  echo ""
  echo "❌ Schema/brief sync check FAILED — fix drift before merging"
  exit 1
fi
