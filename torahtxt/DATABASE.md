# TorahTxt — Database Notes

## ⚠️ DO NOT COMMIT subscribers.db TO GIT

`subscribers.db` is a **runtime file**, not a source asset.

- It is excluded from git via `.gitignore` (*.db pattern)
- Committing it creates a dangerous snapshot: a `git reset --hard` will silently revert the live DB to that old snapshot, wiping all newer subscribers
- **This is exactly what happened on May 20, 2026** — a git reset reverted the DB to a March snapshot and wiped months of subscriber growth

## Recovery Sources (in order)

1. **Timestamped backups** → `backups/YYYY-MM-DD_HHMMSS_*/torahtxt_subscribers.db`
2. **Google Sheets** → "TorahTxt Subscribers" tab (mirrored by cron / manual export)
3. **Telnyx MDRS report** → Download from portal.telnyx.com — shows every number that was ever successfully delivered to

## Schema

```sql
CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT UNIQUE,
  token TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE email_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT UNIQUE,
  token TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
```

## Backup Procedure

```bash
bash scripts/backup-production-critical.sh
```

## Hard Rules

- Never `git add *.db`
- Never `git reset --hard` without running `scripts/safe-git-reset.sh` first
- Restore from backup, not from git
