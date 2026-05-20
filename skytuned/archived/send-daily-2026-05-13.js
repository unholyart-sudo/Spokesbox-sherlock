#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');

const SENDGRID_API_KEY = '[REDACTED_SENDGRID_KEY]';
const FROM_EMAIL = 'jared@jaredgreen.com';
const FROM_NAME = 'SkyTuned';
const SUBJECT = '🚀 SkyTuned · Your Daily Orbit — Wednesday, May 13, 2026';
const DB_PATH = '/Users/openclawjg/.openclaw/workspace/skytuned/subscribers.db';
const TEMPLATE_PATH = '/Users/openclawjg/.openclaw/workspace/skytuned/daily-email-2026-05-13.html';

// Load the HTML template
const htmlTemplate = fs.readFileSync(TEMPLATE_PATH, 'utf8');

// Query active subscribers
let subscribersRaw;
try {
  subscribersRaw = execSync(`sqlite3 "${DB_PATH}" "SELECT email, name, token FROM email_subscribers WHERE active=1;"`)
    .toString()
    .trim();
} catch (e) {
  console.error('Failed to query DB:', e.message);
  process.exit(1);
}

if (!subscribersRaw) {
  console.log('No active subscribers. Exiting silently.');
  process.exit(0);
}

const subscribers = subscribersRaw.split('\n').map(line => {
  const parts = line.split('|');
  return { email: parts[0], name: parts[1] || '', token: parts[2] || '' };
}).filter(s => s.email && s.email.includes('@'));

console.log(`Sending to ${subscribers.length} subscribers...`);

function sendEmail(subscriber) {
  return new Promise((resolve, reject) => {
    const html = htmlTemplate
      .replace(/\{\{EMAIL\}\}/g, encodeURIComponent(subscriber.email))
      .replace(/\{\{TOKEN\}\}/g, subscriber.token);

    const body = JSON.stringify({
      personalizations: [{
        to: [{ email: subscriber.email, name: subscriber.name }]
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
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 202) {
          resolve({ success: true, email: subscriber.email });
        } else {
          resolve({ success: false, email: subscriber.email, status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ success: false, email: subscriber.email, error: e.message });
    });

    req.write(body);
    req.end();
  });
}

async function main() {
  let sent = 0;
  let failed = 0;
  const errors = [];

  // Send in batches of 10 with small delay to be polite to SendGrid
  const batchSize = 10;
  for (let i = 0; i < subscribers.length; i += batchSize) {
    const batch = subscribers.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(s => sendEmail(s)));
    
    for (const result of results) {
      if (result.success) {
        sent++;
        process.stdout.write('.');
      } else {
        failed++;
        errors.push(result);
        process.stdout.write('x');
      }
    }

    // Small delay between batches
    if (i + batchSize < subscribers.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`\n\nDone! Sent: ${sent} | Failed: ${failed} | Total: ${subscribers.length}`);
  
  if (errors.length > 0) {
    console.log('\nFailed sends:');
    errors.forEach(e => {
      console.log(`  ${e.email}: ${e.status || e.error} — ${e.body ? e.body.substring(0, 200) : ''}`);
    });
  }

  // Output summary for the caller
  console.log(`\nSUMMARY: ${sent}/${subscribers.length} emails sent successfully`);
  return { sent, failed, total: subscribers.length };
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
