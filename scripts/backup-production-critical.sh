#!/bin/bash
# backup-production-critical.sh
#
# Creates a timestamped Dropbox snapshot of production-critical workspace files.
#
# Plain files  → plain-production-critical.tar.gz  (safe to inspect)
# Secret files → secrets.tar.gz.enc                (AES-256-CBC, openssl)
# Inventory    → MANIFEST.md
#
# Usage:
#   bash scripts/backup-production-critical.sh
#
# Encryption:
#   Export PRODUCTION_BACKUP_PASSPHRASE before running to enable secret backup.
#   Example: export PRODUCTION_BACKUP_PASSPHRASE="your-passphrase-here"
#
# Restore (plain):
#   tar -xzf plain-production-critical.tar.gz
#
# Restore (secrets):
#   openssl enc -d -aes-256-cbc -pbkdf2 -in secrets.tar.gz.enc | tar -xz
#
# ⚠️  COMMIT THIS FILE after every edit (never commit secrets or .enc files).

set -euo pipefail

WORKSPACE="/Users/openclawjg/.openclaw/workspace"
DEST="$HOME/Dropbox/OpenClaw Backups/production-critical"
STAMP=$(date '+%Y-%m-%d_%H-%M-%S')
SNAPSHOT="${DEST}/${STAMP}"
PLAIN_TAR="plain-production-critical.tar.gz"
SECRET_TAR_ENC="secrets.tar.gz.enc"
MANIFEST="MANIFEST.md"
LOG_FILE="${DEST}/backup.log"

# ── Helpers ──────────────────────────────────────────────────────────────────

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
warn() { echo "⚠️  $*" | tee -a "$LOG_FILE"; }

copy_if_exists() {
  local src="$1"
  local dest_dir="$2"
  if [ -e "$src" ]; then
    mkdir -p "$dest_dir"
    cp -R "$src" "$dest_dir/"
    echo "  ✅ $src" | tee -a "$LOG_FILE"
    echo "- \`$src\`" >> "${SNAPSHOT}/${MANIFEST}"
  else
    echo "  ⏭  SKIP (missing): $src" | tee -a "$LOG_FILE"
    echo "- ~~\`$src\`~~ *(missing)*" >> "${SNAPSHOT}/${MANIFEST}"
  fi
}

# ── Setup ─────────────────────────────────────────────────────────────────────

mkdir -p "$SNAPSHOT/plain" "$SNAPSHOT/secrets-staging"
mkdir -p "$(dirname "$LOG_FILE")"

log "━━━ Backup started: $STAMP ━━━"
log "Snapshot: $SNAPSHOT"

cd "$WORKSPACE"

# ── MANIFEST header ───────────────────────────────────────────────────────────

cat > "${SNAPSHOT}/${MANIFEST}" <<EOF
# Production-Critical Backup Manifest
**Timestamp:** ${STAMP}
**Workspace:** ${WORKSPACE}
**Snapshot:** ${SNAPSHOT}

---

## Plain Files Backed Up
EOF

# ── Plain backup ──────────────────────────────────────────────────────────────

log "── Copying plain files..."

# Root-level service files
copy_if_exists "watchdog.sh"                  "${SNAPSHOT}/plain"
copy_if_exists "server.js"                    "${SNAPSHOT}/plain"
copy_if_exists "package.json"                 "${SNAPSHOT}/plain"
copy_if_exists "package-lock.json"            "${SNAPSHOT}/plain"
copy_if_exists "MEMORY.md"                    "${SNAPSHOT}/plain"
copy_if_exists "COST_CONTROL.md"              "${SNAPSHOT}/plain"
copy_if_exists "EMAIL_OUTPUT_STANDARD.md"     "${SNAPSHOT}/plain"
copy_if_exists "OPENCLAW_OPS.md"              "${SNAPSHOT}/plain"

# Memory directory (daily notes, design specs, heartbeat state — untracked by git)
copy_if_exists "memory"                       "${SNAPSHOT}/plain"

# Scripts
copy_if_exists "scripts/safe-git-reset.sh"            "${SNAPSHOT}/plain/scripts"
copy_if_exists "scripts/backup-production-critical.sh" "${SNAPSHOT}/plain/scripts"

# Spokesbox
copy_if_exists "spokesbox/server.js"         "${SNAPSHOT}/plain/spokesbox"
copy_if_exists "spokesbox/package.json"      "${SNAPSHOT}/plain/spokesbox"
copy_if_exists "spokesbox/package-lock.json" "${SNAPSHOT}/plain/spokesbox"
copy_if_exists "spokesbox/public"            "${SNAPSHOT}/plain/spokesbox"
copy_if_exists "spokesbox/lib"               "${SNAPSHOT}/plain/spokesbox"
copy_if_exists "spokesbox/migrations"        "${SNAPSHOT}/plain/spokesbox"

