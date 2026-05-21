'use strict';
/**
 * brief-weights.js — Weight update + decay utilities for Brief Tuning (PR 1)
 *
 * Weight semantics:
 *   0.0       muted — never include
 *   0.1–0.4   very soft
 *   0.5       soft — include only if exceptional
 *   1.0       normal (default)
 *   1.5       strong — prioritize
 *   2.0       essential — always include
 *
 * Rules:
 *   - min = 0.1 (except explicit mute = 0.0)
 *   - max = 2.0
 *   - "more"   adds 0.5, capped at 2.0
 *   - "less"   subtracts 0.5, floored at 0.5 (keeps it in play; use mute to silence)
 *   - "mute"   sets 0.0, is_exclusion = 1
 *   - "unmute" sets 1.0, is_exclusion = 0
 *
 * Decay (run weekly, Sunday 23:00 ET):
 *   - Soft cap: weight > 1.5 AND no "more" click in past 14 days → decay to 1.5
 *   - Weekly pull: weight = weight + (1.0 - weight) * 0.1 (10% toward neutral)
 *   - Decay does NOT apply to muted interests (weight = 0.0)
 *   - Decay does NOT apply to interests with a "more" click in the past 14 days
 *
 * All public functions accept `db` as first arg (testable with in-memory DB).
 */

const WEIGHT_MIN    = 0.1;
const WEIGHT_MAX    = 2.0;
const WEIGHT_DEFAULT = 1.0;
const WEIGHT_STEP   = 0.5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function nowMs() { return Date.now(); }

// ─── Apply feedback ───────────────────────────────────────────────────────────

/**
 * Apply a single user feedback action to an interest row.
 *
 * @param {object} db           - better-sqlite3 db instance
 * @param {number} subscriberId
 * @param {string} action       - "more" | "less" | "mute" | "unmute"
 * @param {string} bucket       - e.g. "Sports"
 * @param {string|null} subtopic - e.g. "NBA Warriors" (null = match bucket only)
 * @param {string|null} label   - human label from the email (stored in feedback log)
 * @param {string|null} tokenId - jti of the tune token that triggered this
 * @param {string|null} contextDate - YYYY-MM-DD of the email (for audit)
 * @returns {{ applied: boolean, interestId: number|null, newWeight: number|null }}
 */
function applyFeedback(db, subscriberId, action, bucket, subtopic = null, label = null, tokenId = null, contextDate = null) {
  const validActions = ['more', 'less', 'mute', 'unmute'];
  if (!validActions.includes(action)) {
    throw new Error(`Invalid feedback action: ${action}`);
  }

  // Find the interest row to update
  let interest;
  if (subtopic) {
    interest = db.prepare(`
      SELECT * FROM brief_interests
      WHERE subscriber_id = ? AND bucket = ? AND subtopic = ?
      LIMIT 1
    `).get(subscriberId, bucket, subtopic);
  }
  if (!interest) {
    // Fall back to bucket-level match
    interest = db.prepare(`
      SELECT * FROM brief_interests
      WHERE subscriber_id = ? AND bucket = ?
      ORDER BY weight DESC
      LIMIT 1
    `).get(subscriberId, bucket);
  }

  // If no interest exists yet and action is "more", create a default one
  if (!interest && action === 'more') {
    const now = nowMs();
    const info = db.prepare(`
      INSERT INTO brief_interests
        (subscriber_id, bucket, subtopic, weight, depth, is_exclusion, source, confidence, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, 'standard', 0, 'user_feedback', 'high', ?, ?)
    `).run(subscriberId, bucket, subtopic || null, WEIGHT_DEFAULT, now, now);
    interest = db.prepare('SELECT * FROM brief_interests WHERE id = ?').get(info.lastInsertRowid);
  }

  if (!interest) {
    // Nothing to update (e.g. "less" on a non-existent interest — no-op)
    _recordFeedback(db, subscriberId, tokenId, action, bucket, label, contextDate);
    return { applied: false, interestId: null, newWeight: null };
  }

  let newWeight = interest.weight;
  let newExclusion = interest.is_exclusion;

  switch (action) {
    case 'more':
      newWeight = round2(clamp(interest.weight + WEIGHT_STEP, WEIGHT_MIN, WEIGHT_MAX));
      newExclusion = 0;  // un-mute if previously muted
      break;
    case 'less':
      // Floor at 0.5 — keeps topic alive but soft; use mute to silence entirely
      newWeight = round2(clamp(interest.weight - WEIGHT_STEP, 0.5, WEIGHT_MAX));
      break;
    case 'mute':
      newWeight = 0.0;
      newExclusion = 1;
      break;
    case 'unmute':
      newWeight = WEIGHT_DEFAULT;
      newExclusion = 0;
      break;
  }

  db.prepare(`
    UPDATE brief_interests
    SET weight = ?, is_exclusion = ?, updated_at = ?
    WHERE id = ?
  `).run(newWeight, newExclusion, nowMs(), interest.id);

  // Bump profile version
  db.prepare(`
    UPDATE brief_profiles
    SET version = version + 1, updated_at = ?
    WHERE subscriber_id = ?
  `).run(nowMs(), subscriberId);

  _recordFeedback(db, subscriberId, tokenId, action, bucket, label, contextDate);

  return { applied: true, interestId: interest.id, newWeight };
}

