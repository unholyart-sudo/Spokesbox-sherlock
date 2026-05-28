require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Parse a single CSV row, handling quoted fields (including multi-line within quotes)
function parseCSVRow(row) {
  const fields = [];
  let i = 0;
  while (i < row.length) {
    if (row[i] === '"') {
      // Quoted field
      i++;
      let val = '';
      while (i < row.length) {
        if (row[i] === '"' && row[i+1] === '"') { val += '"'; i += 2; }
        else if (row[i] === '"') { i++; break; }
        else { val += row[i++]; }
      }
      fields.push(val);
      if (row[i] === ',') i++;
    } else {
      // Unquoted field
      let end = row.indexOf(',', i);
      if (end === -1) end = row.length;
      fields.push(row.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}
const { initDb, addSubscriber, removeSubscriberByToken, removeSubscriberByPhone, getActiveSubscribers, getSubscriberCount, addEmailSubscriber, lookupEmailSubscriberByToken, removeEmailSubscriberByToken, removeEmailSubscriberByEmail, getActiveEmailSubscribers, getEmailSubscriberCount, tryAcquireBlastLock, updateBlastLock, getBlastLock, listBlastLocks, recordLedgerEntry, getBlastLedger } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const BLAST_SECRET = process.env.BLAST_SECRET || 'torahtxt_blast_secret_2025';

// Check if today is Shabbat or a major Jewish holiday (no SMS/email blast)
async function isShabbatOrHoliday() {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // Saturday = Shabbat — no blasts
    if (dayOfWeek === 6) return { blocked: true, reason: 'Shabbat' };

    // Friday after candle lighting — skip (check if it's Friday evening in ET)
    // Approximate: no blast after 4pm on Friday
    if (dayOfWeek === 5 && now.getHours() >= 16) {
      return { blocked: true, reason: 'Erev Shabbat (after candle lighting)' };
    }

    // Check Hebcal for major holidays
    const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&year=${year}&month=${month}&maj=on&min=off&mod=on&nx=off&mf=off&ss=off&s=off&c=off&geo=none&M=on&i=off`;
    const res = await fetch(url);
    if (!res.ok) return { blocked: false }; // fail open

    const data = await res.json();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD

    // Major holidays to block (Yom Tov + solemn fast days)
    const blockedKeywords = [
      'Pesach I', 'Pesach II', 'Pesach VII', 'Pesach VIII',
      'Shavuot', 'Shavuot I', 'Shavuot II',
      'Rosh Hashana', 'Rosh Hashana I', 'Rosh Hashana II',
      'Yom Kippur',
      'Sukkot I', 'Sukkot II', 'Shmini Atzeret', 'Simchat Torah',
      'Tisha B\'Av',
      'Erev Yom Kippur'
    ];

    const items = data.items || [];
    for (const item of items) {
      if (item.date === todayStr && item.category === 'holiday') {
        // Never block Chol HaMoed — it's not Yom Tov, blasts should go out
        if (item.title.includes('Chol HaMoed')) continue;
        for (const kw of blockedKeywords) {
          if (item.title.includes(kw)) {
            return { blocked: true, reason: item.title };
          }
        }
      }
    }

    return { blocked: false };
  } catch (err) {
    console.error('Holiday check error:', err.message);
    return { blocked: false }; // fail open — never silently suppress
  }
}

// SMS via Telnyx
async function sendSMS(to, text) {
  if (process.env.BLAST_TEST_MODE === '1') return { success: true, _test: true };
  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.TELNYX_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: process.env.TELNYX_PHONE, to, text })
  });
  const data = await res.json();
  if (!data.data) throw new Error(JSON.stringify(data.errors));
  return data.data.id;
}

const WELCOME_SMS = "Welcome to TorahTxt! You'll receive daily Torah wisdom every morning at 6:30am ET. Text STOP anytime to unsubscribe.";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY; // set in .env — never commit key
const EMAIL_FROM = 'noreply@torahtxt.com'; // Will fallback to jared@jaredgreen.com until torahtxt.com domain is authenticated in SendGrid
const EMAIL_FROM_FALLBACK = 'jared@jaredgreen.com';
const EMAIL_FROM_NAME = 'TorahTxt';

async function sendEmail({ to, subject, html, fromEmail }) {
  if (process.env.BLAST_TEST_MODE === '1') return { success: true, _test: true };
  const from = fromEmail || EMAIL_FROM;
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + SENDGRID_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: EMAIL_FROM_NAME },
      subject,
      content: [{ type: 'text/html', value: html }]
    })
  });

  if (res.status === 202) return { success: true };

  const body = await res.text();
  // If sender not verified, try fallback
  if ((res.status === 403 || res.status === 400) && from !== EMAIL_FROM_FALLBACK) {
    console.warn('SendGrid: primary sender rejected, trying fallback sender', body);
    return sendEmail({ to, subject, html, fromEmail: EMAIL_FROM_FALLBACK });
  }
  throw new Error(`SendGrid error ${res.status}: ${body}`);
}

function buildWelcomeEmail(name) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body,table{background:#1a1c2e!important;}</style>
</head>
<body style="margin:0;padding:0;background:#1a1c2e;font-family:Georgia,serif;color:#f2ece0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c2e;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="text-align:center;padding-bottom:32px;">
          <img src="https://torahtxt.com/images/logo-final.png" alt="TorahTxt" width="220" style="width:220px;height:auto;display:block;margin:0 auto;">
        </td></tr>
        <tr><td style="background:#0d1121;border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:40px;">
          <h2 style="color:#c9a84c;font-family:Georgia,serif;margin-top:0;">Welcome${name ? ', ' + name : ''}! 🎉</h2>
          <p style="color:#d4cfc4;font-size:1.05rem;line-height:1.8;">
            You've subscribed to <strong style="color:#e2c46a;">TorahTxt</strong> daily email edition.
            You'll receive your first D'var Torah tomorrow morning.
          </p>
          <p style="color:#d4cfc4;font-size:1.05rem;line-height:1.8;">
            Each morning, a thoughtful Torah insight will arrive in your inbox — grounded in our weekly parasha, 
            chassidic wisdom, and timeless Jewish thought.
          </p>
          <p style="color:#d4cfc4;font-size:1.05rem;line-height:1.8;">
            Reply to this email anytime with questions or thoughts. We love hearing from our community.
          </p>
          <div style="text-align:center;margin:32px 0;">
            <a href="https://torahtxt.com" style="background:linear-gradient(135deg,#c9a84c,#e2c46a);color:#07090f;text-decoration:none;padding:14px 36px;border-radius:6px;font-weight:bold;font-family:Georgia,serif;font-size:1rem;display:inline-block;">Visit torahtxt.com</a>
          </div>
          <p style="color:#6b7a96;font-size:0.85rem;text-align:center;margin-bottom:0;">
            "Talmud Torah k'neged kulam" — The study of Torah is equal to all other mitzvot. 🕍
          </p>
        </td></tr>
        <tr><td style="text-align:center;padding-top:24px;color:#6b7a96;font-size:0.8rem;">
          © TorahTxt · <a href="https://torahtxt.com" style="color:#c9a84c;">torahtxt.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Email builder: extracted to email-builder.js (EMAIL_OUTPUT_STANDARD.md v1.0.0) ──
const { buildDailyEmailHTML, buildDailyEmailText, buildDailyEmailPayload } = require('./email-builder');

function getTodayParasha() {
  try {
    const fs = require('fs');
    const csvPath = path.join(__dirname, 'torahtxt-messages-year1-v2-final.csv');
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const row = lines.slice(1).find(line => line.startsWith('"' + today + '"') || line.startsWith(today));
    if (!row) return 'Weekly Parasha';
    const fields = parseCSVRow(row);
    return fields[3] || 'Weekly Parasha';
  } catch (e) {
    return 'Weekly Parasha';
  }
}

function getTodayDateFormatted() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York'
  });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Canonical redirect: www → non-www, strip query params for root
app.use((req, res, next) => {
  const host = req.headers.host || '';
  if (host.startsWith('www.')) {
    const canonical = 'https://torahtxt.com' + req.url;
    return res.redirect(301, canonical);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve daily podcast audio from the shared podcasts directory
// e.g. GET /podcast-audio/2026-05-20/audio.mp3
app.use('/podcast-audio', require('express').static(
  path.join(__dirname, '..', 'podcasts', 'daily-torah'),
  { index: false, dotfiles: 'deny' }
));

// API: check if today's podcast episode is available
app.get('/api/podcast/today', (req, res) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const audioPath = path.join(__dirname, '..', 'podcasts', 'daily-torah', today, 'audio.mp3');
  const metaPath  = path.join(__dirname, '..', 'podcasts', 'daily-torah', today, 'metadata.json');
  const { existsSync, readFileSync } = require('fs');
  if (!existsSync(audioPath)) {
    return res.json({ available: false });
  }
  let title = 'Daily Torah Podcast';
  let duration = null;
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      // Do not expose dry-run or accidental test episodes
      if (meta.dry_run === true || meta.accidental === true || meta.status === 'dry-run' || meta.status === 'accidental-test') {
        return res.json({ available: false });
      }
      title    = meta.title || title;
      duration = meta.duration_estimate_formatted || null;
    } catch(e) {}
  }
  res.json({
    available: true,
    url: `/podcast-audio/${today}/audio.mp3`,
    date: today,
    title,
    duration
  });
});

// Initialize DB
initDb();

// Normalize US phone to E.164
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

function isValidUSPhone(phone) {
  return normalizePhone(phone) !== null;
}

// Serve landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// In memory of Michael Green
app.get('/in-memory', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'in-memory.html'));
});

// Get SMS subscriber count
app.get('/subscribers/count', (req, res) => {
  const count = getSubscriberCount();
  res.json({ count });
});

// Get email subscriber count
app.get('/subscribers/email-count', (req, res) => {
  const count = getEmailSubscriberCount();
  res.json({ count });
});

// Subscribe via email
app.post('/subscribe/email', async (req, res) => {
  const { name, email } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required.' });
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ success: false, message: 'Email address is required.' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }

  const result = addEmailSubscriber(name.trim(), email.trim().toLowerCase());

  if (!result.success) {
    return res.status(409).json(result);
  }

  // Send welcome email
  try {
    await sendEmail({
      to: result.subscriber.email,
      subject: 'Welcome to TorahTxt 📖',
      html: buildWelcomeEmail(name.trim())
    });
  } catch (err) {
    console.error('Failed to send welcome email:', err.message);
  }

  // Send today's D'var Torah immediately after signup (if past 6:30am ET)
  try {
    const nowET = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const nowETDate = new Date(nowET);
    const hourET = nowETDate.getHours();
    const minuteET = nowETDate.getMinutes();
    const isPast630 = hourET > 6 || (hourET === 6 && minuteET >= 30);

    if (isPast630) {
      const fs = require('fs');
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const parasha = getTodayParasha();
      const dateStr = getTodayDateFormatted();
      // Get expanded content if available
      const expandedPath = path.join(__dirname, 'content', 'daily', `${today}.json`);
      let fullDvar = null;
      let dvarTitle = parasha;
      const { existsSync: existsSyncWelcome, readFileSync: readFileSyncWelcome } = require('fs');
      if (existsSyncWelcome(expandedPath)) {
        try {
          const expanded = JSON.parse(readFileSyncWelcome(expandedPath, 'utf8'));
          fullDvar = expanded.email || null;
          dvarTitle = expanded.title || parasha;
        } catch (e) {}
      }

      const emailSubject = `TorahTxt: ${dvarTitle} — ${dateStr}`;

      // Get today's SMS message as fallback
      const csvPath = path.join(__dirname, 'torahtxt-messages-year1-v2-final.csv');
      const csvContent = fs.readFileSync(csvPath, 'utf8');
      const lines = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
      const row = lines.slice(1).find(line => line.startsWith('"' + today + '"') || line.startsWith(today));
      let todayMessage = null;
      if (row) {
        const fields = parseCSVRow(row);
        // v2-final CSV: Date,Day,Type,Parasha,SMS,Email,Subject (index 4=SMS)
        // old CSV: Date,Day,Type,Parasha,Message (index 4=Message)
        todayMessage = (fields[4] || '').trim() || null;
      }

      if (todayMessage) {
        // Get daily image if it exists
        const imgPath = path.join(__dirname, 'public', 'images', 'daily', `${today}.jpg`);
        const todayImageUrl = existsSyncWelcome(imgPath) ? `/images/daily/${today}.jpg` : null;

        await sendEmail({
          to: result.subscriber.email,
          subject: emailSubject,
          html: buildDailyEmailHTML({
            name: name.trim(),
            date: dateStr,
            parasha: dvarTitle,
            message: fullDvar || todayMessage,
            token: result.subscriber.token,
            email: result.subscriber.email,
            imageUrl: todayImageUrl
          })
        });
      }
    }
  } catch (err) {
    console.error('Failed to send same-day D\'var Torah to new email subscriber:', err.message);
  }

  res.json({
    success: true,
    message: result.message,
    subscriber: { name: result.subscriber.name, email: result.subscriber.email }
  });
});

// ─── Shared unsubscribe page styles ────────────────────────────────────────
const _unsubStyles = `
  body { font-family: sans-serif; background: #07090f; color: #c9a84c;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; text-align: center; }
  .box { max-width: 440px; padding: 2rem; }
  h1   { font-size: 1.8rem; margin-bottom: 1rem; }
  h2   { font-size: 1.4rem; margin-bottom: 1rem; }
  p    { color: #d4cfc4; line-height: 1.7; margin-bottom: 1rem; }
  a    { color: #c9a84c; }
  .star { font-size: 3rem; display: block; margin-bottom: 1rem; }
  .btn-confirm {
    display: inline-block; margin: 1rem 0 0.5rem;
    padding: 0.75rem 1.75rem; border: none; border-radius: 6px;
    background: #c9a84c; color: #07090f; font-size: 1rem;
    font-weight: bold; cursor: pointer; text-decoration: none;
  }
  .btn-confirm:hover { background: #e0bb5e; }
  .link-cancel { display: block; margin-top: 0.75rem; font-size: 0.9rem; color: #8b7340; }
`;

// ─── Step 1: GET /unsubscribe/email — show confirmation page, DO NOT deactivate ─
// Safe against email link pre-fetchers and scanner bots (GET never writes DB).
app.get('/unsubscribe/email', (req, res) => {
  const { email, token } = req.query;

  if (!email || !token) {
    return res.status(400).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Error - TorahTxt</title><style>${_unsubStyles}</style></head><body><div class="box"><span class="star">⚠️</span><h2>Invalid unsubscribe link.</h2><p>This link is missing required fields. Please use the link from your email.</p><a href="/">Return home</a></div></body></html>`);
  }

  // Validate token against DB — read-only, no changes
  const subscriber = lookupEmailSubscriberByToken(email, token);

  if (!subscriber) {
    // Token/email mismatch or email not found at all
    return res.status(404).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not Found - TorahTxt</title><style>${_unsubStyles}</style></head><body><div class="box"><span class="star">✡️</span><h2>Invalid or expired unsubscribe link.</h2><p>We couldn't find an active subscription matching this link.</p><p>You may already be unsubscribed. <a href="/">Return home</a>.</p></div></body></html>`);
  }

  if (subscriber.active === 0) {
    // Already inactive — idempotent, show already-unsubscribed page
    return res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Already Unsubscribed - TorahTxt</title><style>${_unsubStyles}</style></head><body><div class="box"><span class="star">✡️</span><h2>You're already unsubscribed.</h2><p>This address is not receiving TorahTxt emails.</p><p>Want to rejoin? <a href="/">Visit our website</a>.</p></div></body></html>`);
  }

  // Active subscriber — show confirmation page (POST required to actually deactivate)
  const safeEmail = email.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribe - TorahTxt</title>
  <style>${_unsubStyles}</style>
</head>
<body>
  <div class="box">
    <span class="star">✡️</span>
    <h1>Unsubscribe from TorahTxt?</h1>
    <p>You're currently receiving daily Torah wisdom and parasha insights at<br>
       <strong style="color:#c9a84c;">${safeEmail}</strong>.</p>
    <p style="color:#d4cfc4;">Are you sure you want to stop receiving these messages?</p>
    <form method="POST" action="/unsubscribe/email/confirm">
      <input type="hidden" name="email" value="${safeEmail}">
      <input type="hidden" name="token" value="${token.replace(/"/g, '')}">      <button type="submit" class="btn-confirm">Yes, unsubscribe me</button>
    </form>
    <a href="/" class="link-cancel">Keep me subscribed — return home</a>
  </div>
</body>
</html>`);
});

// ─── Step 2: POST /unsubscribe/email/confirm — actual deactivation ───────────
// Only a genuine browser form submission reaches here.
// Email scanners and link pre-fetchers use GET only, never POST.
app.post('/unsubscribe/email/confirm', (req, res) => {
  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Error - TorahTxt</title><style>${_unsubStyles}</style></head><body><div class="box"><span class="star">⚠️</span><h2>Invalid request.</h2><p>Missing email or token. Please use the link from your email.</p></div></body></html>`);
  }

  // Re-validate token on POST (defence in depth)
  const subscriber = lookupEmailSubscriberByToken(email, token);

  if (!subscriber) {
    return res.status(404).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not Found - TorahTxt</title><style>${_unsubStyles}</style></head><body><div class="box"><span class="star">✡️</span><h2>Invalid or expired unsubscribe link.</h2><p>We couldn't verify your subscription. You may already be unsubscribed.</p><a href="/">Return home</a></div></body></html>`);
  }

  if (subscriber.active === 0) {
    // Already unsubscribed — idempotent success
    return res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Already Unsubscribed - TorahTxt</title><style>${_unsubStyles}</style></head><body><div class="box"><span class="star">✡️</span><h2>You're already unsubscribed.</h2><p>This address is not receiving TorahTxt emails.</p><p>Want to rejoin? <a href="/">Visit our website</a>.</p></div></body></html>`);
  }

  // Deactivate — writes unsubscribed_at and unsubscribe_method='confirmed_click'
  const removed = removeEmailSubscriberByToken(email, token, 'confirmed_click');

  if (removed) {
    console.log(`[unsubscribe] confirmed_click: ${email} at ${new Date().toISOString()}`);
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed - TorahTxt</title>
  <style>${_unsubStyles}</style>
</head>
<body>
  <div class="box">
    <span class="star">✡️</span>
    <h1>You've been unsubscribed.</h1>
    <p>You will no longer receive TorahTxt email messages.<br>We're sorry to see you go — you're always welcome back.</p>
    <p>Want to rejoin? <a href="/">Visit torahtxt.com</a> to subscribe again.</p>
  </div>
</body>
</html>`);
  } else {
    // Token matched on lookup but update changed nothing — race condition / already gone
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Already Unsubscribed - TorahTxt</title><style>${_unsubStyles}</style></head><body><div class="box"><span class="star">✡️</span><h2>You're already unsubscribed.</h2><p>This address is not receiving TorahTxt emails.</p><p>Want to rejoin? <a href="/">Return home</a>.</p></div></body></html>`);
  }
});

