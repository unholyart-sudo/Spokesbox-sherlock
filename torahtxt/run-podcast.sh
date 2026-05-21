#!/bin/bash
# TorahTxt Daily Podcast — runner script
# Called by OpenClaw cron at 6:45 AM ET daily
# Reads API keys from env file, runs generator, logs result

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.podcast"
LOG="$SCRIPT_DIR/../podcasts/daily-torah/podcast.log"

if [ ! -f "$ENV_FILE" ]; then
  echo "[$(date -u +%FT%TZ)] FATAL: $ENV_FILE not found" >> "$LOG"
  exit 1
fi

# Source env vars (ELEVENLABS_API_KEY, ANTHROPIC_API_KEY)
set -a
source "$ENV_FILE"
set +a

cd "$SCRIPT_DIR"
node generate-podcast.js "$@" 2>&1
