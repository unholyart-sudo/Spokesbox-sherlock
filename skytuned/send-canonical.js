#!/usr/bin/env node
/**
 * SkyTuned Canonical Send Script — v1.0.0
 * Per EMAIL_OUTPUT_STANDARD.md — single source of truth for all SkyTuned sends.
 *
 * This script REPLACES all date-specific send-daily-*.js variants.
 * Those are archived in skytuned/archived/
 *
 * Usage:
 *   node send-canonical.js                   # send today's pre-generated HTML
 *   node send-canonical.js --dry-run         # preview subject/preheader, skip SendGrid
 *   node send-canonical.js --content content.json  # load content from JSON file
 *
 * Content source:
 *   1. --content <path>  — explicit structured JSON (see email-builder.js CONTENT_SCHEMA)
 *   2. SKYTUNED_CONTENT_JSON env var — path to content file
 *   3. ./daily-email-YYYY-MM-DD.html — legacy pre-rendered HTML (passthrough mode)
 *
 * Environment:
 *   SENDGRID_API_KEY — required for live sends
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const { execSync } = require('child_process');
const { buildSkyTunedEmailPayload, validateContent, hasAstrologyContent } = require('./email-builder');

const DRY_RUN   = process.argv.includes('--dry-run');
const DB_PATH   = path.join(__dirname, 'subscribers.db');
const TODAY     = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const DATE_LONG = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  timeZone: 'America/New_York',
});
const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
if (!SENDGRID_KEY && !DRY_RUN) {
  console.error('SENDGRID_API_KEY not set. Cannot send. Use --dry-run to preview.');
  process.exit(1);
}

// ─── Load subscribers ──────────────────────────────────────────────────────
function loadSubscribers() {
  const raw = execSync(
    `sqlite3 "${DB_PATH}" "SELECT email,name,token FROM email_subscribers WHERE active=1;"`,
    { encoding: 'utf8' }
  ).trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    const [email, name, token] = line.split('|');
    return { email: (email||'').trim(), name: (name||'').trim(), token: (token||'').trim() };
  }).filter(s => s.email && s.email.includes('@'));
}

// ─── Send one email ────────────────────────────────────────────────────────
function sendOne(to, name, subject, html, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      personalizations: [{ to: [{ email: to, name }] }],
      from:     { email: 'jared@jaredgreen.com', name: 'SkyTuned' },
      reply_to: { email: 'sherlock.claw@gmail.com' },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html',  value: html  },
      ],
    });
    const req = https.request({
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${SENDGRID_KEY}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      if (res.statusCode === 202) resolve({ ok: true, email: to });
      else {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => resolve({ ok: false, email: to, status: res.statusCode, body: buf }));
      }
    });
    req.on('error', e => resolve({ ok: false, email: to, error: e.message }));
    req.write(body);
    req.end();
  });
}

// ─── LEGACY MODE: passthrough pre-rendered HTML ───────────────────────────
async function legacySend(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  if (hasAstrologyContent(html)) {
    console.error('❌ BLOCKED: Astrology-era content detected in HTML. Aborting send.');
    process.exit(1);
  }
  const subject = `🚀 SkyTuned · Your Daily Orbit — ${DATE_LONG}`;
  const text    = `SkyTuned · Your Daily Orbit — ${DATE_LONG}\n\nView online: https://skytuned.com\n\nUnsubscribe: https://skytuned.com/unsubscribe`;
  const subs    = loadSubscribers();
  console.log(`[LEGACY MODE] Sending pre-rendered HTML to ${subs.length} subscribers...`);
  let sent = 0, failed = 0;
  for (const s of subs) {
    const r = await sendOne(s.email, s.name, subject, html, text);
    if (r.ok) { sent++; process.stdout.write(`✓ ${s.email}\n`); }
    else      { failed++; console.error(`✗ ${s.email}: ${r.body || r.error}`); }
  }
  console.log(`\nDone: ${sent} sent, ${failed} failed`);
}

// ─── STRUCTURED MODE: content JSON → builder → send ──────────────────────
async function structuredSend(contentPath) {
  let content;
  try {
    content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
  } catch (e) {
    console.error(`❌ Failed to load content JSON: ${e.message}`);
    process.exit(1);
  }

  // Inject date if not present
  if (!content.date)       content.date       = DATE_LONG;
  if (!content.sourceDate) content.sourceDate = TODAY;

  const { valid, errors } = validateContent(content);
  if (!valid) {
    console.error('❌ Content validation failed:');
    errors.forEach(e => console.error('  •', e));
    process.exit(1);
  }

  const subs = loadSubscribers();
  console.log(`Found ${subs.length} active subscribers.`);

  // Preview in dry-run
  const preview = buildSkyTunedEmailPayload(content, { email: 'preview@example.com', token: 'preview' });
  console.log(`Subject:   ${preview.subject}`);
  console.log(`Preheader: ${preview.preheader}`);

  if (DRY_RUN) {
    console.log('[DRY-RUN] Skipping SendGrid call.');
    process.exit(0);
  }

  let sent = 0, failed = 0;
  for (const s of subs) {
    const payload = buildSkyTunedEmailPayload(content, s);
    const r = await sendOne(s.email, s.name, payload.subject, payload.html, payload.text);
    if (r.ok) { sent++; process.stdout.write(`✓ ${s.email}\n`); }
    else      { failed++; console.error(`✗ ${s.email}: ${r.body || r.error}`); }
  }
  console.log(`\nDone: ${sent} sent, ${failed} failed`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
(async () => {
  const contentArg = (() => {
    const i = process.argv.indexOf('--content');
    return i !== -1 ? process.argv[i + 1] : (process.env.SKYTUNED_CONTENT_JSON || null);
  })();

  if (contentArg) {
    await structuredSend(contentArg);
  } else {
    // Fall back to today's pre-rendered HTML
    const htmlFile = path.join(__dirname, `daily-email-${TODAY}.html`);
    if (!fs.existsSync(htmlFile)) {
      console.error(`❌ No content JSON and no pre-rendered HTML found for ${TODAY}.`);
      console.error(`   Expected: ${htmlFile}`);
      console.error(`   Or pass: --content path/to/content.json`);
      process.exit(1);
    }
    await legacySend(htmlFile);
  }
})();
