const express = require('express');
const path = require('path');
const {
  addSmsSubscriber, unsubscribeSms, getActiveSmsSubscribers, getSmsCount,
  addEmailSubscriber, unsubscribeEmail, getActiveEmailSubscribers, getEmailCount,
  updateProfile
} = require('./db');

const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Subscriber counts (for live counter on landing page)
app.get('/subscribers/count', (req, res) => {
  res.json({ count: getSmsCount() });
});

app.get('/subscribers/email-count', (req, res) => {
  res.json({ count: getEmailCount() });
});

// SMS signup
app.post('/subscribe/sms', (req, res) => {
  const { name, phone, sign, birth_date } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const result = addSmsSubscriber(name || '', phone, sign || '', birth_date || '');
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, reactivated: result.reactivated || false });
});

// Email signup
app.post('/subscribe/email', (req, res) => {
  const { name, email, sign, birth_date } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const result = addEmailSubscriber(name || '', email, sign || '', birth_date || '');
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, reactivated: result.reactivated || false });
});

// Unsubscribe
app.get('/unsubscribe', (req, res) => {
  const { phone, email, token } = req.query;
  if (phone) {
    unsubscribeSms(phone, token);
  } else if (email) {
    unsubscribeEmail(email, token);
  }
  res.sendFile(path.join(__dirname, 'public', 'unsubscribed.html'));
});

// Profile page
app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// Update profile (birth time/city for deeper reading)
app.post('/profile/update', (req, res) => {
  const { identifier, type, email, birth_time, birth_city } = req.body;
  const id = identifier || email;
  if (!id) return res.status(400).json({ error: 'Identifier required' });
  updateProfile(id, type || 'email', birth_time || '', birth_city || '');
  res.json({ success: true });
});

// Admin stats (protected by secret header)
app.get('/admin/stats', (req, res) => {
  if (req.headers['x-admin-secret'] !== 'skytuned_admin_2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({
    sms: getSmsCount(),
    email: getEmailCount(),
    total: getSmsCount() + getEmailCount()
  });
});

app.listen(PORT, () => {
  console.log(`🌌 SkyTuned running on http://localhost:${PORT}`);
  console.log(`   Subscriber count: http://localhost:${PORT}/subscribers/count`);
  console.log(`   Admin stats: http://localhost:${PORT}/admin/stats`);
});
