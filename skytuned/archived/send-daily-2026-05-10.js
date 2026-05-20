const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const SENDGRID_API_KEY = '[REDACTED_SENDGRID_KEY]';
const FROM_EMAIL = 'jared@jaredgreen.com';
const FROM_NAME = 'SkyTuned';
const SUBJECT = 'SkyTuned — Sunday, May 10 · Your Daily Orbit';

// Read HTML
const htmlContent = fs.readFileSync('/Users/openclawjg/.openclaw/workspace/skytuned/daily-email-2026-05-10.html', 'utf8');

// Get subscribers from DB
const rawSubscribers = execSync(
  `sqlite3 /Users/openclawjg/.openclaw/workspace/skytuned/subscribers.db "SELECT email, name FROM email_subscribers WHERE active=1;"`
).toString().trim().split('\n');

const subscribers = rawSubscribers.map(line => {
  const [email, name] = line.split('|');
  return { email: email.trim(), name: (name || '').trim() };
}).filter(s => s.email);

console.log(`Found ${subscribers.length} active subscribers`);

// Build personalizations (one per subscriber for merge tag support)
const personalizations = subscribers.map(sub => ({
  to: [{ email: sub.email, name: sub.name || sub.email }]
}));

const payload = {
  personalizations,
  from: { email: FROM_EMAIL, name: FROM_NAME },
  subject: SUBJECT,
  content: [
    {
      type: 'text/html',
      value: htmlContent
    }
  ]
};

const body = JSON.stringify(payload);

const options = {
  hostname: 'api.sendgrid.com',
  port: 443,
  path: '/v3/mail/send',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SENDGRID_API_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = https.request(options, (res) => {
  console.log(`SendGrid response status: ${res.statusCode}`);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 202) {
      console.log(`SUCCESS: Email sent to ${subscribers.length} subscribers`);
      console.log(`Subject: ${SUBJECT}`);
    } else {
      console.log('FAILED:', data);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e);
  process.exit(1);
});

req.write(body);
req.end();
