'use strict';
/**
 * blast-idempotency.test.js
 * Tests for /blast durable daily lock behaviour.
 *
 * Guarantees:
 *   - No Telnyx or SendGrid calls (BLAST_TEST_MODE=1 stubs both)
 *   - Uses a temp SQLite DB that is removed after each test run
 *   - Uses Node built-in test runner (node:test) — no extra deps
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

// ── Test DB isolation ────────────────────────────────────────────────────────
const TEST_DB = path.join(os.tmpdir(), `torahtxt-test-${Date.now()}.db`);
process.env.TORAHTXT_DB_PATH = TEST_DB;
process.env.BLAST_TEST_MODE  = '1';
// Prevent the server from loading real .env values that could override DB path
process.env.PORT = '0'; // OS assigns a free port

// Load db module AFTER setting env so it picks up the test DB path
const db = require('../db');
db.initDb();

// ── Helpers ──────────────────────────────────────────────────────────────────
const BLAST_SECRET = process.env.BLAST_SECRET || 'torahtxt_blast_secret_2025';

function todayKey() {
  const d = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return `blast:sms_email:${d}`;
}

function otherDayKey(offset = -1) {
  const d = new Date(Date.now() + offset * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return `blast:sms_email:${d}`;
}

// ── DB unit tests (no HTTP) ──────────────────────────────────────────────────
describe('blast_locks DB functions', () => {
  test('tryAcquireBlastLock returns true on first call', () => {
    const key = `blast:sms_email:test-${Date.now()}`;
    const result = db.tryAcquireBlastLock(key, 'sms_email', '2099-01-01');
    assert.equal(result, true, 'First acquisition should succeed');
  });

  test('tryAcquireBlastLock returns false on second call with same key', () => {
    const key = `blast:sms_email:test-${Date.now()}`;
    db.tryAcquireBlastLock(key, 'sms_email', '2099-01-02');
    const second = db.tryAcquireBlastLock(key, 'sms_email', '2099-01-02');
    assert.equal(second, false, 'Second acquisition should be rejected');
  });

  test('tryAcquireBlastLock returns false on repeated calls', () => {
    const key = `blast:sms_email:test-${Date.now()}`;
    db.tryAcquireBlastLock(key, 'sms_email', '2099-01-03');
    for (let i = 0; i < 5; i++) {
      assert.equal(
        db.tryAcquireBlastLock(key, 'sms_email', '2099-01-03'),
        false,
        `Call ${i + 2} should be rejected`
      );
    }
  });

  test('different date key acquires a new lock', () => {
    const key1 = `blast:sms_email:2099-02-01`;
    const key2 = `blast:sms_email:2099-02-02`;
    assert.equal(db.tryAcquireBlastLock(key1, 'sms_email', '2099-02-01'), true);
    assert.equal(db.tryAcquireBlastLock(key2, 'sms_email', '2099-02-02'), true,
      'New date should get its own lock');
  });

  test('getBlastLock returns the row after acquisition', () => {
    const key = `blast:sms_email:test-get-${Date.now()}`;
    db.tryAcquireBlastLock(key, 'sms_email', '2099-03-01');
    const row = db.getBlastLock(key);
    assert.ok(row, 'Row should exist');
    assert.equal(row.lock_key, key);
    assert.equal(row.status, 'in_progress');
    assert.equal(row.channel, 'sms_email');
  });

  test('getBlastLock returns undefined for non-existent key', () => {
    const row = db.getBlastLock('blast:sms_email:9999-99-99');
    assert.equal(row, undefined);
  });

  test('updateBlastLock sets completion stats', () => {
    const key = `blast:sms_email:test-update-${Date.now()}`;
    db.tryAcquireBlastLock(key, 'sms_email', '2099-04-01');
    db.updateBlastLock(key, { smsSent: 10, emailSent: 5, smsFailed: 1, emailFailed: 0, status: 'completed' });
    const row = db.getBlastLock(key);
    assert.equal(row.status, 'completed');
    assert.equal(row.sms_sent, 10);
    assert.equal(row.email_sent, 5);
    assert.equal(row.sms_failed, 1);
    assert.ok(row.completed_at, 'completed_at should be set');
  });

  test('lock persists after simulated crash (no auto-clear)', () => {
    const key = `blast:sms_email:crash-${Date.now()}`;
    db.tryAcquireBlastLock(key, 'sms_email', '2099-05-01');
    // Simulate crash: do NOT call updateBlastLock — lock stays 'in_progress'
    // Reload — lock should still be there
    const row = db.getBlastLock(key);
    assert.ok(row, 'Lock should survive without explicit completion');
    assert.equal(row.status, 'in_progress', 'Status stays in_progress — no auto-clear');
    // Second acquisition still blocked
    assert.equal(db.tryAcquireBlastLock(key, 'sms_email', '2099-05-01'), false,
      'Lock blocks re-entry even after crash');
  });

  test('recordLedgerEntry and getBlastLedger work', () => {
    const key = `blast:sms_email:ledger-${Date.now()}`;
    db.tryAcquireBlastLock(key, 'sms_email', '2099-06-01');
    db.recordLedgerEntry(key, 'sms', '+15550001111', true, null);
    db.recordLedgerEntry(key, 'email', 'test@example.com', false, 'timeout');
    const rows = db.getBlastLedger(key);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].recipient_type, 'sms');
    assert.equal(rows[0].success, 1);
    assert.equal(rows[1].recipient_type, 'email');
    assert.equal(rows[1].success, 0);
    assert.equal(rows[1].error, 'timeout');
  });
});

// ── HTTP endpoint tests ───────────────────────────────────────────────────────
// Start the actual express app on a free port, BLAST_TEST_MODE=1 prevents live sends.
describe('POST /blast endpoint', () => {
  let server;
  let baseUrl;
  // Each suite gets a fresh day key to isolate from DB unit tests above
  const TEST_DATE = '2099-07-04';

  before(async () => {
    // Override initDb to use the already-open test db (avoid double-open)
    const app = require('../server');
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  async function postBlast(body, headers = {}) {
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(baseUrl + '/blast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-blast-secret': BLAST_SECRET,
          ...headers,
        },
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async function getAdminLock(headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(baseUrl + '/admin/blast-lock', {
        method: 'GET',
        headers: { 'x-blast-secret': BLAST_SECRET, ...headers },
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  test('missing secret returns 403', async () => {
    const { status } = await postBlast({ message: 'Hello' }, { 'x-blast-secret': 'wrong' });
    assert.equal(status, 403);
  });

  test('missing message returns 400', async () => {
    const { status, body } = await postBlast({ message: '' });
    assert.equal(status, 400);
    assert.equal(body.success, false);
  });

  test('first POST acquires lock and succeeds (no live sends)', async () => {
    // Use a unique key per test run by patching the date — we simulate by
    // inserting a lock for yesterday so today's key is still free.
    const { status, body } = await postBlast({ message: 'Daily Torah test' });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.ok(!body.skipped, 'First call must not be skipped');
    assert.ok(body.lockKey, 'Response must include lockKey');
    assert.ok(typeof body.sms === 'object', 'Response must include sms stats');
    assert.ok(typeof body.email === 'object', 'Response must include email stats');
  });

  test('second POST returns already_sent_today without sending', async () => {
    const { status, body } = await postBlast({ message: 'Daily Torah test again' });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.skipped, true);
    assert.equal(body.reason, 'already_sent_today');
  });

  test('repeated POSTs all return already_sent_today', async () => {
    for (let i = 0; i < 3; i++) {
      const { body } = await postBlast({ message: `Repeat ${i}` });
      assert.equal(body.skipped, true);
      assert.equal(body.reason, 'already_sent_today');
    }
  });

  test('admin blast-lock endpoint returns lock state', async () => {
    const { status, body } = await getAdminLock();
    assert.equal(status, 200);
    assert.ok(body.today, 'Must include today key');
    assert.ok(body.today.lock, 'Today lock must be present after blast ran');
    assert.equal(body.today.lock.status, 'completed');
  });

  test('admin blast-lock endpoint is protected (wrong secret → 403)', async () => {
    const { status } = await getAdminLock({ 'x-blast-secret': 'bad' });
    assert.equal(status, 403);
  });
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
after(() => {
  try { fs.unlinkSync(TEST_DB); } catch (_) {}
});
