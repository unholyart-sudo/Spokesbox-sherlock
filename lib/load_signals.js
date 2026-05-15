'use strict';

/**
 * loadSignals — read enrichment signals for a wizard session from the DB.
 *
 * @param {string} session_id
 * @param {object} db         - better-sqlite3 database instance (caller's db)
 * @param {object} [answers]  - optional: wizard answers object (to check _inferred_topics)
 * @returns {{ entities: object, engagement: object, source: string, pending: boolean }}
 *   source: 'brightdata' | 'inferred_fallback' | 'none'
 *   pending: true if enrichment is still in progress for this session
 */
function loadSignals(session_id, db, answers = null) {
  const SOCIAL_MIN_CONFIDENCE = parseFloat(process.env.SOCIAL_MIN_CONFIDENCE || '0.70');

  // Default result
  let entities   = {};
  let engagement = {};
  let source     = 'none';
  let pending    = false;

  // Check for pending enrichment jobs
  try {
    const pendingRow = db.prepare(
      "SELECT COUNT(*) as n FROM social_profile_sources WHERE session_id=? AND status IN ('queued','processing')"
    ).get(session_id);
    pending = (pendingRow && pendingRow.n > 0);
  } catch (_) {
    // social_profile_sources may not exist in test environments — treat as not pending
    pending = false;
  }

  // Try to load rollup from DB
  let rollup = null;
  try {
    rollup = db.prepare('SELECT * FROM social_insight_rollups WHERE session_id = ?').get(session_id);
  } catch (_) {
    rollup = null;
  }

  if (rollup) {
    // Only trust the rollup if:
    //   - source_provider is 'brightdata'
    //   - confidence >= SOCIAL_MIN_CONFIDENCE
    //   - no error recorded
    const isBrightdata = (rollup.source_provider || 'brightdata') === 'brightdata';
    const hasConfidence = (rollup.confidence || 0) >= SOCIAL_MIN_CONFIDENCE;
    const hasError = !!(rollup.error);

    if (isBrightdata && hasConfidence && !hasError) {
      try { entities   = JSON.parse(rollup.entities_json   || '{}') || {}; } catch (_) { entities   = {}; }
      try { engagement = JSON.parse(rollup.engagement_json || '{}') || {}; } catch (_) { engagement = {}; }
      source = 'brightdata';
    }
  }

  // If no brightdata signal, check for inferred fallback from answers
  if (source === 'none' && answers && Array.isArray(answers._inferred_topics) && answers._inferred_topics.length > 0) {
    source = 'inferred_fallback';
  }

  return { entities, engagement, source, pending };
}

module.exports = { loadSignals };