// Subscribe
app.post('/subscribe', async (req, res) => {
  const { name, phone } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required.' });
  }
  if (!phone) {
    return res.status(400).json({ success: false, message: 'Phone number is required.' });
  }

  const normalized = normalizePhone(phone);
  if (!normalized) {
    return res.status(400).json({ success: false, message: 'Please enter a valid US phone number.' });
  }

  const result = addSubscriber(name.trim(), normalized);

  if (!result.success) {
    return res.status(409).json(result);
  }

  // Send welcome SMS
  try {
    await sendSMS(normalized, WELCOME_SMS);
  } catch (err) {
    console.error('Failed to send welcome SMS:', err.message);
    // Still return success since they're in the DB
  }

  // If it's past 6:30am ET, send today's D'var Torah 30 seconds later
  const nowET = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const nowETDate = new Date(nowET);
  const hourET = nowETDate.getHours();
  const minuteET = nowETDate.getMinutes();
  const isPast630 = hourET > 6 || (hourET === 6 && minuteET >= 30);

  if (isPast630) {
    setTimeout(async () => {
      try {
        // Get today's message
        const fs = require('fs');
        const csvPath = require('path').join(__dirname, 'torahtxt-messages-year1-v2-final.csv');
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const content = fs.readFileSync(csvPath, 'utf8');
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
        const row = lines.slice(1).find(line => line.startsWith('"' + today + '"') || line.startsWith(today));
        if (row) {
          const fields = parseCSVRow(row);
          // v2-final CSV: index 4=SMS; old CSV: index 4=Message
          if (fields[4]) {
            // Check for expanded content
            const expandedPath = require('path').join(__dirname, 'content', 'daily', `${today}.json`);
            let message = fields[4].trim();
            if (fs.existsSync(expandedPath)) {
              try {
                const expanded = JSON.parse(fs.readFileSync(expandedPath, 'utf8'));
                if (expanded.sms) message = expanded.sms;
              } catch (e) {}
            }
            const BASE = process.env.BASE_URL || 'https://torahtxt.com';
            const fullMsg = message.trim() + '\n\nDig deeper: ' + BASE + '/today\n\nReply STOP to stop.';
            await sendSMS(normalized, fullMsg);
          }
        }
      } catch (err) {
        console.error('Failed to send same-day D\'var Torah to new subscriber:', err.message);
      }
    }, 30000); // 30 seconds after welcome
  }

  res.json({
    success: true,
    message: result.message,
    subscriber: {
      name: result.subscriber.name,
      phone: result.subscriber.phone,
    },
  });
});

