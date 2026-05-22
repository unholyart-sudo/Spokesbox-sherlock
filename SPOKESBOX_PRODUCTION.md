# Spokesbox — Production Location

## ⚠️ Read This Before Editing Any Spokesbox Code

The **live production app** lives in the `spokesbox/` subdirectory, NOT the workspace root.

---

## Production Paths

| Item | Path |
|---|---|
| **App directory** | `/Users/openclawjg/.openclaw/workspace/spokesbox/` |
| **Server entry** | `/Users/openclawjg/.openclaw/workspace/spokesbox/server.js` |
| **Static assets** | `/Users/openclawjg/.openclaw/workspace/spokesbox/public/` |
| **Lib modules** | `/Users/openclawjg/.openclaw/workspace/spokesbox/lib/` |
| **Dependencies** | `/Users/openclawjg/.openclaw/workspace/spokesbox/node_modules/` |
| **Database** | `/Users/openclawjg/.openclaw/workspace/spokesbox/subscribers.db` |
| **Env file** | `/Users/openclawjg/.openclaw/workspace/spokesbox/.env` |

## launchd Service

```
Label:            com.spokesbox.server
ProgramArguments: /opt/homebrew/bin/node
                  /Users/openclawjg/.openclaw/workspace/spokesbox/server.js
WorkingDirectory: /Users/openclawjg/.openclaw/workspace/spokesbox
Port:             3002
Plist:            ~/Library/LaunchAgents/com.spokesbox.server.plist
stdout:           /tmp/spokesbox.log
stderr:           /tmp/spokesbox-error.log
```

---

## Root Workspace Files Are STALE — Do Not Edit for Production

The workspace root contains `server.js`, `package.json`, `lib/`, and `public/` that
look like Spokesbox. **They are not live.** They are a stale snapshot from an earlier
architecture where the app lived at the root. launchd does not run them.

| File | Status |
|---|---|
| `/server.js` | Stale — 106 lines behind `spokesbox/server.js`; missing Brief Tuning PR 1 |
| `/package.json` | Stale copy — same deps, but not what npm reads at runtime |
| `/lib/` | Stale — missing `brief-sources.js`, `brief-weights.js`, `tune-tokens.js` |
| `/public/` | Stale — diverged from `spokesbox/public/` |

**All production fixes, schema changes, and feature work go in `spokesbox/`.**

---

## Production-Critical Tracked Files

These files must remain committed. They are at risk from `git reset --hard`:

- `spokesbox/server.js`
- `spokesbox/package.json`
- `spokesbox/package-lock.json`
- `spokesbox/lib/`
- `spokesbox/public/`

Files intentionally untracked (secrets/data — backed up to Dropbox):

- `spokesbox/.env`
- `spokesbox/subscribers.db`

---

## Before Any Git Reset

**Always run the safety audit first:**

```bash
bash scripts/safe-git-reset.sh
```

This lists tracked files that would be deleted, untracked files, and binary assets
at risk. It requires typing `YES` if files would be lost.

Raw `git reset --hard` without this audit caused the 2026-05-20 outage that wiped
`rarity-art/`, `skytuned/db.js`, and `spokesbox/package.json`.

---

## Restart / Kick Spokesbox

```bash
# Graceful launchd reload
launchctl kickstart -k gui/$(id -u)/com.spokesbox.server

# Check health
curl -i http://localhost:3002/
```

## Verify Live Version

```bash
# spokesbox/server.js is always the live one
wc -l spokesbox/server.js      # should be > 3900 lines
wc -l server.js                # stale root copy, always shorter
```
