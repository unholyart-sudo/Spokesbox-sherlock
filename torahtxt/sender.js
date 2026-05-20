require('dotenv').config();
const { initDb, getActiveSubscribers } = require('./db');

async function sendSMS(to, text) {
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

async function sendBlast(message) {
  if (!message) {
    console.error('Usage: node sender.js "Your message here"');
    process.exit(1);
  }

  initDb();
  const subscribers = getActiveSubscribers();

  if (subscribers.length === 0) {
    console.log('No active subscribers. Nothing to send.');
    process.exit(0);
  }

  const fullMessage = message + '\n\nReply STOP to unsubscribe.';

  console.log(`\n📖 TorahTxt Blast [TELNYX]`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Sending to ${subscribers.length} subscriber(s)...`);
  console.log(`Message:\n${fullMessage}\n`);

  let sent = 0;
  let failed = 0;

  for (const sub of subscribers) {
    try {
      const id = await sendSMS(sub.phone, fullMessage);
      console.log(`✅ Sent to ${sub.name} (${sub.phone}) — ID: ${id}`);
      sent++;
    } catch (err) {
      console.error(`❌ Failed for ${sub.name} (${sub.phone}): ${err.message}`);
      failed++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${sent} sent, ${failed} failed, ${subscribers.length} total`);

  if (failed > 0) process.exit(1);
}

const message = process.argv.slice(2).join(' ');
sendBlast(message).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