// Unsubscribe via link
app.get('/unsubscribe', (req, res) => {
  const { phone, token } = req.query;
  if (!phone || !token) {
    return res.status(400).send('<h2>Invalid unsubscribe link.</h2>');
  }

  const removed = removeSubscriberByToken(phone, token);

  if (removed) {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Unsubscribed - TorahTxt</title>
        <style>
          body { font-family: sans-serif; background: #0a0f1e; color: #c9a84c; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
          .box { max-width: 400px; padding: 2rem; }
          h1 { font-size: 2rem; margin-bottom: 1rem; }
          p { color: #ccc; line-height: 1.6; }
          a { color: #c9a84c; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>✡️</h1>
          <h1>You've been unsubscribed</h1>
          <p>You will no longer receive TorahTxt messages. We're sad to see you go!</p>
          <p>Want to rejoin? <a href="/">Visit our website</a>.</p>
        </div>
      </body>
      </html>
    `);
  } else {
    res.status(404).send(`
      <!DOCTYPE html>
      <html><head><title>Not Found</title></head>
      <body style="font-family:sans-serif;background:#0a0f1e;color:#c9a84c;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;">
        <div><h2>Invalid or expired unsubscribe link.</h2><p style="color:#ccc;">You may already be unsubscribed.</p></div>
      </body></html>
    `);
  }
});

// Blast to all subscribers
app.post('/blast', async (req, res) => {
  const secret = req.headers['x-blast-secret'];
  if (secret !== BLAST_SECRET) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { message, force } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Message is required.' });
  }

  // Local TorahTxt date (America/New_York) — used as the idempotency key date
  const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const lockKey = `blast:sms_email:${todayDate}`;

  console.log(`[blast] request received | date=${todayDate} | lockKey=${lockKey} | force=${!!force}`);

  // ── Idempotency lock: acquire before any send ────────────────────────────
  const acquired = tryAcquireBlastLock(lockKey, 'sms_email', todayDate);
  if (!acquired) {
    const existing = getBlastLock(lockKey);
    console.log(`[blast] duplicate blocked | lockKey=${lockKey} | lock status=${existing && existing.status}`);
    return res.json({
      success: true,
      skipped: true,
      reason: 'already_sent_today',
      lock: existing || null,
    });
  }
  console.log(`[blast] lock acquired | lockKey=${lockKey}`);
  // Lock is now held. A crash will NOT clear it — rerun is blocked for the day.
  // To manually unblock: use GET /admin/blast-lock to inspect, then clear via sqlite directly.

  // Check Shabbat/holiday — skip blast unless force=true
  // Note: check AFTER lock so a Shabbat skip still prevents a second run.
  if (!force) {
    const { blocked, reason } = await isShabbatOrHoliday();
    if (blocked) {
      console.log(`[blast] skipped — holiday/Shabbat | reason=${reason}`);
      updateBlastLock(lockKey, { status: 'skipped_holiday' });
      return res.json({ success: true, skipped: true, reason, message: `Blast skipped — ${reason}. Pass force:true to override.` });
    }
  }

  const subscribers = getActiveSubscribers();
  const emailSubscribers = getActiveEmailSubscribers();
  console.log(`[blast] starting | sms_recipients=${subscribers.length} | email_recipients=${emailSubscribers.length}`);

  const BASE = process.env.BASE_URL || 'https://torahtxt.com';
  const fullMessage = message.trim() + '\n\nDig deeper: ' + BASE + '/today\n\nReply STOP to stop.';

  let sent = 0;
  let failed = 0;
  const errors = [];

  // SMS blast
  for (const sub of subscribers) {
    try {
      await sendSMS(sub.phone, fullMessage);
      sent++;
      recordLedgerEntry(lockKey, 'sms', sub.phone, true, null);
    } catch (err) {
      failed++;
      errors.push({ phone: sub.phone, error: err.message });
      recordLedgerEntry(lockKey, 'sms', sub.phone, false, err.message);
      console.error(`[blast] sms error | phone=${sub.phone} | error=${err.message}`);
    }
  }
  console.log(`[blast] sms complete | sent=${sent} | failed=${failed}`);

  // Email blast
  let emailSent = 0;
  let emailFailed = 0;
  const emailErrors = [];

  const parasha = getTodayParasha();
  const dateStr = getTodayDateFormatted();
  const { existsSync: existsSyncExpanded, readFileSync: readFileSyncExpanded } = require('fs');
  const expandedContentPath = path.join(__dirname, 'content', 'daily', `${todayDate}.json`);
  let fullDvar  = null;
  let dvarTitle = parasha;
  let kidsContent = null;
  if (existsSyncExpanded(expandedContentPath)) {
    try {
      const expanded = JSON.parse(readFileSyncExpanded(expandedContentPath, 'utf8'));
      fullDvar    = expanded.email || null;
      dvarTitle   = expanded.title || parasha;
      kidsContent = expanded.kids  || null;
    } catch (e) {}
  }

  const { existsSync: existsSyncBlast } = require('fs');
  const todayImgPath = path.join(__dirname, 'public', 'images', 'daily', `${todayDate}.jpg`);
  const todayImageUrl = existsSyncBlast(todayImgPath) ? `/images/daily/${todayDate}.jpg` : null;

  for (const sub of emailSubscribers) {
    try {
      const payload = buildDailyEmailPayload({
        name:      sub.name,
        date:      dateStr,
        parasha:   dvarTitle,
        title:     dvarTitle,
        message:   fullDvar || message.trim(),
        token:     sub.token,
        email:     sub.email,
        imageUrl:  todayImageUrl,
        kids:      kidsContent,
        sourceDate: todayDate,
      });
      await sendEmail({
        to:      sub.email,
        subject: payload.subject,
        html:    payload.html,
        text:    payload.text,
      });
      emailSent++;
      recordLedgerEntry(lockKey, 'email', sub.email, true, null);
    } catch (err) {
      emailFailed++;
      emailErrors.push({ email: sub.email, error: err.message });
      recordLedgerEntry(lockKey, 'email', sub.email, false, err.message);
      console.error(`[blast] email error | email=${sub.email} | error=${err.message}`);
    }
  }
  console.log(`[blast] email complete | sent=${emailSent} | failed=${emailFailed}`);

  // Mark lock completed with final counts (lock key stays — no auto-clear)
  updateBlastLock(lockKey, {
    smsSent: sent, emailSent, smsFailed: failed, emailFailed, status: 'completed',
  });
  console.log(`[blast] completed | lockKey=${lockKey} | sms=${sent}/${subscribers.length} | email=${emailSent}/${emailSubscribers.length}`);

  res.json({
    success: true,
    lockKey,
    sms:   { sent, failed, total: subscribers.length, errors },
    email: { sent: emailSent, failed: emailFailed, total: emailSubscribers.length, errors: emailErrors },
  });
});

// Admin: inspect blast lock state (read-only — no unlock endpoint)
app.get('/admin/blast-lock', (req, res) => {
  const secret = req.headers['x-blast-secret'];
  if (secret !== BLAST_SECRET) return res.status(403).json({ success: false, message: 'Unauthorized' });

  const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const lockKey = `blast:sms_email:${todayDate}`;
  const todayLock = getBlastLock(lockKey);
  const recent = listBlastLocks(10);
  const ledger = todayLock ? getBlastLedger(lockKey) : [];

  res.json({
    today: { date: todayDate, lockKey, lock: todayLock || null },
    recent,
    ledger,
    note: 'To manually clear a lock, delete the row from blast_locks in subscribers.db directly.',
  });
});

// Twilio webhook for STOP/UNSUBSCRIBE/CANCEL/QUIT
app.post('/webhook/twilio', (req, res) => {
  const { Body, From } = req.body;
  const keyword = (Body || '').trim().toUpperCase();

  const stopKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END', 'STOPALL'];

  let responseMsg = '';

  if (stopKeywords.some(k => keyword === k || keyword.startsWith(k))) {
    removeSubscriberByPhone(From);
    responseMsg = "You've been unsubscribed from TorahTxt. You will no longer receive messages. Reply START to resubscribe.";
  } else if (keyword === 'START' || keyword === 'UNSTOP' || keyword === 'JOIN' || keyword === 'SUBSCRIBE') {
    // Auto-subscribe via text
    const result = addSubscriber('TorahTxt Subscriber', From);
    if (result.success) {
      responseMsg = "Welcome to TorahTxt! You're now subscribed to daily Torah wisdom at 6:30am ET. Text STOP anytime to unsubscribe.";
    } else {
      responseMsg = "Welcome back to TorahTxt! 📖 You'll start receiving daily Torah wisdom again at 6:30am ET. Text STOP anytime to unsubscribe.";
    }
  } else if (keyword === 'HELP' || keyword === 'INFO') {
    responseMsg = "TorahTxt: Daily Torah wisdom at 6:30am ET. Commands: START (subscribe), STOP (unsubscribe), VERSE (random verse), INSPIRE (Chassidic story). Visit torahtxt.com";
  } else if (keyword === 'VERSE') {
    responseMsg = "📖 \"Love your neighbor as yourself\" — Leviticus 19:18. Hillel called this the entire Torah on one foot. The rest is commentary — go and learn.";
  } else if (keyword === 'INSPIRE') {
    responseMsg = "📖 The Baal Shem Tov taught: G-d is found wherever He is let in. The gates of heaven open from the inside. You hold the key. Have a meaningful day. 🙏";
  } else {
    responseMsg = "TorahTxt: Text START to subscribe to daily Torah wisdom. Text STOP to unsubscribe. Visit torahtxt.com";
  }

  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMsg}</Message>
</Response>`);
});

// Today's D'var Torah page
app.get('/today', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'today.html'));
});

