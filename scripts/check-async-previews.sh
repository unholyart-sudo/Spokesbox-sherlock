#!/usr/bin/env bash
# check-async-previews.sh
# CI guard: fails if renderNewsletter() or generateNewsletterPreview() is called
# without an immediately preceding `await`. Prevents the {} regression where
# res.send(Promise) silently serializes a Promise as an empty object.
#
# Usage:
#   ./scripts/check-async-previews.sh           # scans ALL .js files (excl. node_modules)
#   ./scripts/check-async-previews.sh file.js   # scans a single file
#
# Exit code: 0 = all calls are awaited, 1 = missing await found

set -euo pipefail

FAILED=0
SCANNED=0

check_file() {
  local TARGET="$1"

  while IFS= read -r line_info; do
    local lineno content
    lineno=$(echo "$line_info" | cut -d: -f1)
    content=$(echo "$line_info" | cut -d: -f2-)

    # Skip function declarations
    if echo "$content" | grep -qE '^\s*(async\s+)?function\s+(renderNewsletter|generateNewsletterPreview)'; then
      continue
    fi

    # Skip comment lines
    if echo "$content" | grep -qE '^\s*//'; then
      continue
    fi

    # Check that `await` immediately precedes the call (allow whitespace between await and call)
    if ! echo "$content" | grep -qE 'await\s+(renderNewsletter|generateNewsletterPreview)\s*\('; then
      echo "❌ MISSING await at $TARGET:$lineno"
      echo "   $content" | sed 's/^ */   /'
      FAILED=1
    fi

  done < <(grep -n 'renderNewsletter\s*(\|generateNewsletterPreview\s*(' "$TARGET" 2>/dev/null)
}

if [ $# -ge 1 ]; then
  # Single-file mode
  echo "🔍 Async preview call audit: $1"
  echo ""
  check_file "$1"
  SCANNED=1
else
  # Full-scan mode: all .js files except node_modules
  echo "🔍 Async preview call audit: all .js files"
  echo ""
  while IFS= read -r f; do
    check_file "$f"
    SCANNED=$((SCANNED + 1))
  done < <(find . -name "*.js" ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/build/*" | sort)
  echo "   Scanned $SCANNED file(s)"
fi

if [ "$FAILED" -eq 0 ]; then
  echo "✅ All renderNewsletter() and generateNewsletterPreview() calls are properly awaited"
else
  echo ""
  echo "❌ Fix: add 'await' before each flagged call, and ensure the enclosing function is async"
  exit 1
fi
