'use strict';
/**
 * brief-tuning.test.js — PR 1 test suite
 *
 * Tests: token sign/verify/issue/consume + weight update/decay
 * Run:   node test/brief-tuning.test.js
 *
 * Uses in-memory SQLite so no external deps or running server needed.
 * Requires: better-sqlite3 (already in spokesbox/package.json)
 */

process.env.TUNE_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';

const assert  = require('assert');
const Database = require('better-sqlite3');

const {
  signToken, verifyToken,
  issueToken, validateToken, consumeToken, revokeToken,
  ACTION_CONFIG,
} = require('../lib/tune-tokens');

const {
  applyFeedback, decayWeights, seedInterests,
  WEIGHT_MIN, WEIGHT_MAX, WEIGHT_DEFAULT, WEIGHT_STEP,
} = require('../lib/brief-weights');

const {
  getSourcesForBucket, isSourceAllowed, validateSources, getAllBuckets,
} = require('../lib/brief-sources');

// ─── In-memory DB with all PR 1 tables ───────────────────────────────────────

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL
    );
    INSERT INTO subscribers (email) VALUES ('jride@test.com');  -- id=1
    INSERT INTO subscribers (email) VALUES ('avi@test.com');    -- id=2

    CREATE TABLE brief_profiles (
      subscriber_id INTEGER PRIMARY KEY REFERENCES subscribers(id) ON DELETE CASCADE,
      version       INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE brief_interests (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      subscriber_id INTEGER NOT NULL REFERENCES subscribers(id),
      bucket        TEXT NOT NULL,
      subtopic      TEXT,
      specificity   TEXT,
      weight        REAL NOT NULL DEFAULT 1.0,
      depth         TEXT NOT NULL DEFAULT 'standard',
      notes         TEXT,
      source        TEXT NOT NULL DEFAULT 'user_feedback',
      confidence    TEXT NOT NULL DEFAULT 'high',
      is_exclusion  INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_brief_interests_unique
      ON brief_interests(subscriber_id, bucket, COALESCE(subtopic, ''));

    CREATE TABLE brief_entities (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      interest_id INTEGER NOT NULL REFERENCES brief_interests(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_value TEXT NOT NULL,
      weight      REAL NOT NULL DEFAULT 1.0,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE brief_feedback (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      subscriber_id INTEGER NOT NULL,
      token_id      TEXT,
      action        TEXT NOT NULL,
      context_bucket TEXT,
      context_label  TEXT,
      context_date   TEXT,
      applied_at    INTEGER NOT NULL
    );

    CREATE TABLE tune_tokens (
      id            TEXT PRIMARY KEY,
      subscriber_id INTEGER NOT NULL REFERENCES subscribers(id),
      action        TEXT NOT NULL,
      payload       TEXT,
      issued_at     INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      used_at       INTEGER,
      use_count     INTEGER NOT NULL DEFAULT 0,
      max_uses      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE brief_source_suggestions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      subscriber_id    INTEGER NOT NULL,
      bucket           TEXT NOT NULL,
      suggested_source TEXT NOT NULL,
      created_at       INTEGER NOT NULL
    );
  `);

  // Seed a profile and an interest for subscriber 1
  const now = Date.now();
  db.prepare('INSERT INTO brief_profiles (subscriber_id, version, created_at, updated_at) VALUES (1, 1, ?, ?)').run(now, now);
  db.prepare(`
    INSERT INTO brief_interests
      (subscriber_id, bucket, subtopic, weight, depth, is_exclusion, source, confidence, created_at, updated_at)
    VALUES
      (1, 'Sports', 'NBA Warriors', 1.0, 'standard', 0, 'user_feedback', 'high', ?, ?)
  `).run(now, now);

  return db;
}

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Token sign / verify (no DB)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── Token: sign / verify ──');

test('valid token round-trips correctly', () => {
  const payload = { sub: 1, act: 'more', jti: 'abc', iat: 1000, exp: 9999999999 };
  const token = signToken(payload);
  const decoded = verifyToken(token);
  assert.deepStrictEqual(decoded, payload);
});

test('tampered payload returns null', () => {
  const token = signToken({ sub: 1, act: 'more', jti: 'abc', iat: 1, exp: 9999999999 });
  const [encoded, sig] = token.split('.');
  // Flip one char in the encoded section
  const tampered = encoded.slice(0, -1) + (encoded.slice(-1) === 'A' ? 'B' : 'A') + '.' + sig;
  assert.strictEqual(verifyToken(tampered), null);
});

test('tampered signature returns null', () => {
  const token = signToken({ sub: 1, act: 'more', jti: 'abc', iat: 1, exp: 9999999999 });
  const parts = token.split('.');
  parts[1] = parts[1].slice(0, -2) + '00';
  assert.strictEqual(verifyToken(parts.join('.')), null);
});

test('missing token returns null', () => {
  assert.strictEqual(verifyToken(null), null);
  assert.strictEqual(verifyToken(''), null);
  assert.strictEqual(verifyToken('notavalidtoken'), null);
});

test('wrong TUNE_SECRET returns null', () => {
  const token = signToken({ sub: 1, jti: 'x', iat: 1, exp: 9999999999 });
  const orig = process.env.TUNE_SECRET;
  process.env.TUNE_SECRET = 'a-completely-different-secret-that-is-long-enough!!';
  const result = verifyToken(token);
  process.env.TUNE_SECRET = orig;
  assert.strictEqual(result, null);
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Token DB lifecycle (issueToken / validateToken / consumeToken)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── Token: DB lifecycle ──');

test('issueToken writes DB record and token validates', () => {
  const db = makeDb();
  const token = issueToken(db, 1, 'more', { bucket: 'Sports', label: 'Warriors' });
  const result = validateToken(db, token);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.payload.sub, 1);
  assert.strictEqual(result.payload.act, 'more');
});

test('expired token rejected by validateToken', () => {
  const db = makeDb();
  // Manually issue with exp in the past
  const payload = { jti: 'expired-jti', sub: 1, act: 'more', ctx: {}, iat: 1, exp: 1 };
  const token = signToken(payload);
  db.prepare(`
    INSERT INTO tune_tokens (id, subscriber_id, action, payload, issued_at, expires_at, use_count, max_uses)
    VALUES ('expired-jti', 1, 'more', '{}', 1, 1000, 0, 1)
  `).run();
  const result = validateToken(db, token);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'expired');
});

test('tampered token rejected', () => {
  const db = makeDb();
  const token = issueToken(db, 1, 'more', {});
  const [enc, sig] = token.split('.');
  const bad = enc + 'X.' + sig;
  const result = validateToken(db, bad);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'tampered');
});

test('consumeToken marks single-use token exhausted', () => {
  const db = makeDb();
  const token = issueToken(db, 1, 'more', {});
  assert.strictEqual(consumeToken(db, token), true);
  const result = validateToken(db, token);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'exhausted');
});

test('consumeToken false on already-exhausted token', () => {
  const db = makeDb();
  const token = issueToken(db, 1, 'less', {});
  consumeToken(db, token);
  assert.strictEqual(consumeToken(db, token), false);
});

test('edit_prefs token allows up to 10 uses', () => {
  const db = makeDb();
  const token = issueToken(db, 1, 'edit_prefs', {});
  for (let i = 0; i < 10; i++) {
    assert.strictEqual(consumeToken(db, token), true, `use ${i+1} should succeed`);
  }
  assert.strictEqual(consumeToken(db, token), false, '11th use should fail');
});

test('view_prefs token allows unlimited uses', () => {
  const db = makeDb();
  const token = issueToken(db, 1, 'view_prefs', {});
  for (let i = 0; i < 50; i++) {
    assert.strictEqual(consumeToken(db, token), true, `use ${i+1} should succeed`);
  }
});

test('subscriber mismatch rejected', () => {
  const db = makeDb();
  // Issue for sub=1, but manually insert with sub=2 mismatch in DB
  const token = issueToken(db, 1, 'more', {});
  const payload = verifyToken(token);
  // Corrupt the DB record to have a different subscriber
  db.prepare('UPDATE tune_tokens SET subscriber_id = 2 WHERE id = ?').run(payload.jti);
  const result = validateToken(db, token);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'sub_mismatch');
});

test('revokeToken prevents further use', () => {
  const db = makeDb();
  const token = issueToken(db, 1, 'edit_prefs', {});
  const payload = verifyToken(token);
  revokeToken(db, payload.jti);
  const result = validateToken(db, token);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'exhausted');
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Weight updates (applyFeedback)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── Weights: applyFeedback ──');

test('"more" increases weight by 0.5', () => {
  const db = makeDb();
  const { newWeight } = applyFeedback(db, 1, 'more', 'Sports', 'NBA Warriors');
  assert.strictEqual(newWeight, 1.5);
});

test('"more" clamped at max 2.0', () => {
  const db = makeDb();
  // Set weight to 2.0 first
  db.prepare('UPDATE brief_interests SET weight = 2.0 WHERE subscriber_id = 1').run();
  const { newWeight } = applyFeedback(db, 1, 'more', 'Sports', 'NBA Warriors');
  assert.strictEqual(newWeight, 2.0);
});

test('"less" decreases weight by 0.5', () => {
  const db = makeDb();
  const { newWeight } = applyFeedback(db, 1, 'less', 'Sports', 'NBA Warriors');
  assert.strictEqual(newWeight, 0.5);
});

test('"less" floored at 0.5', () => {
  const db = makeDb();
  db.prepare('UPDATE brief_interests SET weight = 0.5 WHERE subscriber_id = 1').run();
  const { newWeight } = applyFeedback(db, 1, 'less', 'Sports', 'NBA Warriors');
  assert.strictEqual(newWeight, 0.5);
});

test('"mute" sets weight 0.0 and is_exclusion = 1', () => {
  const db = makeDb();
  applyFeedback(db, 1, 'mute', 'Sports', 'NBA Warriors');
  const row = db.prepare('SELECT weight, is_exclusion FROM brief_interests WHERE subscriber_id = 1').get();
  assert.strictEqual(row.weight, 0.0);
  assert.strictEqual(row.is_exclusion, 1);
});

test('"unmute" restores weight 1.0 and clears is_exclusion', () => {
  const db = makeDb();
  applyFeedback(db, 1, 'mute', 'Sports', 'NBA Warriors');
  applyFeedback(db, 1, 'unmute', 'Sports', 'NBA Warriors');
  const row = db.prepare('SELECT weight, is_exclusion FROM brief_interests WHERE subscriber_id = 1').get();
  assert.strictEqual(row.weight, 1.0);
  assert.strictEqual(row.is_exclusion, 0);
});

test('"more" on unknown interest creates it at 1.0 then increments', () => {
  const db = makeDb();
  const { applied, newWeight } = applyFeedback(db, 1, 'more', 'Finance', 'DAC stocks');
  assert.strictEqual(applied, true);
  // New interest seeded at 1.0, then +0.5 = 1.5
  assert.strictEqual(newWeight, 1.5);
});

test('"less" on non-existent interest is a no-op (not an error)', () => {
  const db = makeDb();
  const { applied } = applyFeedback(db, 1, 'less', 'Finance', 'Nonexistent topic');
  assert.strictEqual(applied, false);
});

test('feedback is recorded in brief_feedback (immutable log)', () => {
  const db = makeDb();
  applyFeedback(db, 1, 'more', 'Sports', 'NBA Warriors', 'Warriors coverage', 'tok123', '2026-05-21');
  const row = db.prepare('SELECT * FROM brief_feedback WHERE subscriber_id = 1').get();
  assert.strictEqual(row.action, 'more');
  assert.strictEqual(row.context_bucket, 'Sports');
  assert.strictEqual(row.context_label, 'Warriors coverage');
  assert.strictEqual(row.context_date, '2026-05-21');
  assert.strictEqual(row.token_id, 'tok123');
});

test('profile version is bumped on each feedback', () => {
  const db = makeDb();
  const before = db.prepare('SELECT version FROM brief_profiles WHERE subscriber_id = 1').get();
  applyFeedback(db, 1, 'more', 'Sports', 'NBA Warriors');
  applyFeedback(db, 1, 'less', 'Sports', 'NBA Warriors');
  const after = db.prepare('SELECT version FROM brief_profiles WHERE subscriber_id = 1').get();
  assert.strictEqual(after.version, before.version + 2);
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Weight decay
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── Weights: decay ──');

test('weight > 1.5 with no recent "more" decays to 1.5 first, then pulls toward 1.0', () => {
  const db = makeDb();
  db.prepare('UPDATE brief_interests SET weight = 2.0 WHERE subscriber_id = 1').run();
  // No "more" feedback recorded → soft cap kicks in first → 1.5, then weekly pull
  const updated = decayWeights(db, 1);
  const row = db.prepare('SELECT weight FROM brief_interests WHERE subscriber_id = 1').get();
  // After soft cap: 1.5. After weekly pull: 1.5 + (1.0 - 1.5) * 0.1 = 1.45
  assert.strictEqual(row.weight, 1.45);
  assert.strictEqual(updated, 1);
});

test('weight exactly 1.0 pulls very slightly toward 1.0 (no change)', () => {
  const db = makeDb();
  const updated = decayWeights(db, 1);
  // weight = 1.0 + (1.0 - 1.0) * 0.1 = 1.0 → no change
  const row = db.prepare('SELECT weight FROM brief_interests WHERE subscriber_id = 1').get();
  assert.strictEqual(row.weight, 1.0);
  assert.strictEqual(updated, 0);
});

test('weight 0.5 decays toward 1.0 (upward pull)', () => {
  const db = makeDb();
  db.prepare('UPDATE brief_interests SET weight = 0.5 WHERE subscriber_id = 1').run();
  decayWeights(db, 1);
  const row = db.prepare('SELECT weight FROM brief_interests WHERE subscriber_id = 1').get();
  // 0.5 + (1.0 - 0.5) * 0.1 = 0.55
  assert.strictEqual(row.weight, 0.55);
});

test('muted interest (weight=0.0) is not touched by decay', () => {
  const db = makeDb();
  db.prepare('UPDATE brief_interests SET weight = 0.0, is_exclusion = 1 WHERE subscriber_id = 1').run();
  const updated = decayWeights(db, 1);
  const row = db.prepare('SELECT weight FROM brief_interests WHERE subscriber_id = 1').get();
  assert.strictEqual(row.weight, 0.0);
  assert.strictEqual(updated, 0);
});

test('recent "more" click prevents decay', () => {
  const db = makeDb();
  db.prepare('UPDATE brief_interests SET weight = 2.0 WHERE subscriber_id = 1').run();
  // Insert a "more" click within 14 days
  db.prepare(`
    INSERT INTO brief_feedback (subscriber_id, token_id, action, context_bucket, applied_at)
    VALUES (1, null, 'more', 'Sports', ?)
  `).run(Date.now());
  decayWeights(db, 1);
  const row = db.prepare('SELECT weight FROM brief_interests WHERE subscriber_id = 1').get();
  assert.strictEqual(row.weight, 2.0);  // unchanged — protected by recent click
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5 — seedInterests
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── Weights: seedInterests ──');

test('seedInterests creates interests with sam_onboarding_seed source', () => {
  const db = makeDb();
  seedInterests(db, 2, [  // subscriber 2 = avi (no profile yet)
    { bucket: 'Sports', subtopic: 'Soccer', specificity: 'MLS', entities: [{ type: 'team', value: 'NYRB' }] },
    { bucket: 'Finance', subtopic: 'Stocks', entities: [] },
  ]);
  const interests = db.prepare('SELECT * FROM brief_interests WHERE subscriber_id = 2').all();
  assert.strictEqual(interests.length, 2);
  assert.ok(interests.every(i => i.source === 'sam_onboarding_seed'));
  assert.ok(interests.every(i => i.confidence === 'medium'));
  assert.ok(interests.every(i => i.weight === 1.0));
});

test('seedInterests creates entities for each interest', () => {
  const db = makeDb();
  seedInterests(db, 2, [
    { bucket: 'Sports', subtopic: 'Soccer', entities: [
      { type: 'team', value: 'NYRB' },
      { type: 'team', value: 'LAFC' },
    ]},
  ]);
  const interest = db.prepare('SELECT * FROM brief_interests WHERE subscriber_id = 2').get();
  const entities = db.prepare('SELECT * FROM brief_entities WHERE interest_id = ?').all(interest.id);
  assert.strictEqual(entities.length, 2);
  assert.strictEqual(entities[0].entity_value, 'NYRB');
  assert.strictEqual(entities[0].entity_type, 'team');
});

test('seedInterests is idempotent (OR IGNORE on re-run)', () => {
  const db = makeDb();
  const seed = [{ bucket: 'Tech', subtopic: 'AI', entities: [] }];
  seedInterests(db, 2, seed);
  seedInterests(db, 2, seed);  // second call — no duplicate
  const count = db.prepare('SELECT COUNT(*) as n FROM brief_interests WHERE subscriber_id = 2').get().n;
  assert.strictEqual(count, 1);
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 6 — ALLOWED_SOURCES
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── Sources ──');

test('getSourcesForBucket returns non-empty array for known buckets', () => {
  for (const bucket of ['Finance', 'Sports', 'Tech', 'Local', 'World', 'Politics', 'Art']) {
    const sources = getSourcesForBucket(bucket);
    assert.ok(sources.length > 0, `${bucket} should have sources`);
  }
});

test('getSourcesForBucket returns [] for unknown bucket', () => {
  assert.deepStrictEqual(getSourcesForBucket('Unknown'), []);
});

test('isSourceAllowed accepts valid source', () => {
  assert.strictEqual(isSourceAllowed('Finance', 'bloomberg'), true);
  assert.strictEqual(isSourceAllowed('Sports', 'espn'), true);
});

test('isSourceAllowed rejects invalid source', () => {
  assert.strictEqual(isSourceAllowed('Finance', 'some-random-site'), false);
  assert.strictEqual(isSourceAllowed('Sports', 'bloomberg'), false);  // wrong bucket
});

test('validateSources separates valid from invalid', () => {
  const { valid, invalid } = validateSources('Finance', ['bloomberg', 'wsj', 'shady-site.com']);
  assert.deepStrictEqual(valid,   ['bloomberg', 'wsj']);
  assert.deepStrictEqual(invalid, ['shady-site.com']);
});

test('getAllBuckets returns expected set', () => {
  const buckets = getAllBuckets();
  assert.ok(buckets.includes('Finance'));
  assert.ok(buckets.includes('Sports'));
  assert.ok(buckets.includes('Tech'));
  assert.ok(buckets.includes('Art'));
});

// ═════════════════════════════════════════════════════════════════════════════
// Results
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed   ${failed} failed`);
console.log(`${'─'.repeat(50)}\n`);

if (failed > 0) process.exit(1);
