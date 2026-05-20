#!/usr/bin/env node
/**
 * TODO Google Sheets Sync — v1.0.0
 * Reads the TODO Google Sheet and returns structured sections.
 *
 * Usage:
 *   node todo/sync-sheet.js                   # print JSON to stdout
 *   node todo/sync-sheet.js --summary         # print human-readable summary
 *   const { loadTodoFromSheet } = require('./todo/sync-sheet');
 *
 * Credential: /Users/openclawjg/.openclaw/workspace/google-service-account.json
 * Sheet ID:   1-6q3E6fHbX8BuaDdgY2Y-O6sG1MlEqHWyg6HuBJXS5Q
 * Tab:        TODO
 *
 * ⚠️  SECURITY:
 *   - Never commit google-service-account.json (gitignored)
 *   - Never print private_key or client_email in logs
 *   - Read-only scope only (spreadsheets.readonly)
 */

'use strict';

const fs      = require('fs');
const https   = require('https');
const crypto  = require('crypto');
const path    = require('path');

const SA_PATH   = path.join(__dirname, '..', 'google-service-account.json');
const SHEET_ID  = '1-6q3E6fHbX8BuaDdgY2Y-O6sG1MlEqHWyg6HuBJXS5Q';
const SHEET_TAB = 'TODO';
const RANGE     = `${SHEET_TAB}!A1:D2000`;
const SCOPE     = 'https://www.googleapis.com/auth/spreadsheets.readonly';

// ─── Preflight check ────────────────────────────────────────────────────────

function preflight() {
  if (!fs.existsSync(SA_PATH)) {
    throw new Error(
      `google-service-account.json not found at:\n  ${SA_PATH}\n\n` +
      `To restore:\n` +
      `  1. Download a key for sherlock-sheets@openclaw-jg.iam.gserviceaccount.com\n` +
      `     from GCP Console → IAM → Service Accounts → Keys\n` +
      `  2. Save it to: ${SA_PATH}\n` +
      `  3. chmod 600 ${SA_PATH}\n\n` +
      `Required GCP APIs:\n` +
      `  - Google Sheets API (sheets.googleapis.com)\n` +
      `  - Google Drive API  (drive.googleapis.com) [for listing sheets if needed]\n\n` +
      `Enable at: https://console.cloud.google.com/apis/library?project=openclaw-jg`
    );
  }
  let sa;
  try { sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8')); }
  catch (e) { throw new Error(`Failed to parse ${SA_PATH}: ${e.message}`); }
  if (!sa.private_key || !sa.client_email) {
    throw new Error('google-service-account.json is malformed — missing private_key or client_email');
  }
  return sa;
}

// ─── JWT + token ─────────────────────────────────────────────────────────────

function b64url(buf) {
  return (typeof buf === 'string' ? Buffer.from(buf) : buf)
    .toString('base64url');
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  }));
  const signingInput = `${header}.${payload}`;
  const sign  = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const sig   = b64url(sign.sign(sa.private_key));
  const jwt   = `${signingInput}.${sig}`;

  const body  = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res   = await post('oauth2.googleapis.com', '/token', body, 'application/x-www-form-urlencoded');
  if (!res.access_token) {
    const errMsg = res.error_description || res.error || JSON.stringify(res).slice(0,200);
    throw new Error(`Google auth failed: ${errMsg}\n  (Is the Sheets API enabled at https://console.cloud.google.com/apis/library?project=openclaw-jg ?)`);
  }
  return res.access_token;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function post(hostname, path, body, contentType) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch(e) { resolve(buf); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch(e) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── Sheet parser ─────────────────────────────────────────────────────────────

// Section markers: emoji prefix or all-caps header text
const SECTION_RE = /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|[A-Z0-9]{2,}\s)/u;

function isSectionHeader(colA) {
  if (!colA) return false;
  return SECTION_RE.test(colA.trim()) && colA.trim().length > 1;
}

function parseSheet(rows) {
  // Skip header row (SECTION | ITEM | STATUS | NOTES)
  const dataRows = rows.slice(1);
  const sections = [];
  let currentSection = null;

  for (const row of dataRows) {
    if (!row || row.length === 0) continue;
    const [col0, col1, col2, col3] = row;

    // New section: col A looks like a section header
    if (col0 && isSectionHeader(col0)) {
      currentSection = { section: col0.trim(), items: [] };
      sections.push(currentSection);
      // Col B may ALSO contain an item on the same row
      if (col1) {
        currentSection.items.push({
          item:   col1.trim(),
          status: (col2 || '').trim() || null,
          notes:  (col3 || '').trim() || null,
        });
      }
      continue;
    }

    // Item row: col B has content (col A empty or non-section)
    if (col1) {
      if (!currentSection) {
        currentSection = { section: 'Uncategorized', items: [] };
        sections.push(currentSection);
      }
      currentSection.items.push({
        item:   col1.trim(),
        status: (col2 || '').trim() || null,
        notes:  (col3 || '').trim() || null,
      });
    }
  }

  return sections;
}

// ─── Main export ─────────────────────────────────────────────────────────────

async function loadTodoFromSheet() {
  const sa    = preflight();
  const token = await getAccessToken(sa);
  const apiPath = `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(RANGE)}`;
  const res = await get('sheets.googleapis.com', apiPath, token);

  if (res.status !== 200) {
    const err = typeof res.body === 'object'
      ? (res.body?.error?.message || JSON.stringify(res.body).slice(0,300))
      : String(res.body).slice(0,300);
    throw new Error(`Sheets API error ${res.status}: ${err}\n  → Check https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=openclaw-jg`);
  }

  const rows     = res.body?.values || [];
  const sections = parseSheet(rows);
  const totalItems = sections.reduce((n, s) => n + s.items.length, 0);

  return {
    sections,
    meta: {
      sheetId:    SHEET_ID,
      tab:        SHEET_TAB,
      totalRows:  rows.length,
      totalItems,
      loadedAt:   new Date().toISOString(),
    },
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    try {
      const { sections, meta } = await loadTodoFromSheet();
      if (process.argv.includes('--summary')) {
        console.log(`\nTODO Sheet — loaded ${meta.totalItems} tasks across ${sections.length} sections`);
        console.log(`Sheet: ${meta.sheetId} (${meta.tab}) | ${meta.totalRows} rows`);
        for (const sec of sections) {
          console.log(`\n  ${sec.section} (${sec.items.length} items)`);
          for (const it of sec.items.slice(0, 3)) {
            const status = it.status ? ` [${it.status}]` : '';
            console.log(`    • ${it.item}${status}`);
          }
          if (sec.items.length > 3) console.log(`    … +${sec.items.length - 3} more`);
        }
      } else {
        // Output clean JSON — no credentials
        console.log(JSON.stringify({ sections, meta }, null, 2));
      }
    } catch (e) {
      console.error('\n❌ TODO sync failed:\n', e.message);
      process.exit(1);
    }
  })();
}

module.exports = { loadTodoFromSheet };