// Today's D'var Torah API
app.get('/api/today', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  try {
    const fs = require('fs');
    const csvPath = path.join(__dirname, 'torahtxt-messages-year1-v2-final.csv');
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());

    // Get today's date in YYYY-MM-DD
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    // Find today's row
    const row = lines.slice(1).find(line => line.startsWith('"' + today + '"') || line.startsWith(today));
    if (!row) {
      return res.status(404).json({ error: 'No message for today' });
    }

    // Parse CSV row using proper parser (handles quoted fields)
    const fields = parseCSVRow(row);
    if (!fields || fields.length < 5) {
      return res.status(500).json({ error: 'Failed to parse message' });
    }

    // v2-final CSV: Date,Day,Type,Parasha/Source,SMS,Email,Subject
    // old CSV: Date,Day,Type,Parasha/Source,Message
    const [date, day, type, parasha] = fields;
    const message = fields[4] || ''; // SMS column (index 4)

    // Format date nicely
    const dateObj = new Date(date + 'T12:00:00');
    const formatted = dateObj.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
    });

    // Check for daily image
    const imgPath = path.join(__dirname, 'public', 'images', 'daily', `${date}.jpg`);
    const { existsSync, readFileSync } = require('fs');
    const imageUrl = existsSync(imgPath) ? `/images/daily/${date}.jpg` : null;

    // Check for expanded daily content (JSON file with title + full essay)
    const expandedPath = path.join(__dirname, 'content', 'daily', `${date}.json`);
    let title = parasha;
    let fullContent = null;
    let kidsContent = null;
    if (existsSync(expandedPath)) {
      try {
        const expanded = JSON.parse(readFileSync(expandedPath, 'utf8'));
        title = expanded.title || parasha;
        fullContent = expanded.email || null;
        kidsContent = expanded.kids || null;
      } catch (e) { /* fall back to CSV message */ }
    }

    // Fetch live parasha data from Sefaria (non-blocking, best-effort)
    let sefaria = null;
    try {
      const https = require('https');
      const sefariaData = await new Promise((resolve, reject) => {
        const req = https.get('https://www.sefaria.org/api/calendars?lang=en&timezone=America/New_York', { timeout: 3000 }, (r) => {
          let body = '';
          r.on('data', d => body += d);
          r.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(null); } });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      });
      if (sefariaData) {
        const cal = sefariaData.calendar_items || [];
        const parashaItem = cal.find(i => i.title && i.title.en && i.title.en.includes('Parashat'));
        if (parashaItem) {
          sefaria = {
            parasha: parashaItem.displayValue && parashaItem.displayValue.en,
            ref: parashaItem.ref,
            url: parashaItem.url,
            description: parashaItem.description && parashaItem.description.en
          };
        }
      }
    } catch(e) { /* sefaria unavailable — skip */ }

    res.json({ date: formatted, day, type, parasha, title, message, fullContent, imageUrl, kidsContent, sefaria });
  } catch (err) {
    console.error('Error serving /api/today:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Archive routes ───────────────────────────────────────────────────────────

// Helper: parse the CSV into rows
function parseArchiveCSV() {
  const fs = require('fs');
  const csvPath = path.join(__dirname, 'torahtxt-messages-year1-v2-final.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    // Format: Date,Day,Type,"Parasha/Source","Message with possible commas"
    // Use regex that handles optional quotes around fields
    const m = line.match(/^([^,]+),([^,]+),([^,]+),"?([^,"]+)"?,"([\s\S]*)"$/) ||
              line.match(/^([^,]+),([^,]+),([^,]+),([^,]+),"([\s\S]*)"$/) ||
              line.match(/^([^,]+),([^,]+),([^,]+),"?([^"]+)"?,(.+)$/);
    if (!m) continue;
    rows.push({
      date: m[1].trim(),
      day: m[2].trim(),
      type: m[3].trim(),
      parasha: m[4].trim().replace(/^"|"$/g, ''),
      message: m[5].trim().replace(/^"|"$/g, '')
    });
  }
  return rows;
}

