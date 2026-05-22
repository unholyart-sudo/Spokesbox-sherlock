# OPENCLAW_OPS.md — Operational Runbook

Gateway incidents, recovery procedures, and health check guidance.

---

## Incidents

### 2026-05-22 — Auto-Update Gateway Crash (WhatsApp Silent)

**Detected:** ~5:00 PM EDT (Jride noticed no WhatsApp responses)
**Resolved:** ~5:05 PM EDT (launchd auto-restart)

#### Root Cause
OpenClaw received an automatic update overnight. The update left stale compiled
module references in the gateway bundle. When the gateway attempted to use them,
it crashed with:

```
[gateway] shutdown error: Cannot find module
  '/opt/homebrew/lib/node_modules/openclaw/dist/hook-runner-global-DIpzvALt.js'
[gateway] request handler failed: Cannot find module
  '/opt/homebrew/lib/node_modules/openclaw/dist/task-registry.maintenance-B-jsfe-3.js'
```

#### Timeline
| Time (EDT) | Event |
|------------|-------|
| ~1:07 AM | Gateway crashed — missing module error on shutdown |
| ~3:33 PM | launchd attempted reload → `Bootstrap failed: 5 (I/O error)` |
| ~5:05 PM | launchd successful restart → PID 1438, gateway running |
| 5:39 PM | WhatsApp diagnostic sent — confirmed responding |

#### Symptoms
- WhatsApp messages received but no AI reply (gateway down)
- Cron jobs that ran during downtime show `interrupted by gateway restart`
- `launchctl list | grep openclaw` shows last exit = `-9` (SIGKILL) after recovery

#### Recovery
launchd automatic restart via `ai.openclaw.gateway` plist. No manual action needed.

#### Residual: Stale File Lock
After recovery, a stale session write lock was observed:
```
file lock stale for sessions/443940b0-...jsonl
```
This did not affect the main WhatsApp session. If background cron jobs fail
after a crash-recovery cycle, run:
```
openclaw gateway restart
```

#### Prevention
None available at user level — OpenClaw handles its own update cycle.
Run `check-openclaw-gateway.sh` after any observed silence to confirm status.

---

## Production-Critical Backup

**Script:** `scripts/backup-production-critical.sh`
**Destination:** `~/Dropbox/OpenClaw Backups/production-critical/YYYY-MM-DD_HH-MM-SS/`

### What runs without a passphrase (plain backup)
Safe to run anytime. No secrets in output:
- `MEMORY.md`, `COST_CONTROL.md`, `OPENCLAW_OPS.md`, `watchdog.sh`
- `server.js`, `package.json`, `package-lock.json`
- `scripts/` (backup + reset scripts)
- `spokesbox/server.js`, `spokesbox/public/`, `spokesbox/lib/`
- `lib/`, `email/`, `public/`
- `memory/` directory (daily notes, design specs — untracked by git)
- All 7 launchd plists (including `ai.openclaw.gateway.plist`)

### What requires `PRODUCTION_BACKUP_PASSPHRASE` (encrypted backup)
Without this passphrase **these are NOT backed up** and will be lost on rebuild:
- `spokesbox/.env`, `torahtxt/.env.podcast`, `skytuned/.env`, any other `.env*`
- `google-service-account.json`, `google-vertex-service-account.json`
- `skytuned/subscribers.db`, `torahtxt/subscribers.db`, `spokesbox/subscribers.db`
- Any other `*.db` / `*.sqlite` files under workspace

To enable: `export PRODUCTION_BACKUP_PASSPHRASE="your-passphrase"` then run script.

### Cron export (separate)
Run after any cron changes:
```bash
# Via agent — ask: "export cron config to Dropbox"
# Output: ~/Dropbox/OpenClaw Backups/cron-exports/cron-export-TIMESTAMP.json
# All secrets are redacted in the export
```

---

## Health Check Script

**Location:** `scripts/check-openclaw-gateway.sh`

Checks:
- `ai.openclaw.gateway` launchctl state and PID
- Recent restart log entries
- Gateway log for: missing modules, bootstrap failures, stale locks, shutdown errors
- WhatsApp connection status

**Run:**
```bash
bash /Users/openclawjg/.openclaw/workspace/scripts/check-openclaw-gateway.sh
```

**Exit codes:**
- `0` = healthy or warnings only
- `1` = gateway not running or unrecovered fatal errors

**Stale lock guidance** (from script output):
> Stale locks are not deleted automatically. Run `openclaw gateway restart` to clear.

---

## Launchd Service Labels

| Label | Service | Port |
|-------|---------|------|
| `ai.openclaw.gateway` | OpenClaw gateway | 18789 |
| `com.torahtxt.server` | TorahTxt SMS/email | 3000 |
| `com.skytuned.server` | SkyTuned email | 3001 |
| `com.spokesbox.server` | Spokesbox | 3002 |
| `com.rarity.server` | Rarity art | 3005 |
| `com.torahtxt.cloudflared` | Cloudflare tunnel | — |
| `com.torahtxt.caffeinate` | Prevent sleep | — |

**Check all services:**
```bash
launchctl list | grep -E "openclaw|torahtxt|spokesbox|skytuned|rarity"
```

**Restart a specific service** (substitute label):
```bash
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```

---

## Known Patterns

### Gateway exits -9 after update
Normal — launchd SIGKILL'd the old process to replace it with the updated one.
Check that new process started: `launchctl list | grep openclaw` should show a PID.

### WhatsApp status 428 / 503 / 499 drops
Normal transient WebSocket drops from WhatsApp's servers. OpenClaw retries
automatically (up to 12 retries). Only escalate if WA shows auth failure or
QR code re-authentication required.

### `Bootstrap failed: 5 (Input/output error)` on restart
Intermittent macOS launchd issue — usually resolves on next retry. If persistent,
check disk health and Dropbox sync conflicts in `~/Library/LaunchAgents/`.

### Stale file lock on session JSONL
Leftover write lock from a process that was SIGKILL'd mid-write.
Does not affect main WhatsApp session in most cases.
Clear with: `openclaw gateway restart`

---

## Watchdog

**Script:** `watchdog.sh` — checks TorahTxt, SkyTuned, Spokesbox, Rarity ports.
**Cron:** `9b63e9b0` — every 15 min, alerts Jride on WhatsApp if a service restarts.

OpenClaw gateway itself is **not** covered by `watchdog.sh` — it is managed
exclusively by launchd. Use `check-openclaw-gateway.sh` for gateway health.

---

*Last updated: 2026-05-22*
