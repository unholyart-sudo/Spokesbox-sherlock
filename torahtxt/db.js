// Uses Node.js built-in SQLite (available since Node 22.5+)
// No native compilation required
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = path.join(__dirname, 'subscribers.db');

let db;

function initDb() {
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT UNIQUE,
      token TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return db;
}

function getDb() {
  if (!db) initDb();
  return db;
}

function addSubscriber(name, phone) {
  const db = getDb();
  const token = crypto.randomBytes(16).toString('hex');
  try {
    const stmt = db.prepare(
      'INSERT INTO subscribers (name, phone, token, active) VALUES (?, ?, ?, 1)'
    );
    stmt.run(name, phone, token);
    const subscriber = db.prepare('SELECT * FROM subscribers WHERE phone = ?').get(phone);
    return { success: true, message: 'Subscriber added', subscriber };
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      // Check if they were previously unsubscribed
      const existing = db.prepare('SELECT * FROM subscribers WHERE phone = ?').get(phone);
      if (existing && existing.active === 0) {
        // Reactivate
        const newToken = crypto.randomBytes(16).toString('hex');
        db.prepare('UPDATE subscribers SET active = 1, name = ?, token = ? WHERE phone = ?').run(name, newToken, phone);
        const updated = db.prepare('SELECT * FROM subscribers WHERE phone = ?').get(phone);
        return { success: true, message: 'Resubscribed successfully', subscriber: updated };
      }
      return { success: false, message: 'This phone number is already subscribed.' };
    }
    throw err;
  }
}

function removeSubscriberByToken(phone, token) {
  const db = getDb();
  const stmt = db.prepare('UPDATE subscribers SET active = 0 WHERE phone = ? AND token = ?');
  const result = stmt.run(phone, token);
  return result.changes > 0;
}

function removeSubscriberByPhone(phone) {
  const db = getDb();
  const stmt = db.prepare('UPDATE subscribers SET active = 0 WHERE phone = ?');
  const result = stmt.run(phone);
  return result.changes > 0;
}

function getActiveSubscribers() {
  const db = getDb();
  return db.prepare('SELECT * FROM subscribers WHERE active = 1').all();
}

function getSubscriberCount() {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM subscribers WHERE active = 1').get();
  return row.count;
}

// ─── Email Subscribers ──────────────────────────────────────────────────────

function initEmailTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      token TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  migrateEmailAuditColumns();
  backfillUnsubscribeMethod();
}

// Add audit columns if they don't exist yet (idempotent migration)
function migrateEmailAuditColumns() {
  const db = getDb();
  const cols = ['unsubscribed_at', 'unsubscribe_method'];
  for (const col of cols) {
    try {
      db.exec(`ALTER TABLE email_subscribers ADD COLUMN ${col} TEXT DEFAULT NULL`);
    } catch (err) {
      // Column already exists — safe to ignore
      if (!err.message || !err.message.includes('duplicate column')) throw err;
    }
  }
}

// Set unsubscribe_method='unknown' for pre-existing inactive records with no method recorded
function backfillUnsubscribeMethod() {
  const db = getDb();
  db.exec(`
    UPDATE email_subscribers
    SET unsubscribe_method = 'unknown'
    WHERE active = 0 AND unsubscribe_method IS NULL
  `);
}

// Call initEmailTable whenever we init
const _origInitDb = initDb;
function initDbWithEmail() {
  const db = _origInitDb();
  initEmailTable();
  return db;
}

function addEmailSubscriber(name, email) {
  initEmailTable();
  const db = getDb();
  const token = crypto.randomBytes(16).toString('hex');
  try {
    const stmt = db.prepare(
      'INSERT INTO email_subscribers (name, email, token, active) VALUES (?, ?, ?, 1)'
    );
    stmt.run(name, email, token);
    const subscriber = db.prepare('SELECT * FROM email_subscribers WHERE email = ?').get(email);
    return { success: true, message: 'Email subscriber added', subscriber };
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      const existing = db.prepare('SELECT * FROM email_subscribers WHERE email = ?').get(email);
      if (existing && existing.active === 0) {
        const newToken = crypto.randomBytes(16).toString('hex');
        db.prepare('UPDATE email_subscribers SET active = 1, name = ?, token = ? WHERE email = ?').run(name, newToken, email);
        const updated = db.prepare('SELECT * FROM email_subscribers WHERE email = ?').get(email);
        return { success: true, message: 'Re-subscribed successfully', subscriber: updated };
      }
      return { success: false, message: 'This email address is already subscribed.' };
    }
    throw err;
  }
}

// Look up an email subscriber by email+token without modifying anything.
// Returns the row if found and active, null otherwise.
function lookupEmailSubscriberByToken(email, token) {
  initEmailTable();
  const db = getDb();
  return db.prepare('SELECT id, email, name, active FROM email_subscribers WHERE email = ? AND token = ?').get(email, token) || null;
}

// Deactivate an email subscriber by email+token.
// method should be 'confirmed_click' (two-step) or 'unknown' (legacy/backfill).
// Returns true if a row was updated, false if token/email didn't match or already inactive.
function removeEmailSubscriberByToken(email, token, method = 'confirmed_click') {
  initEmailTable();
  const db = getDb();
  const result = db.prepare(
    `UPDATE email_subscribers
     SET active = 0,
         unsubscribed_at = datetime('now'),
         unsubscribe_method = ?
     WHERE email = ? AND token = ? AND active = 1`
  ).run(method, email, token);
  return result.changes > 0;
}

function removeEmailSubscriberByEmail(email) {
  initEmailTable();
  const db = getDb();
  const result = db.prepare('UPDATE email_subscribers SET active = 0 WHERE email = ?').run(email);
  return result.changes > 0;
}

function getActiveEmailSubscribers() {
  initEmailTable();
  const db = getDb();
  return db.prepare('SELECT * FROM email_subscribers WHERE active = 1').all();
}

function getEmailSubscriberCount() {
  initEmailTable();
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM email_subscribers WHERE active = 1').get();
  return row.count;
}

module.exports = {
  initDb: initDbWithEmail,
  addSubscriber,
  removeSubscriberByToken,
  removeSubscriberByPhone,
  getActiveSubscribers,
  getSubscriberCount,
  addEmailSubscriber,
  lookupEmailSubscriberByToken,
  removeEmailSubscriberByToken,
  removeEmailSubscriberByEmail,
  getActiveEmailSubscribers,
  getEmailSubscriberCount,
};
