'use strict';
/**
 * tune-tokens.js — Signed token infrastructure for Brief Tuning (PR 1)
 *
 * Tokens are used to authenticate no-login email link actions:
 *   more / less / mute / unmute / edit_prefs / view_prefs
 *
 * Format:  <base64url(JSON payload)>.<hex(HMAC-SHA256(payload, TUNE_SECRET))>
 * Storage: tune_tokens table (enables revocation, use-count enforcement)
 *
 * All public functions accept `db` as first arg so tests can pass an in-memory DB.
 */

const crypto = require('crypto');

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_CONFIG = {
  more:        { ttlDays: 7,  maxUses: 1  },
  less:        { ttlDays: 7,  maxUses: 1  },
  mute:        { ttlDays: 7,  maxUses: 1  },
  unmute:      { ttlDays: 7,  maxUses: 1  },
  edit_prefs:  { ttlDays: 1,  maxUses: 10 },
  view_prefs:  { ttlDays: 30, maxUses: -1 }, // -1 = unlimited
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getSecret() {
  const s = process.env.TUNE_SECRET;
  if (!s || s.length < 32) {
    throw new Error('TUNE_SECRET must be set and at least 32 characters');
  }
  return s;
}

function b64urlEncode(str) {
  return Buffer.from(str).toString('base64url');
}

function b64urlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

function hmac(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function nowSec()  { return Math.floor(Date.now() / 1000); }
function nowMs()   { return Date.now(); }

// ─── Core sign / verify ───────────────────────────────────────────────────────

/**
 * Sign a payload object and return a token string.
 * Does NOT write to DB — call issueToken() for that.
 */
function signToken(payload) {
  const encoded = b64urlEncode(JSON.stringify(payload));
  const sig = hmac(encoded, getSecret());
  return `${encoded}.${sig}`;
}

/**
 * Verify and decode a token string.
 * Returns the payload object, or null if tampered / malformed.
 * Does NOT check expiry or use-count — call issueToken/consumeToken for that.
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const encoded = token.slice(0, dot);
  const givenSig = token.slice(dot + 1);

  // Timing-safe comparison
  const expectedSig = hmac(encoded, getSecret());
  try {
    const a = Buffer.from(givenSig,    'hex');
    const b = Buffer.from(expectedSig, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    return JSON.parse(b64urlDecode(encoded));
  } catch {
    return null;
  }
}

// ─── DB-backed token lifecycle ────────────────────────────────────────────────

/**
 * Issue a new token:
 *  1. Build and sign the payload
 *  2. Write to tune_tokens
 *  3. Return the token string (embed in email link)
 *
 * @param {object} db           - better-sqlite3 db instance
 * @param {number} subscriberId
 * @param {string} action       - one of ACTION_CONFIG keys
 * @param {object} context      - { bucket, subtopic, specificity, label, date }
 * @returns {string} token string
 */
function issueToken(db, subscriberId, action, context = {}) {
  const config = ACTION_CONFIG[action];
  if (!config) throw new Error(`Unknown token action: ${action}`);

  const jti     = crypto.randomBytes(24).toString('hex');
  const issuedSec = nowSec();
  const expiresSec = issuedSec + config.ttlDays * 86400;

  const payload = {
    jti,
    sub: subscriberId,
    act: action,
    ctx: context,       // bucket / subtopic / label / date — stored in payload for display
    iat: issuedSec,
    exp: expiresSec,
  };

  const token = signToken(payload);

  db.prepare(`
    INSERT INTO tune_tokens
      (id, subscriber_id, action, payload, issued_at, expires_at, use_count, max_uses)
    VALUES
      (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    jti,
    subscriberId,
    action,
    JSON.stringify(context),
    nowMs(),
    expiresSec * 1000,
    config.maxUses,
  );

  return token;
}

/**
 * Validate a token string fully:
 *  - HMAC correct
 *  - Not expired
 *  - DB record exists
 *  - Use count not exceeded (unless unlimited)
 *
 * Returns { ok: true, payload, record } or { ok: false, reason }
 */
function validateToken(db, token) {
  const payload = verifyToken(token);
  if (!payload) return { ok: false, reason: 'tampered' };

  if (nowSec() > payload.exp) return { ok: false, reason: 'expired' };

  const record = db.prepare('SELECT * FROM tune_tokens WHERE id = ?').get(payload.jti);
  if (!record) return { ok: false, reason: 'not_found' };

  if (record.subscriber_id !== payload.sub) return { ok: false, reason: 'sub_mismatch' };

  // unlimited = max_uses -1
  if (record.max_uses !== -1 && record.use_count >= record.max_uses) {
    return { ok: false, reason: 'exhausted' };
  }

  return { ok: true, payload, record };
}

/**
 * Consume one use of a token.
 * For single-use tokens (max_uses=1), sets used_at.
 * For multi-use, increments use_count.
 * For unlimited (max_uses=-1), just increments use_count (for audit).
 *
 * Returns true if consumed, false if invalid/exhausted.
 */
function consumeToken(db, token) {
  const result = validateToken(db, token);
  if (!result.ok) return false;

  const { record } = result;
  const now = nowMs();

  if (record.max_uses === 1) {
    // Single-use: set used_at
    db.prepare(`
      UPDATE tune_tokens
      SET use_count = use_count + 1, used_at = ?
      WHERE id = ? AND use_count < max_uses
    `).run(now, record.id);
  } else {
    // Multi-use or unlimited: increment only
    db.prepare(`
      UPDATE tune_tokens
      SET use_count = use_count + 1
      WHERE id = ?
    `).run(record.id);
  }

  return true;
}

/**
 * Revoke a token by ID (jti). Sets use_count to max_uses, preventing further use.
 */
function revokeToken(db, jti) {
  db.prepare(`
    UPDATE tune_tokens
    SET use_count = max_uses, used_at = ?
    WHERE id = ?
  `).run(nowMs(), jti);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  signToken,
  verifyToken,
  issueToken,
  validateToken,
  consumeToken,
  revokeToken,
  ACTION_CONFIG,
};
