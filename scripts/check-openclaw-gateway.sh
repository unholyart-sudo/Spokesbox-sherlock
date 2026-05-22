#!/bin/bash
# check-openclaw-gateway.sh
#
# Lightweight OpenClaw gateway health check.
# Designed to run after system boots, updates, or on-demand.
#
# Checks:
#   - launchctl load/run state + PID
#   - Recent gateway log for: missing modules, bootstrap failures,
#     stale locks, shutdown errors
#   - WhatsApp connection status
#
# Exit codes:
#   0 = gateway running, no fatal issues (warnings OK)
#   1 = gateway not running OR unrecovered missing-module errors
#
# Does NOT print credentials, secrets, or session file contents.
# Does NOT delete stale locks automatically.
# Does NOT restart the gateway automatically.

set -euo pipefail

LABEL="ai.openclaw.gateway"
LOG_FILE="$HOME/.openclaw/logs/gateway.err.log"
RESTART_LOG="$HOME/.openclaw/logs/gateway-restart.log"
LOG_LINES=200
WARN=0
FATAL=0

hr()    { printf '%0.s-' {1..60}; echo; }
ok()    { echo "  [OK]   $*"; }
warn()  { echo "  [WARN] $*"; WARN=$((WARN+1)); }
fatal() { echo "  [FAIL] $*"; FATAL=$((FATAL+1)); }
info()  { echo "  [INFO] $*"; }

echo ""
hr
echo "  OpenClaw Gateway Health Check -- $(date '+%Y-%m-%d %H:%M:%S %Z')"
hr

# ---- 1. launchctl state ------------------------------------------------------

echo ""
echo "[ 1 ] launchctl state"

LAUNCHD_LINE=$(launchctl list | grep "$LABEL" 2>/dev/null || true)
if [ -z "$LAUNCHD_LINE" ]; then
  fatal "Label '$LABEL' not found in launchctl -- plist may not be loaded"
else
  GW_PID=$(echo "$LAUNCHD_LINE" | awk '{print $1}')
  GW_EXIT=$(echo "$LAUNCHD_LINE" | awk '{print $2}')

  if [ "$GW_PID" = "-" ] || [ -z "$GW_PID" ]; then
    fatal "Gateway not running (PID: none, last exit: $GW_EXIT)"
  else
    ok "Gateway running -- PID $GW_PID, last exit code: $GW_EXIT"
    if [ "$GW_EXIT" = "-9" ]; then
      warn "Last exit was -9 (SIGKILL) -- gateway was force-killed before current run; launchd restarted it"
    elif [ "$GW_EXIT" != "0" ] && [ "$GW_EXIT" != "-" ]; then
      warn "Non-zero last exit code: $GW_EXIT -- possible crash on previous run"
    fi
  fi
fi

# ---- 2. Recent restart log ---------------------------------------------------

echo ""
echo "[ 2 ] Recent restart history (last 5 entries)"

if [ -f "$RESTART_LOG" ]; then
  tail -10 "$RESTART_LOG" | grep -v "^$" | tail -5 | while read -r line; do
    if echo "$line" | grep -qiE "failed|error" 2>/dev/null; then
      warn "$(echo "$line" | cut -c1-120)"
    else
      info "$(echo "$line" | cut -c1-120)"
    fi
  done
else
  warn "Restart log not found: $RESTART_LOG"
fi

# ---- 3. Scan recent gateway log for fatal patterns --------------------------

echo ""
echo "[ 3 ] Recent log scan (last $LOG_LINES lines)"

if [ ! -f "$LOG_FILE" ]; then
  warn "Gateway log not found: $LOG_FILE"