# Root lib / email / public / migrations
copy_if_exists "lib"        "${SNAPSHOT}/plain"
copy_if_exists "email"      "${SNAPSHOT}/plain"
copy_if_exists "public"     "${SNAPSHOT}/plain"
copy_if_exists "migrations" "${SNAPSHOT}/plain"

# LaunchAgents plists
PLIST_DEST="${SNAPSHOT}/plain/LaunchAgents"
mkdir -p "$PLIST_DEST"
for plist in \
  "$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist" \
  "$HOME/Library/LaunchAgents/com.spokesbox.server.plist" \
  "$HOME/Library/LaunchAgents/com.torahtxt.server.plist" \
  "$HOME/Library/LaunchAgents/com.skytuned.server.plist" \
  "$HOME/Library/LaunchAgents/com.rarity.server.plist" \
  "$HOME/Library/LaunchAgents/com.torahtxt.caffeinate.plist" \
  "$HOME/Library/LaunchAgents/com.torahtxt.cloudflared.plist"; do
  if [ -f "$plist" ]; then
    cp "$plist" "$PLIST_DEST/"
    echo "  ✅ $plist" | tee -a "$LOG_FILE"
    echo "- \`$plist\`" >> "${SNAPSHOT}/${MANIFEST}"
  else
    echo "  ⏭  SKIP (missing): $plist" | tee -a "$LOG_FILE"
    echo "- ~~\`$plist\`~~ *(missing)*" >> "${SNAPSHOT}/${MANIFEST}"
  fi
done

# ── Plain tarball ─────────────────────────────────────────────────────────────

log "── Creating plain tarball..."
tar -czf "${SNAPSHOT}/${PLAIN_TAR}" -C "${SNAPSHOT}/plain" .
log "Plain archive: ${SNAPSHOT}/${PLAIN_TAR} ($(du -sh "${SNAPSHOT}/${PLAIN_TAR}" | cut -f1))"

# ── Secrets section in MANIFEST ───────────────────────────────────────────────

cat >> "${SNAPSHOT}/${MANIFEST}" <<EOF

---

## Secrets (Encrypted Archive)
EOF

# ── Secret backup ─────────────────────────────────────────────────────────────

SECRET_STAGING="${SNAPSHOT}/secrets-staging"

if [ -z "${PRODUCTION_BACKUP_PASSPHRASE:-}" ]; then
  warn "PRODUCTION_BACKUP_PASSPHRASE not set — skipping encrypted secret backup."
  echo "- *(skipped — PRODUCTION_BACKUP_PASSPHRASE not set)*" >> "${SNAPSHOT}/${MANIFEST}"
