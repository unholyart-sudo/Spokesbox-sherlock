const https = require('https');
const fs = require('fs');

const SENDGRID_API_KEY = '[REDACTED_SENDGRID_KEY]';

let html = fs.readFileSync('/Users/openclawjg/.openclaw/workspace/skytuned/email-template.html', 'utf8');

// Jeff — Aries, April 13 1977, 1:30 PM, Bryan TX
// Today: Saturday April 4, 2026 — birthday is 9 days away (solar return season)
// Saturday cadence: Reflection

html = html
  .replace('{{SIGN_LINE}}', '♈ Aries · Solar Return Season')
  .replace('{{DATE_SHORT}}', 'Saturday, April 4')
  .replace('{{POWER_LINE}}', "Your birthday is 9 days out — this weekend is the quiet before the reset. Use it well.")

  // MOMENTUM — Medium-high, building
  .replace('{{MOMENTUM_LABEL}}', 'Building')
  .replace('{{MOMENTUM_PCT}}', '65')

  // CLARITY — High
  .replace('{{CLARITY_LABEL}}', 'Sharp')
  .replace('{{CLARITY_PCT}}', '75')

  // EMOTIONAL LOAD — Medium
  .replace('{{EMOTIONAL_LABEL}}', 'Present')
  .replace('{{EMOTIONAL_PCT}}', '50')

  // Tailwinds
  .replace('{{TAILWINDS}}', `
    <div style="font-size:14px;color:#f2ece0;line-height:1.8;margin-bottom:6px;">☀️ Aries season has you running hot</div>
    <div style="font-size:14px;color:#f2ece0;line-height:1.8;margin-bottom:6px;">🔋 Energy reserves are strong</div>
    <div style="font-size:14px;color:#f2ece0;line-height:1.8;">🎯 Clarity on what actually matters</div>
  `)

  // Headwinds
  .replace('{{HEADWINDS}}', `
    <div style="font-size:14px;color:#f2ece0;line-height:1.8;margin-bottom:6px;">⚡ Restlessness looking for an outlet</div>
    <div style="font-size:14px;color:#f2ece0;line-height:1.8;margin-bottom:6px;">📋 Over-planning instead of doing</div>
    <div style="font-size:14px;color:#f2ece0;line-height:1.8;">🔄 Old frustrations bubbling up</div>
  `)

  // Directives
  .replace('{{WORK}}', 'Sketch your next 90 days. Solar return is your yearly reset — start thinking now.')
  .replace('{{RELATIONSHIPS}}', 'Reach out to someone you\'ve been meaning to reconnect with. Today\'s good for it.')
  .replace('{{MIND}}', 'Voice-memo or journal your intentions before the new week. It\'ll stick.')
  .replace('{{MONEY}}', 'Hold off on financial decisions until after your birthday window opens.')

  // Detail
  .replace('{{DETAIL}}', `
    <p style="font-size:15px;color:#c8bfa8;line-height:1.7;margin:0 0 14px;">With your birthday nine days out, the sun is moving through the final degrees of Aries — your sign, your season. This isn't a wind-down; it's a countdown. The energy you're feeling right now is the buildup to a full solar return, and how you spend this window shapes the year ahead.</p>
    <p style="font-size:15px;color:#c8bfa8;line-height:1.7;margin:0 0 14px;">Saturday's reflection energy pairs well with Aries' natural drive. Instead of pushing outward, turn it inward — what do you want to be true about your life by this time next year? That question matters more today than any task on your list.</p>
    <p style="font-size:15px;color:#c8bfa8;line-height:1.7;margin:0 0 14px;">The restlessness you might feel is normal — Aries doesn't love sitting still. But rest isn't weakness right now. It's loading. The action you're craving is 9 days away and it's going to need fuel.</p>
  `)

  // Outlook
  .replace('{{OPTIMISM}}', "Your solar return window is opening. The intentions you set in the next week and a half will echo all year — this is your most powerful manifesting stretch.")
  .replace('{{WARNING}}', "Don't burn Saturday on busy-work or low-stakes decisions. Save the fire for something worth it.")

  // Resources
  .replace('{{RESOURCES}}', `
    <div style="margin-top:24px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#9a8a70;font-weight:600;margin-bottom:14px;">✦ Curated for Today</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-bottom:10px;">
            <a href="https://www.mindbodygreen.com/articles/solar-return-chart" style="color:#c9a84c;text-decoration:none;font-size:14px;">🎂 What Your Solar Return Actually Means</a>
            <div style="font-size:12px;color:#9a8a70;margin-top:2px;">Practical guide to using your birthday season intentionally</div>
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:10px;">
            <a href="https://www.astrology.com/article/aries-season-2026/" style="color:#c9a84c;text-decoration:none;font-size:14px;">♈ Aries Season 2026 — What's Different</a>
            <div style="font-size:12px;color:#9a8a70;margin-top:2px;">Key transits hitting Aries this month</div>
          </td>
        </tr>
        <tr>
          <td>
            <a href="https://www.themarginalian.org/2021/12/31/the-art-of-annual-reflection/" style="color:#c9a84c;text-decoration:none;font-size:14px;">📓 The Art of a Real Annual Review</a>
            <div style="font-size:12px;color:#9a8a70;margin-top:2px;">How to actually look back and set forward</div>
          </td>
        </tr>
      </table>
    </div>
  `)

  .replace('{{EMAIL}}', 'jborden13@gmail.com')
  .replace('{{TOKEN}}', 'jeff-token-001');

const payload = JSON.stringify({
  personalizations: [{
    to: [{ email: 'jborden13@gmail.com', name: 'Jeff' }],
    subject: '✨ Your SkyTuned Reading — Saturday, April 4'
  }],
  from: { email: 'jared@jaredgreen.com', name: 'SkyTuned' },
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
  console.log('Status:', res.statusCode);
  res.on('data', d => process.stdout.write(d));
  res.on('end', () => console.log('\nDone.'));
});

req.on('error', e => console.error('Error:', e));
req.write(payload);
req.end();
