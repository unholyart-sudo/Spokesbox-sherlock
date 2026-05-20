#!/bin/bash
# Server watchdog — HTTP health monitor for all 4 Node.js servers
# Run every 15 minutes via cron
#
# ARCHITECTURE (post May 14 2026 refactor):
# ─────────────────────────────────────────
# ALL 4 servers are managed by launchd (KeepAlive=true in ~/Library/LaunchAgents/).
# launchd is the canonical crash supervisor — it restarts processes immediately
# when they die. This watchdog's job is HTTP-level health monitoring only:
# it catches hung Node event loops (alive process, but not responding to HTTP)
# that launchd cannot detect.
#
# When a server fails its HTTP check, the watchdog kills the PID by port and
# EXITS — launchd handles the restart. The watchdog never directly launches
# Node processes. Two restarters racing = EADDRINUSE errors.
#
# LaunchAgent plists: ~/Library/LaunchAgents/
#   com.skytuned.server.plist   (port 3001)
#   com.torahtxt.server.plist   (port 3000)
#   com.spokesbox.server.plist  (port 3002)
#   com.rarity.server.plist     (port 3005)
#
# ⚠️  COMMIT THIS FILE after every edit.
#     Pre-commit hook at .git/hooks/pre-commit enforces this.
#     "Manually edited, never committed" caused spokesbox to be silently
#     dropped from monitoring (May 13 2026 incident).

LOG="/tmp/watchdog.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')
LAUNCHD_UID=$(id -u)

check_and_kick() {
  local name="$1"
  local port="$2"
  local label="$3"  # launchd service label

  # HTTP healthcheck — accepts 2xx/3xx/4xx as healthy.
  # Only 5xx or connection failure (000) indicates a problem.
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "http://localhost:${port}/")

  if echo "$http_code" | grep -qE "^[2-4]"; then
    echo "$DATE [$name] OK ✅" >> "$LOG"
    return
  fi

  echo "$DATE [$name] DOWN (http_code=${http_code:-none}) — kicking launchd..." >> "$LOG"

  # Kill by port — surgical, never touches other servers.
  # launchd (KeepAlive=true) will restart the process automatically.
  local pid
  pid=$(lsof -ti:"$port" 2>/dev/null)
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null
    fi
    echo "$DATE [$name] PID $pid killed — launchd will restart" >> "$LOG"
  else
    # Process not on port — launchd may be throttling after rapid exits.
    # kickstart -k forces an immediate restart.
    launchctl kickstart -k "gui/${LAUNCHD_UID}/${label}" 2>/dev/null
    echo "$DATE [$name] No PID on port — kickstarted via launchd" >> "$LOG"
  fi
}

check_and_kick "skytuned"   "3001" "com.skytuned.server"
check_and_kick "torahtxt"   "3000" "com.torahtxt.server"
check_and_kick "spokesbox"  "3002" "com.spokesbox.server"
check_and_kick "rarity-art" "3005" "com.rarity.server"