else
  RECENT_LOG=$(tail -$LOG_LINES "$LOG_FILE")

  # --- Missing module check ---
  # Only fatal if the error timestamp is AFTER the current PID's start time.
  # This correctly ignores pre-recovery errors from a prior crash.
  MISSING_MOD=$(echo "$RECENT_LOG" | grep "Cannot find module" | tail -5 || true)
  if [ -n "$MISSING_MOD" ]; then
    # Current PID start time as epoch
    GW_PID_NOW=$(launchctl list | grep "$LABEL" | awk '{print $1}')
    PID_START_EPOCH=0
    if [ -n "$GW_PID_NOW" ] && [ "$GW_PID_NOW" != "-" ] && [ "$GW_PID_NOW" != "" ]; then
      RAW_LSTART=$(ps -p "$GW_PID_NOW" -o lstart= 2>/dev/null | sed 's/^ *//' || true)
      if [ -n "$RAW_LSTART" ]; then
        PID_START_EPOCH=$(date -j -f "%a %b %d %T %Y" "$RAW_LSTART" "+%s" 2>/dev/null || echo 0)
      fi
    fi

    # Last missing-module error timestamp as epoch
    LAST_MISSING_TS=$(echo "$MISSING_MOD" | tail -1 \
      | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' || true)
    MISSING_EPOCH=0
    if [ -n "$LAST_MISSING_TS" ]; then
      MISSING_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$LAST_MISSING_TS" "+%s" 2>/dev/null || echo 0)
    fi

    if [ "$PID_START_EPOCH" -gt 0 ] 2>/dev/null && \
       [ "$MISSING_EPOCH"   -gt 0 ] 2>/dev/null && \
       [ "$MISSING_EPOCH"   -lt "$PID_START_EPOCH" ] 2>/dev/null; then
      warn "Missing-module errors in log predate current PID start -- pre-recovery, resolved"
    else
      fatal "Missing-module errors may be active (not clearly pre-PID):"
      echo "$MISSING_MOD" | while read -r line; do
        echo "     $(echo "$line" | sed 's/.*Cannot find module/Cannot find module/' | cut -c1-100)"
      done
    fi
  else
    ok "No missing-module errors in recent log"
  fi

  # --- Bootstrap failures ---
  BOOTSTRAP=$(echo "$RECENT_LOG" | grep "Bootstrap failed" | tail -3 || true)
  if [ -n "$BOOTSTRAP" ]; then
    warn "Bootstrap failure(s) in recent log:"
    echo "$BOOTSTRAP" | while read -r line; do
      echo "     $(echo "$line" | cut -c1-120)"
    done
  else
    ok "No bootstrap failures in recent log"
  fi

  # --- Stale file locks ---
  STALE=$(echo "$RECENT_LOG" | grep "file lock stale" | tail -5 || true)
  if [ -n "$STALE" ]; then
    warn "Stale file lock(s) detected:"
    echo "$STALE" | grep -oE 'sessions/[a-f0-9-]+\.jsonl' | sort -u | while read -r path; do
      echo "     Affected: .../$path"
    done
    echo ""
    echo "     Stale locks are NOT deleted automatically."
    echo "     To clear: run   openclaw gateway restart"
    echo "     (Does not affect main WhatsApp session in most cases.)"
  else
    ok "No stale file lock warnings in recent log"
  fi

  # --- Shutdown errors ---
  SHUTDOWN=$(echo "$RECENT_LOG" | grep "shutdown error" | tail -3 || true)
  if [ -n "$SHUTDOWN" ]; then
    warn "Shutdown error(s) in recent log (likely pre-recovery):"
    echo "$SHUTDOWN" | while read -r line; do
      echo "     $(echo "$line" | cut -c1-120)"
    done
  else
    ok "No shutdown errors in recent log"
  fi

fi

# ---- 4. WhatsApp status -------------------------------------------------------

echo ""
echo "[ 4 ] WhatsApp connection status"

if [ -f "$LOG_FILE" ]; then
  WA_RECENT=$(tail -$LOG_LINES "$LOG_FILE" | grep "\[whatsapp\]" | tail -10 || true)
  if [ -z "$WA_RECENT" ]; then
    info "No recent WhatsApp log entries (normal if idle)"
  else
    WA_FATAL=$(echo "$WA_RECENT" | grep -iE "auth.*fail|session.*invalid|logged out|qr code" | tail -3 || true)
    WA_WATCHDOG=$(echo "$WA_RECENT" | grep "watchdog timeout" | tail -3 || true)
    WA_CLOSED=$(echo "$WA_RECENT" | grep "connection closed" | tail -3 || true)

    if [ -n "$WA_FATAL" ]; then
      fatal "WhatsApp auth/session issue detected -- re-authentication may be required"
    else
      ok "No active WhatsApp auth failures"
    fi

    if [ -n "$WA_WATCHDOG" ]; then
      WDOG_COUNT=$(echo "$WA_WATCHDOG" | wc -l | tr -d ' ')
      warn "WhatsApp watchdog timeout(s) in recent log ($WDOG_COUNT) -- auto-recovered"
    fi

    if [ -n "$WA_CLOSED" ] && [ -z "$WA_WATCHDOG" ]; then
      info "WhatsApp connection drop(s) in log -- likely self-recovered"
    fi
  fi
else
  warn "Cannot check WhatsApp -- log file missing"
fi

# ---- Summary -----------------------------------------------------------------

echo ""
hr
echo "  Summary"
hr
echo "  Warnings : $WARN"
echo "  Fatals   : $FATAL"
echo ""

if [ "$FATAL" -gt 0 ]; then
  echo "  ACTION REQUIRED -- see fatal issues above"
  echo "  If due to missing modules after update: launchd will retry,"
  echo "  or run: openclaw gateway restart"
  echo ""
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo "  Gateway healthy -- warnings present, review above"
  echo "  Stale locks: run 'openclaw gateway restart' if cron jobs fail"
  echo ""
  exit 0
else
  echo "  Gateway healthy -- no issues found"
  echo ""
  exit 0
fi