function _recordFeedback(db, subscriberId, tokenId, action, bucket, label, contextDate) {
  db.prepare(`
    INSERT INTO brief_feedback
      (subscriber_id, token_id, action, context_bucket, context_label, context_date, applied_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?)
  `).run(
    subscriberId,
    tokenId || null,
    action,
    bucket || null,
    label  || null,
    contextDate || null,
    nowMs(),
  );
}

// ─── Weight decay ─────────────────────────────────────────────────────────────

/**
 * Run weight decay for a single subscriber.
 * Called by the Sunday 23:00 ET weekly cron (implemented in PR 4).
 *
 * Decay rules applied in order:
 *   1. Soft cap: if weight > 1.5 AND no "more" click in 14 days → set to 1.5
 *   2. Weekly pull: weight += (1.0 - weight) * 0.1  (10% toward neutral 1.0)
 *      - skips muted interests (weight = 0.0)
 *      - skips interests with a "more" click in the last 14 days
 *
 * @param {object} db
 * @param {number} subscriberId
 * @returns {number} count of interests updated
 */
function decayWeights(db, subscriberId) {
  const fourteenDaysAgoMs = nowMs() - 14 * 24 * 60 * 60 * 1000;

  const interests = db.prepare(`
    SELECT * FROM brief_interests
    WHERE subscriber_id = ? AND is_exclusion = 0 AND weight > 0
  `).all(subscriberId);

  const updateStmt = db.prepare(`
    UPDATE brief_interests SET weight = ?, updated_at = ? WHERE id = ?
  `);

  let updated = 0;

  const txn = db.transaction(() => {
    for (const interest of interests) {
      // Check for recent "more" click on this bucket/subtopic
      const recentMore = db.prepare(`
        SELECT 1 FROM brief_feedback
        WHERE subscriber_id = ?
          AND action = 'more'
          AND context_bucket = ?
          AND applied_at > ?
        LIMIT 1
      `).get(subscriberId, interest.bucket, fourteenDaysAgoMs);

      let w = interest.weight;

      // Rule 1: soft cap — weight drifted above 1.5 without recent reinforcement
      if (w > 1.5 && !recentMore) {
        w = 1.5;
      }

      // Rule 2: weekly pull toward 1.0 (skip if user just clicked "more")
      if (!recentMore) {
        w = round2(w + (1.0 - w) * 0.1);
      }

      // Enforce bounds (never push muted interests up via decay)
      w = round2(clamp(w, WEIGHT_MIN, WEIGHT_MAX));

      if (w !== interest.weight) {
        updateStmt.run(w, nowMs(), interest.id);
        updated++;
      }
    }
  });

  txn();
  return updated;
}

/**
 * Decay weights for ALL subscribers (called by Sunday cron).
 * Returns map of { subscriberId → count of interests updated }
 */
function decayAllWeights(db) {
  const subscribers = db.prepare(`
    SELECT DISTINCT subscriber_id FROM brief_interests WHERE is_exclusion = 0 AND weight > 0
  `).all();

  const results = {};
  for (const { subscriber_id } of subscribers) {
    results[subscriber_id] = decayWeights(db, subscriber_id);
  }
  return results;
}

// ─── Seed initial interests from onboarding ───────────────────────────────────

/**
 * Seed brief_interests for a new subscriber from wizard/Sam onboarding answers.
 * Called once during wizard completion.
 *
 * Interests seeded with:
 *   source      = "sam_onboarding_seed"
 *   confidence  = "medium"
 *   weight      = 1.0 (normal — user feedback overrides over time)
 *
 * @param {object} db
 * @param {number} subscriberId
 * @param {Array}  interests  - [{ bucket, subtopic, specificity, entities }]
 *   Provided by Sam's analysis of the wizard + Meet Sam answers.
 *   Caller is responsible for deduplication.
 */
function seedInterests(db, subscriberId, interests) {
  if (!Array.isArray(interests) || interests.length === 0) return;

  // Ensure profile row exists
  const profileExists = db.prepare(
    'SELECT 1 FROM brief_profiles WHERE subscriber_id = ?'
  ).get(subscriberId);
  if (!profileExists) {
    const now = nowMs();
    db.prepare(`
      INSERT OR IGNORE INTO brief_profiles (subscriber_id, version, created_at, updated_at)
      VALUES (?, 1, ?, ?)
    `).run(subscriberId, now, now);
  }

  const insertInterest = db.prepare(`
    INSERT OR IGNORE INTO brief_interests
      (subscriber_id, bucket, subtopic, specificity, weight, depth,
       is_exclusion, source, confidence, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, 1.0, 'standard', 0, 'sam_onboarding_seed', 'medium', ?, ?)
  `);

  const insertEntity = db.prepare(`
    INSERT INTO brief_entities
      (interest_id, entity_type, entity_value, weight, created_at)
    VALUES (?, ?, ?, 1.0, ?)
  `);

  const txn = db.transaction(() => {
    const now = nowMs();
    for (const interest of interests) {
      const info = insertInterest.run(
        subscriberId,
        interest.bucket,
        interest.subtopic || null,
        interest.specificity || null,
        now,
        now,
      );
      const interestId = info.lastInsertRowid;
      if (interestId && Array.isArray(interest.entities)) {
        for (const entity of interest.entities) {
          insertEntity.run(interestId, entity.type || 'topic', entity.value, now);
        }
      }
    }
  });

  txn();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  applyFeedback,
  decayWeights,
  decayAllWeights,
  seedInterests,
  WEIGHT_MIN,
  WEIGHT_MAX,
  WEIGHT_DEFAULT,
  WEIGHT_STEP,
};
