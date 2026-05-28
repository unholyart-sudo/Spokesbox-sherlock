// Uses Node.js built-in SQLite (available since Node 22.5+)
// No native compilation required
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = process.env.TORAHTXT_DB_PATH || path.join(__dirname, 'subscribers.db');

let db;

function initDb() {
  const dbPath = process.env.TORAHTXT_DB_PATH || DB_PATH;
  db = new DatabaseSync(dbPath);
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
  // Blast idempotency: durable daily lock + lightweight ledger
  db.exec(`
    CREATE TABLE IF NOT EXISTS blast_locks (
      lock_key   TEXT PRIMARY KEY,
      channel    TEXT NOT NULL,
      date       TEXT NOT NULL,
      acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
      status     TEXT NOT NULL DEFAULT 'in_progress',
      sms_sent   INTEGER DEFAULT 0,
      email_sent INTEGER DEFAULT 0,
      sms_failed INTEGER DEFAULT 0,
      email_failed INTEGER DEFAULT 0,
      completed_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS blast_ledger (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      lock_key       TEXT NOT NULL,
      recipient_type TEXT NOT NULL,
      recipient      TEXT NOT NULL,
      success        INTEGER NOT NULL DEFAULT 0,
      error          TEXT,
      sent_at        TEXT NOT NULL DEFAULT (datetime('now'))
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

// ─── Blast Lock ─────────────────────────────────────────────────────────────

// Try to acquire a blast lock. Returns true if acquired (new), false if already exists.
function tryAcquireBlastLock(lockKey, channel, date) {
  const database = getDb();
  try {
    database.prepare(
      'INSERT INTO blast_locks (lock_key, channel, date, status) VALUES (?, ?, ?, \'in_progress\')'
    ).run(lockKey, channel, date);
    return true;
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) return false;
    throw err;
  }
}

// Update lock stats and optionally mark complete.
function updateBlastLock(lockKey, { smsSent, emailSent, smsFailed, emailFailed, status } = {}) {
  const database = getDb();
  const fields = [];
  const params = [];
  if (smsSent    !== undefined) { fields.push('sms_sent = ?');    params.push(smsSent); }
  if (emailSent  !== undefined) { fields.push('email_sent = ?');  params.push(emailSent); }
  if (smsFailed  !== undefined) { fields.push('sms_failed = ?');  params.push(smsFailed); }
  if (emailFailed !== undefined){ fields.push('email_failed = ?');params.push(emailFailed); }
  if (status     !== undefined) { fields.push('status = ?');      params.push(status); }
  if (status === 'completed') { fields.push('completed_at = datetime(\'now\')'); }
  if (!fields.length) return;
  params.push(lockKey);
  database.prepare(`UPDATE blast_locks SET ${fields.join(', ')} WHERE lock_key = ?`).run(...params);
}

// Get current lock state (or undefined if none).
function getBlastLock(lockKey) {
  return getDb().prepare('SELECT * FROM blast_locks WHERE lock_key = ?').get(lockKey);
}

// List all lock rows (admin inspect).
function listBlastLocks(limit = 10) {
  return getDb().prepare('SELECT * FROM blast_locks ORDER BY acquired_at DESC LIMIT ?').all(limit);
}

// Record a ledger entry (best-effort — never throw).
function recordLedgerEntry(lockKey, type, recipient, success, error) {
  try {
    getDb().prepare(
      'INSERT INTO blast_ledger (lock_key, recipient_type, recipient, success, error) VALUES (?, ?, ?, ?, ?)'
    ).run(lockKey, type, recipient, success ? 1 : 0, error || null);
  } catch (_) {}
}

// Get ledger entries for a lock.
function getBlastLedger(lockKey) {
  return getDb().prepare('SELECT * FROM blast_ledger WHERE lock_key = ? ORDER BY id ASC').all(lockKey);
}

// Test helper — reset the db singleton (tests only).
function _resetDbForTest() { db = null; }

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
  // Blast idempotency
  tryAcquireBlastLock,
  updateBlastLock,
  getBlastLock,
  listBlastLocks,
  recordLedgerEntry,
  getBlastLedger,
  _resetDbForTest,
};
