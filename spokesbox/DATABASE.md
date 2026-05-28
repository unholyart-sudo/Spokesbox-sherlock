# Spokesbox — Database Notes

## ⚠️ DO NOT COMMIT subscribers.db TO GIT

`subscribers.db` is a **runtime file**, not a source asset. See `torahtxt/DATABASE.md` for the full rationale.

- Excluded from git via `.gitignore` (*.db pattern)
- Recovery: timestamped backups → `backups/YYYY-MM-DD_*/spokesbox_subscribers.db`
- Backup script: `bash scripts/backup-production-critical.sh`