else
  log "── Staging secrets..."

  stage_secret() {
    local src="$1"
    local dest_dir="${SECRET_STAGING}/$2"
    if [ -e "$src" ]; then
      mkdir -p "$dest_dir"
      cp -R "$src" "$dest_dir/"
      echo "  🔒 staged: $src" | tee -a "$LOG_FILE"
      echo "- \`$src\` *(encrypted)*" >> "${SNAPSHOT}/${MANIFEST}"
    else
      echo "  ⏭  SKIP (missing): $src" | tee -a "$LOG_FILE"
      echo "- ~~\`$src\`~~ *(missing)*" >> "${SNAPSHOT}/${MANIFEST}"
    fi
  }

  # .env files — explicit known paths
  for env_file in .env .env.local .env.production .env.development; do
    [ -f "$env_file" ] && stage_secret "$env_file" "root"
  done
  for env_file in spokesbox/.env spokesbox/.env.local spokesbox/.env.production; do
    [ -f "$env_file" ] && stage_secret "$env_file" "spokesbox"
  done
  for env_file in torahtxt/.env torahtxt/.env.podcast torahtxt/.env.local; do
    [ -f "$env_file" ] && stage_secret "$env_file" "torahtxt"
  done
  for env_file in skytuned/.env skytuned/.env.local; do
    [ -f "$env_file" ] && stage_secret "$env_file" "skytuned"
  done

  # .env catch-all — find any .env* files workspace-wide not already staged
  log "── Scanning for additional .env files..."
  while IFS= read -r -d '' env_file; do
    rel="${env_file#$WORKSPACE/}"
    dir=$(dirname "$rel")
    dest_check="${SECRET_STAGING}/${dir}/$(basename "$env_file")"
    if [ ! -e "$dest_check" ]; then
      stage_secret "$rel" "$dir"
    fi
  done < <(find "$WORKSPACE" \( -name '.env' -o -name '.env.*' -o -name '*.env' \) \
    ! -path '*/node_modules/*' ! -path '*/.git/*' -print0 2>/dev/null)

  # DB catch-all — find any *.db or *.sqlite not already staged
  log "── Scanning for additional databases..."
  while IFS= read -r -d '' db_file; do
    rel="${db_file#$WORKSPACE/}"
    dir=$(dirname "$rel")
    dest_check="${SECRET_STAGING}/${dir}/$(basename "$db_file")"
    if [ ! -e "$dest_check" ]; then
      stage_secret "$rel" "$dir"
    fi
  done < <(find "$WORKSPACE" \( -name '*.db' -o -name '*.sqlite' -o -name '*.db3' \) \
    ! -path '*/node_modules/*' ! -path '*/.git/*' -print0 2>/dev/null)

  # Service account JSON
  stage_secret "google-service-account.json"        "root"
  stage_secret "google-vertex-service-account.json" "root"

  # data/ directories
  for data_dir in data spokesbox/data torahtxt/data; do
    [ -d "$data_dir" ] && stage_secret "$data_dir" "$(dirname "$data_dir")"
  done

  # Encrypt: tar secrets-staging → secrets.tar.gz.enc
  log "── Encrypting secrets..."
  tar -cz -C "$SECRET_STAGING" . \
    | openssl enc -aes-256-cbc -pbkdf2 -pass env:PRODUCTION_BACKUP_PASSPHRASE \
    > "${SNAPSHOT}/${SECRET_TAR_ENC}"
  log "Encrypted archive: ${SNAPSHOT}/${SECRET_TAR_ENC} ($(du -sh "${SNAPSHOT}/${SECRET_TAR_ENC}" | cut -f1))"

  # Wipe staging — never leave plaintext secrets on disk in backup dir
  rm -rf "$SECRET_STAGING"
  log "── Secrets staging wiped."
fi

# ── Untracked / ignored inventory ─────────────────────────────────────────────

cat >> "${SNAPSHOT}/${MANIFEST}" <<'EOF'

---

## Untracked / Git-Ignored Files (inventory at backup time)
These files exist locally but are NOT in git. They are at risk from `git reset --hard`.
EOF

cd "$WORKSPACE"
git status --short --ignored 2>/dev/null \
  | grep -E "^\?\?|^!!" \
  | grep -v node_modules \
  | awk '{print "- `"$2"`"}' \
  >> "${SNAPSHOT}/${MANIFEST}" || true

# ── Restore instructions ──────────────────────────────────────────────────────

cat >> "${SNAPSHOT}/${MANIFEST}" <<EOF

---

## Restore Instructions

### Plain files
\`\`\`bash
cd /path/to/workspace
tar -xzf ${PLAIN_TAR}
\`\`\`

### Secrets
\`\`\`bash
export PRODUCTION_BACKUP_PASSPHRASE="your-passphrase"
openssl enc -d -aes-256-cbc -pbkdf2 \\
  -pass env:PRODUCTION_BACKUP_PASSPHRASE \\
  -in ${SECRET_TAR_ENC} | tar -xz -C /path/to/workspace
\`\`\`

### LaunchAgents plists
\`\`\`bash
cp LaunchAgents/*.plist ~/Library/LaunchAgents/
launchctl bootout gui/\$(id -u) ~/Library/LaunchAgents/com.spokesbox.server.plist
launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.spokesbox.server.plist
# repeat for each plist
\`\`\`
EOF

# ── Clean staging (if passphrase was missing, staging dir still exists) ────────

rm -rf "${SNAPSHOT}/secrets-staging"

# ── Latest symlink ────────────────────────────────────────────────────────────

ln -sfn "$SNAPSHOT" "${DEST}/latest"
log "── 'latest' symlink → $SNAPSHOT"

# ── Summary ───────────────────────────────────────────────────────────────────

log "━━━ Backup complete ━━━"
log "  Plain archive : ${SNAPSHOT}/${PLAIN_TAR}"
if [ -f "${SNAPSHOT}/${SECRET_TAR_ENC}" ]; then
  log "  Secrets archive: ${SNAPSHOT}/${SECRET_TAR_ENC}"
else
  log "  Secrets archive: SKIPPED"
fi
log "  Manifest       : ${SNAPSHOT}/${MANIFEST}"
log "  Latest symlink : ${DEST}/latest → ${SNAPSHOT}"
