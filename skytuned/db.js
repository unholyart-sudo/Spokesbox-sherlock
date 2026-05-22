// Uses Node.js built-in SQLite (Node 22.5+) — no native compilation needed
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = path.join(__dirname, 'subscribers.db');
let db;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sms_subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT UNIQUE,
        sign TEXT,
        birth_date TEXT,
        birth_time TEXT,
        birth_city TEXT,
        token TEXT,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS email_subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        sign TEXT,
        birth_date TEXT,
        birth_time TEXT,
        birth_city TEXT,
        token TEXT,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }
  return db;
}

// SMS
function addSmsSubscriber(name, phone, sign, birthDate) {
  const db = getDb();
  const token = crypto.randomBytes(16).toString('hex');
  try {
    const existing = db.prepare('SELECT * FROM sms_subscribers WHERE phone = ?').get(phone);
    if (existing) {
      if (!existing.active) {
        db.prepare('UPDATE sms_subscribers SET active = 1, name = ?, sign = ?, birth_date = ?, token = ? WHERE phone = ?')
          .run(name, sign, birthDate, token, phone);
        return { success: true, reactivated: true };
      }
      return { success: false, error: 'already_subscribed' };
    }
    db.prepare('INSERT INTO sms_subscribers (name, phone, sign, birth_date, token) VALUES (?, ?, ?, ?, ?)').run(name, phone, sign, birthDate, token);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function unsubscribeSms(phone, token) {
  const db = getDb();
  const result = db.prepare('UPDATE sms_subscribers SET active = 0 WHERE phone = ? AND token = ?').run(phone, token);
  return result.changes > 0;
}

function getActiveSmsSubscribers() {
  return getDb().prepare('SELECT * FROM sms_subscribers WHERE active = 1').all();
}

function getSmsCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM sms_subscribers WHERE active = 1').get().count;
}

// Email
function addEmailSubscriber(name, email, sign, birthDate) {
  const db = getDb();
  const token = crypto.randomBytes(16).toString('hex');
  try {
    const existing = db.prepare('SELECT * FROM email_subscribers WHERE email = ?').get(email);
    if (existing) {
      if (!existing.active) {
        db.prepare('UPDATE email_subscribers SET active = 1, name = ?, sign = ?, birth_date = ?, token = ? WHERE email = ?')
          .run(name, sign, birthDate, token, email);
        return { success: true, reactivated: true };
      }
      return { success: false, error: 'already_subscribed' };
    }
    db.prepare('INSERT INTO email_subscribers (name, email, sign, birth_date, token) VALUES (?, ?, ?, ?, ?)').run(name, email, sign, birthDate, token);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function unsubscribeEmail(email, token) {
  const db = getDb();
  const result = db.prepare('UPDATE email_subscribers SET active = 0 WHERE email = ? AND token = ?').run(email, token);
  return result.changes > 0;
}

function getActiveEmailSubscribers() {
  return getDb().prepare('SELECT * FROM email_subscribers WHERE active = 1').all();
}

function getEmailCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM email_subscribers WHERE active = 1').get().count;
}

function updateProfile(identifier, type, birthTime, birthCity) {
  const db = getDb();
  if (type === 'sms') {
    db.prepare('UPDATE sms_subscribers SET birth_time = ?, birth_city = ? WHERE phone = ?').run(birthTime, birthCity, identifier);
  } else {
    db.prepare('UPDATE email_subscribers SET birth_time = ?, birth_city = ? WHERE email = ?').run(birthTime, birthCity, identifier);
  }
}

module.exports = {
  addSmsSubscriber, unsubscribeSms, getActiveSmsSubscribers, getSmsCount,
  addEmailSubscriber, unsubscribeEmail, getActiveEmailSubscribers, getEmailCount,
  updateProfile
};
