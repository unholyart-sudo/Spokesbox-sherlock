# spokesbox/archived/ — Retired Send Scripts

## ⚠️ DO NOT RUN ANY SCRIPT IN THIS DIRECTORY

These scripts are kept for historical reference only. They are not scheduled, not maintained, and must never be executed against production.

---

## Why they're here

These scripts were early one-off senders built before the canonical OpenClaw cron architecture was established. They contain:
- Hardcoded real subscriber emails (Jride, Avi, Bob, jared@rarityadvisors.com)
- Stale date strings and content
- Old dark/legacy templates
- Old or expired SendGrid API keys

Running any of these will send stale, duplicate, or broken emails to real people.

---

## Canonical sender

All Spokesbox daily emails are sent exclusively by:

**OpenClaw cron `e727f97e` — "Spokesbox Daily Brief — 7:00 AM"**
- Schedule: 7:00 AM ET daily
- Template: light theme, spokesbox-logo.png
- Recipients: Jride, Avi, Bob, jared@rarityadvisors.com, jared@jaredgreen.com
- Idempotency: per-recipient ledger at `spokesbox/send-ledger/YYYY-MM-DD.json`

**Disabled (must stay disabled):**
- `edc6e0e8` — "Spokesbox — Hourly Newsletter Send" — caused duplicate emails May 22, 2026

---

## Files

| File | Original path | Archived | Reason |
|---|---|---|---|
| `send_newsletters_DO_NOT_RUN.py` | `spokesbox/send_newsletters.py` | 2026-05-22 | Duplicate-email source; stale May 21 content; hardcoded recipients |
