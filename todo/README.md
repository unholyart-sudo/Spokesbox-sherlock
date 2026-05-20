# TODO — Google Sheets Sync

## Credential setup (required)

The TODO sync requires a Google service account key file:

```
/Users/openclawjg/.openclaw/workspace/google-service-account.json
```

**Service account:** `sherlock-sheets@openclaw-jg.iam.gserviceaccount.com`  
**GCP project:** `openclaw-jg`  
**This file is gitignored — never commit it.**

### If the file is missing

1. Go to [GCP Console → IAM → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=openclaw-jg)
2. Find `sherlock-sheets@openclaw-jg.iam.gserviceaccount.com`
3. Actions → Manage Keys → Add Key → Create new key → JSON
4. Download and save to `/Users/openclawjg/.openclaw/workspace/google-service-account.json`
5. `chmod 600 /Users/openclawjg/.openclaw/workspace/google-service-account.json`

### Required Google Cloud APIs

Enable at https://console.cloud.google.com/apis/library?project=openclaw-jg :
- **Google Sheets API** (`sheets.googleapis.com`) ← required
- **Google Drive API** (`drive.googleapis.com`) ← optional

### Google Sheet access

The sheet must be shared with the service account email:  
`sherlock-sheets@openclaw-jg.iam.gserviceaccount.com` — Editor or Viewer access

**Sheet ID:** `1-6q3E6fHbX8BuaDdgY2Y-O6sG1MlEqHWyg6HuBJXS5Q`  
**Tab:** `TODO`

---

## Usage

```bash
# Summary view
node todo/sync-sheet.js --summary

# JSON output (for email builder)
node todo/sync-sheet.js | jq '.meta'
```

## Files

| File | Purpose |
|---|---|
| `todo/sync-sheet.js` | Reads TODO Google Sheet → structured sections JSON |
| `todo/email-builder.js` | Renders sections → HTML/text email payload |
| `google-service-account.json` | ⚠️ Gitignored credential — never commit |
