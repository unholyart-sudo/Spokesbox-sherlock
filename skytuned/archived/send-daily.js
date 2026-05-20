#!/usr/bin/env node
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const SENDGRID_API_KEY = '[REDACTED_SENDGRID_KEY]';
const FROM_EMAIL = 'jared@jaredgreen.com';
const FROM_NAME = 'SkyTuned';
const SUBJECT = '🚀 SkyTuned · Your Daily Orbit — Monday, May 18, 2026';
const HTML_TEMPLATE = fs.readFileSync('/Users/openclawjg/.openclaw/workspace/skytuned/email-output.html', 'utf8');

// Get subscribers from DB
const raw = execSync(
  `sqlite3 /Users/openclawjg/.openclaw/workspace/skytuned/subscribers.db "SELECT email, name, token FROM email_subscribers WHERE active=1;"`
).toString().trim();

const subscribers = raw.split('\n').map(line => {
  const parts = line.split('|');
  return { email: parts[0], name: parts[1], token: parts[2] };
}).filter(s => s.email);

console.log(`Found ${subscribers.length} active subscribers.`);

function sendEmail(subscriber) {
  return new Promise((resolve, reject) => {
    const html = HTML_TEMPLATE
      .replace(/\{\{EMAIL\}\}/g, encodeURIComponent(subscriber.email))
      .replace(/\{\{TOKEN\}\}/g, encodeURIComponent(subscriber.token || ''));

    const payload = JSON.stringify({
      personalizations: [{
        to: [{ email: subscriber.email, name: subscriber.name || subscriber.email }]
      }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject: SUBJECT,
      content: [{ type: 'text/html', value: html }]
    });

    const options = {
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode === 202) {
          resolve({ ok: true, email: subscriber.email });
        } else {
          resolve({ ok: false, email: subscriber.email, status: res.statusCode, body });
        }
      });
    });

    req.on('error', (e) => resolve({ ok: false, email: subscriber.email, error: e.message }));
    req.write(payload);
    req.end();
  });
}

async function main() {
  let sent = 0, failed = 0;
  const errors = [];

  // Send in batches of 10 to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < subscribers.length; i += batchSize) {
    const batch = subscribers.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(sendEmail));
    for (const r of results) {
      if (r.ok) {
        sent++;
        console.log(`✓ Sent to ${r.email}`);
      } else {
        failed++;
        errors.push(r);
        console.error(`✗ Failed: ${r.email} — ${r.status || r.error} ${r.body || ''}`);
      }
    }
    // Small delay between batches
    if (i + batchSize < subscribers.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Sent: ${sent} | Failed: ${failed}`);
  if (errors.length > 0) {
    console.log('Failures:', JSON.stringify(errors, null, 2));
  }
  
  // Write result to file for parent process
  fs.writeFileSync('/Users/openclawjg/.openclaw/workspace/skytuned/send-result.json', JSON.stringify({ sent, failed, errors }));
}

main().catch(console.error);
