const https = require('https');
const SENDGRID_KEY = '[REDACTED_SENDGRID_KEY]';

const html = `<!DOCTYPE html>
<html><head><meta charset='utf-8'></head>
<body style='margin:0;padding:0;background:#07090f;font-family:Georgia,serif;'>
<div style='max-width:600px;margin:0 auto;background:#07090f;'>
  <div style='background:#000;padding:20px 32px;text-align:center;border-bottom:1px solid rgba(201,168,76,0.3)'>
    <img src='https://skytuned.com/logo-space-v2.jpg' alt='SkyTuned' style='width:180px;height:auto;background:#000;'>
  </div>
  <div style='padding:32px;'>
    <h1 style='color:#c9a84c;font-size:20px;margin-bottom:16px;'>We're sorry, Phil</h1>
    <p style='color:#c8bfb0;font-size:15px;line-height:1.8;'>We owe you an apology. You attempted to unsubscribe from SkyTuned's Daily Orbit email on multiple occasions, and due to a bug on our end, those requests did not go through.</p>
    <p style='color:#c8bfb0;font-size:15px;line-height:1.8;'>That is completely unacceptable, and we are sorry for the continued emails after you clearly indicated you did not want them.</p>
    <p style='color:#c8bfb0;font-size:15px;line-height:1.8;'>You have been <strong style='color:#f2ece0;'>fully removed</strong> from our list as of today. You will not receive any further emails from SkyTuned.</p>
    <p style='color:#c8bfb0;font-size:15px;line-height:1.8;'>The bug has been patched so this will not happen to anyone else.</p>
    <p style='color:#c8bfb0;font-size:15px;line-height:1.8;'>Again, we apologize for the inconvenience.</p>
    <p style='color:#9a8a70;font-size:14px;line-height:1.6;margin-top:32px;'>— The SkyTuned Team</p>
  </div>
  <div style='background:#000;padding:16px 32px;text-align:center;border-top:1px solid rgba(201,168,76,0.2);'>
    <p style='font-size:11px;color:#9a8a70;margin:0;'>SkyTuned · skytuned.com</p>
  </div>
</div>
</body></html>`;

const body = JSON.stringify({
  personalizations: [{ to: [{ email: 'thebadastronomer@gmail.com', name: 'Phil Plait' }] }],
  from: { email: 'jared@jaredgreen.com', name: 'SkyTuned' },
  reply_to: { email: 'sherlock.claw@gmail.com' },
  subject: "We're sorry — you've been removed from SkyTuned",
  content: [{ type: 'text/html', value: html }]
});

const req = https.request({
  hostname: 'api.sendgrid.com', path: '/v3/mail/send', method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + SENDGRID_KEY,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
}, res => {
  console.log('Status:', res.statusCode);
  res.resume();
});
req.on('error', e => console.error('Error:', e.message));
req.write(body);
req.end();