// Helper: format date string YYYY-MM-DD → "Friday, March 27, 2026"
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  });
}

// Helper: enrich a row with title/fullContent from JSON file if it exists
function enrichRow(row) {
  const { existsSync, readFileSync } = require('fs');
  const jsonPath = path.join(__dirname, 'content', 'daily', `${row.date}.json`);
  let title = row.parasha;
  let fullContent = null;
  if (existsSync(jsonPath)) {
    try {
      const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
      title = data.title || row.parasha;
      fullContent = data.email || null;
    } catch (e) {}
  }
  return { title, fullContent };
}

// GET /api/archive — all past entries, newest first
app.get('/api/archive', (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const rows = parseArchiveCSV();
    const result = rows
      .filter(r => r.date <= today)
      .map(r => {
        const { title } = enrichRow(r);
        return {
          date: r.date,
          dateFormatted: formatDate(r.date),
          day: r.day,
          type: r.type,
          parasha: r.parasha,
          title,
          slug: r.date,
          snippet: r.message.slice(0, 120)
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    res.json(result);
  } catch (err) {
    console.error('Error in /api/archive:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/archive/:date — single entry with full content
app.get('/api/archive/:date', (req, res) => {
  try {
    const dateParam = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (dateParam > today) {
      return res.status(404).json({ error: 'Date is in the future' });
    }
    const rows = parseArchiveCSV();
    const row = rows.find(r => r.date === dateParam);
    if (!row) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { title, fullContent } = enrichRow(row);
    // Build prev/next
    const pastRows = rows.filter(r => r.date <= today).sort((a, b) => a.date.localeCompare(b.date));
    const idx = pastRows.findIndex(r => r.date === dateParam);
    const prev = idx > 0 ? pastRows[idx - 1].date : null;
    const next = idx < pastRows.length - 1 ? pastRows[idx + 1].date : null;
    res.json({
      date: row.date,
      dateFormatted: formatDate(row.date),
      day: row.day,
      type: row.type,
      parasha: row.parasha,
      title,
      slug: row.date,
      snippet: row.message.slice(0, 120),
      message: row.message,
      fullContent,
      prev,
      next
    });
  } catch (err) {
    console.error('Error in /api/archive/:date:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /archive and /archive/:date — serve SPA
app.get('/archive', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'archive.html'));
});
app.get('/archive/:date', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'archive.html'));
});

// ─── End Archive routes ───────────────────────────────────────────────────────

// ─── Admin Preview routes ─────────────────────────────────────────────────────

// GET /api/admin/messages — all messages (past + future), sorted by date ascending
app.get('/api/admin/messages', (req, res) => {
  try {
    const fs = require('fs');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    // Known Yom Tov / blackout dates (Shabbat computed dynamically below)
    const yomTovDates = {
      '2026-04-02': 'Pesach I — Seder Night',
      '2026-04-03': 'Pesach II',
      '2026-04-08': 'Pesach VII',
      '2026-04-09': 'Pesach VIII — Last Day of Pesach',
      '2026-09-21': 'Rosh Hashana I',
      '2026-09-22': 'Rosh Hashana II',
      '2026-09-30': 'Yom Kippur',
      '2026-10-05': 'Sukkot I',
      '2026-10-06': 'Sukkot II',
      '2026-10-12': 'Shmini Atzeret',
      '2026-10-13': 'Simchat Torah',
      '2026-05-22': 'Shavuot I',
      '2026-05-23': 'Shavuot II',
    };

    function isShabbat(dateStr) {
      const d = new Date(dateStr + 'T12:00:00Z');
      return d.getUTCDay() === 6; // Saturday
    }

    const rows = parseArchiveCSV();
    const result = rows
      .map(r => {
        const { title, fullContent } = enrichRow(r);
        const { existsSync: existsSyncAdmin } = require('fs');
        const hasExpanded = existsSyncAdmin(path.join(__dirname, 'content', 'daily', `${r.date}.json`));
        const imgPath = path.join(__dirname, 'public', 'images', 'daily', `${r.date}.jpg`);
        const imageUrl = existsSyncAdmin(imgPath) ? `/images/daily/${r.date}.jpg` : null;

        let isBlackout = false;
        let blackoutReason = null;
        if (isShabbat(r.date)) {
          isBlackout = true;
          blackoutReason = 'Shabbat — no blast';
        } else if (yomTovDates[r.date]) {
          isBlackout = true;
          blackoutReason = yomTovDates[r.date] + ' — no blast';
        }

        return {
          date: r.date,
          dateFormatted: formatDate(r.date),
          day: r.day,
          type: r.type,
          parasha: r.parasha,
          title,
          snippet: r.message.slice(0, 100),
          message: r.message,
          fullContent,
          hasExpanded,
          imageUrl,
          isBlackout,
          blackoutReason,
          isPast: r.date < today,
          isToday: r.date === today,
          isTomorrow: r.date === tomorrow,
          isFuture: r.date > tomorrow
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    res.json(result);
  } catch (err) {
    console.error('Error in /api/admin/messages:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /preview — admin message queue preview page
app.get('/preview', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'preview.html'));
});

// ─── End Admin Preview routes ─────────────────────────────────────────────────

// Sponsor page
app.get('/sponsor', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sponsor.html'));
});

// Sponsor submission
app.post('/sponsor', (req, res) => {
  try {
    const { sponsor_name, email, type, honoree_name, date, note } = req.body;
    if (!sponsor_name || !email || !type || !honoree_name || !date) {
      return res.json({ success: false, message: 'All required fields must be filled in.' });
    }
    const db = initDb();
    // Create sponsorships table if not exists
    db.exec(`CREATE TABLE IF NOT EXISTS sponsorships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sponsor_name TEXT,
      email TEXT,
      type TEXT,
      honoree_name TEXT,
      date TEXT,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.prepare('INSERT INTO sponsorships (sponsor_name, email, type, honoree_name, date, note) VALUES (?, ?, ?, ?, ?, ?)').run(sponsor_name, email, type, honoree_name, date, note || '');
    console.log(`🕯️ New sponsorship: ${type} ${honoree_name} by ${sponsor_name} on ${date}`);
    res.json({ success: true, message: 'Sponsorship submitted!' });
  } catch (err) {
    console.error('Sponsor error:', err);
    res.json({ success: false, message: 'Server error. Please try again.' });
  }
});

// Export app for testing; only listen when run directly.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🕍 TorahTxt server running on port ${PORT}`);
    console.log(`   Landing page: http://localhost:${PORT}`);
    console.log(`   Subscriber count: http://localhost:${PORT}/subscribers/count`);
  });
}

module.exports = app;
