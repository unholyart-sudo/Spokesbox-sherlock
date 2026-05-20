#!/usr/bin/env node
/**
 * send-single.js — Resend today's TorahTxt email to one address.
 * Uses the canonical email-builder.js (EMAIL_OUTPUT_STANDARD.md v1.0.0).
 *
 * Usage:
 *   node send-single.js <email>
 *   node send-single.js jared@jaredgreen.com
 */
require('dotenv').config();

const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const { buildDailyEmailPayload } = require('./email-builder');

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
if (!SENDGRID_KEY) {
  console.error('SENDGRID_API_KEY env var not set. Cannot send.');
  process.exit(1);
}
const DB_PATH      = path.join(__dirname, 'subscribers.db');

// ─── Args ──────────────────────────────────────────────────────────────────────
const targetEmail = (process.argv[2] || '').trim();
if (!targetEmail || !targetEmail.includes('@')) {
  console.error('Usage: node send-single.js <email>');
  process.exit(1);
}

// ─── Load today's content ──────────────────────────────────────────────────────
const sourceDate  = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const contentPath = path.join(__dirname, 'content', 'daily', `${sourceDate}.json`);
if (!fs.existsSync(contentPath)) {
  console.error(`No content file for ${sourceDate}: ${contentPath}`);
  process.exit(1);
}
const expanded = JSON.parse(fs.readFileSync(contentPath, 'utf8'));

// ─── Subscriber lookup (name + token) ─────────────────────────────────────────
let recipientName  = 'Friend';
let recipientToken = 'unsubscribe-token';
try {
  const { execSync } = require('child_process');
  const row = execSync(
    `sqlite3 "${DB_PATH}" "SELECT name,token FROM email_subscribers WHERE lower(email)='${targetEmail.toLowerCase()}' LIMIT 1;"`,
    { encoding: 'utf8' }
  ).trim();
  if (row) {
    const [n, t] = row.split('|');
    if (n) recipientName  = n;
    if (t) recipientToken = t;
  }
} catch (e) { /* non-fatal — fall back to defaults */ }

// ─── Build payload via canonical builder ──────────────────────────────────────
const dateStr = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  timeZone: 'America/New_York',
});
const imgPath     = path.join(__dirname, 'public', 'images', 'daily', `${sourceDate}.jpg`);
const imageUrl    = fs.existsSync(imgPath) ? `/images/daily/${sourceDate}.jpg` : null;

const payload = buildDailyEmailPayload({
  name:       recipientName,
  date:       dateStr,
  title:      expanded.title || 'Daily D\'var Torah',
  parasha:    expanded.title || 'Weekly Parasha',
  message:    expanded.email || expanded.sms || '',
  token:      recipientToken,
  email:      targetEmail,
  imageUrl,
  kids:       expanded.kids || null,
  sourceDate,
});

// ─── Send via SendGrid ─────────────────────────────────────────────────────────
const body = JSON.stringify({
  personalizations: [{ to: [{ email: targetEmail, name: recipientName }] }],
  from:    { email: payload.metadata.from_email, name: payload.metadata.from_name },
  reply_to:{ email: payload.metadata.reply_to },
  subject: payload.subject,
  content: [
    { type: 'text/plain', value: payload.text },
    { type: 'text/html',  value: payload.html  },
  ],
});

const req = https.request({
  hostname: 'api.sendgrid.com',
  path:     '/v3/mail/send',
  method:   'POST',
  headers: {
    'Authorization':  `Bearer ${SENDGRID_KEY}`,
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
}, res => {
  if (res.statusCode === 202) {
    console.log(`✅ Sent to ${targetEmail} (${recipientName})`);
    console.log(`   Subject:   ${payload.subject}`);
    console.log(`   Preheader: ${payload.preheader.slice(0, 80)}…`);
  } else {
    let buf = '';
    res.on('data', d => buf += d);
    res.on('end', () => console.error(`❌ SendGrid ${res.statusCode}: ${buf}`));
  }
});
req.on('error', e => console.error('Request error:', e.message));
req.write(body);
req.end();
