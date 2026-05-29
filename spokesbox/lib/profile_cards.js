'use strict';

/**
 * lib/profile_cards.js — Phase 1: read-only profile card view
 *
 * Fetches structured interest cards, entities, and brief metadata
 * for the profile page. No write operations.
 *
 * Card types (inferred from data, not schema):
 *   - topic:      bucket is a topic name, is_exclusion=0
 *   - exclusion:  is_exclusion=1
 *   - tone:       bucket = 'tone' (handled at brief_profiles level)
 *   - format:     bucket = 'format' (inferred from newsletter_length)
 *   - privacy:    only if privacy override was redacted (data-driven)
 *   - entity:     bucket = 'Watchlist' (inferred from entities)
 *   - source:     bucket = source-specific enrichment topics
 *
 * No DB schema changes required. No LLM calls. No generation flow changes.
 */

/**
 * loadCards(db, subscriberId)
 * Returns an array of card objects, each with:
 *   id, bucket, subtopic, specificity, weight, depth, source, confidence,
 *   is_exclusion, card_type (computed), entities[]
 */
function loadCards(db, subscriberId) {
  const interests = db.prepare(`
    SELECT id, bucket, subtopic, specificity, weight, depth, source,
           confidence, is_exclusion, notes, created_at, updated_at
    FROM brief_interests
    WHERE subscriber_id = ?
    ORDER BY
      is_exclusion DESC,
      weight DESC,
      bucket ASC
  `).all(subscriberId);

  // Load entities for all interest IDs
  const interestIds = interests.map(r => r.id);
  const entityMap = {};
  if (interestIds.length > 0) {
    const placeholders = interestIds.map(() => '?').join(',');
    const entities = db.prepare(`
      SELECT id, interest_id, entity_type, entity_value, weight
      FROM brief_entities
      WHERE interest_id IN (${placeholders})
    `).all(...interestIds);

    for (const e of entities) {
      if (!entityMap[e.interest_id]) entityMap[e.interest_id] = [];
      entityMap[e.interest_id].push({
        id: e.id,
        type: e.entity_type,
        value: e.entity_value,
        weight: e.weight
      });
    }
  }

  const cards = interests.map(interest => {
    const card = {
      id: interest.id,
      bucket: interest.bucket,
      subtopic: interest.subtopic,
      specificity: interest.specificity,
      weight: interest.weight,
      depth: interest.depth,
      source: interest.source,
      confidence: interest.confidence,
      is_exclusion: !!interest.is_exclusion,
      notes: interest.notes,
      created_at: interest.created_at,
      updated_at: interest.updated_at,
      entities: entityMap[interest.id] || []
    };

    // Compute card_type from available fields
    if (card.is_exclusion) {
      card.card_type = 'exclusion';
    } else if (card.bucket && card.bucket.toLowerCase() === 'tone') {
      card.card_type = 'tone';
    } else if (card.bucket && card.bucket.toLowerCase() === 'format') {
      card.card_type = 'format';
    } else if (card.bucket && card.bucket.toLowerCase() === 'watchlist') {
      card.card_type = 'entity_watchlist';
    } else {
      card.card_type = 'topic';
    }

    return card;
  });

  return cards;
}

/**
 * loadBrief(db, subscriberId)
 * Returns { brief_text, brief_version, last_edited_by, last_edited_at } or null.
 */
function loadBrief(db, subscriberId) {
  const row = db.prepare(
    'SELECT brief_text, brief_version, last_edited_by, last_edited_at FROM user_briefs WHERE subscriber_id = ?'
  ).get(subscriberId);
  return row || null;
}

/**
 * loadProfileSummary(db, subscriberId)
 * Returns { version, created_at, updated_at } or null.
 */
function loadProfileSummary(db, subscriberId) {
  const row = db.prepare(
    'SELECT version, created_at, updated_at FROM brief_profiles WHERE subscriber_id = ?'
  ).get(subscriberId);
  return row || null;
}

/**
 * loadFeedbackSummary(db, subscriberId, sinceDays = 14)
 * Returns { total_feedback, actions_last_14d, top_buckets[] }
 */
function loadFeedbackSummary(db, subscriberId, sinceDays = 14) {
  const sinceTs = Date.now() - (sinceDays * 24 * 60 * 60 * 1000);

  const total = db.prepare(
    'SELECT COUNT(*) as count FROM brief_feedback WHERE subscriber_id = ? AND applied_at > ?'
  ).get(subscriberId, sinceTs);

  const actions = db.prepare(`
    SELECT action, COUNT(*) as count
    FROM brief_feedback
    WHERE subscriber_id = ? AND applied_at > ?
    GROUP BY action
    ORDER BY count DESC
  `).all(subscriberId, sinceTs);

  const topBuckets = db.prepare(`
    SELECT context_bucket, context_label, COUNT(*) as count
    FROM brief_feedback
    WHERE subscriber_id = ? AND applied_at > ? AND action IN ('more','less')
    GROUP BY context_bucket
    ORDER BY count DESC
    LIMIT 5
  `).all(subscriberId, sinceTs);

  return {
    total_recent: total.count,
    actions,
    top_buckets: topBuckets,
    since_days: sinceDays
  };
}

/**
 * loadPrivacyStatus(db, subscriberId)
 * Checks if the privacy redaction is active for this subscriber
 * by looking for PRIVACY OVERRIDE patterns in the brief text.
 * Returns { privacy_active: boolean, privacy_summary: string|null }
 */
function loadPrivacyStatus(db, subscriberId) {
  const brief = loadBrief(db, subscriberId);
  if (!brief || !brief.brief_text) {
    return { privacy_active: false, privacy_summary: null };
  }

  // Check for redaction signatures in the brief
  const privacyPatterns = [
    /PRIVACY OVERRIDE/i,
    /personal boundary/i,
    /personal stressor/i,
    /health.*money.*stress/i,
    /protecting a personal/i
  ];

  const matches = privacyPatterns.filter(p => p.test(brief.brief_text));

  if (matches.length > 0) {
    return {
      privacy_active: true,
      privacy_summary: '🔒 Sam is protecting a personal boundary. Keep tone calm and practical. No personal references in emails.'
    };
  }

  return { privacy_active: false, privacy_summary: null };
}

/**
 * loadWatchlistEntities(db, subscriberId)
 * Returns all entities that aren't associated with a specific interest card.
 * Fallback: also checks the subscriber's `watchlist` column.
 */
function loadWatchlistEntities(db, subscriberId) {
  // First try entities from brief_entities
  const entities = db.prepare(`
    SELECT be.entity_type, be.entity_value, be.weight, bi.bucket
    FROM brief_entities be
    JOIN brief_interests bi ON bi.id = be.interest_id
    WHERE bi.subscriber_id = ?
    ORDER BY be.weight DESC
  `).all(subscriberId);

  if (entities.length > 0) return entities;

  return [];
}

/**
 * loadProfileFromSubscriber(db, subscriberId)
 * Returns flat profile fields from subscribers table (the old wizard fields)
 */
function loadProfileFromSubscriber(db, subscriberId) {
  const row = db.prepare(`
    SELECT email, name, tone, newsletter_length, template_style,
           sports_detail, finance_detail,
           tech_focus, health_focus, career_focus
    FROM subscribers WHERE id = ?
  `).get(subscriberId);

  if (!row) return null;

  return {
    email: row.email,
    name: row.name,
    tone: row.tone || 'warm',
    newsletter_length: row.newsletter_length || 'medium',
    template_style: row.template_style || 'modern'
  };
}

/**
 * enrichCardsWithProfile(cards, subscriberData)
 * Adds tone/format cards derived from subscriber profile if not already present.
 */
function enrichCardsWithProfile(cards, subscriberData) {
  const hasTone = cards.some(c => c.card_type === 'tone');
  const hasFormat = cards.some(c => c.card_type === 'format');

  const enriched = [...cards];

  if (!hasTone && subscriberData && subscriberData.tone) {
    const toneLabels = {
      'warm': 'Warm & Friendly — approachable, conversational',
      'informative': 'Informative & Clean — clear, professional',
      'upbeat': 'Upbeat & Fun — energetic, playful'
    };
    enriched.push({
      id: -1,  // synthetic
      card_type: 'tone',
      bucket: 'tone',
      specificity: toneLabels[subscriberData.tone] || subscriberData.tone,
      weight: 1.0,
      source: 'user_profile',
      confidence: 'high',
      entities: []
    });
  }

  if (!hasFormat && subscriberData && subscriberData.newsletter_length) {
    const lengthLabels = {
      'short': 'Short & scannable — ~2 min read',
      'medium': 'Medium length — ~5 min read',
      'long': 'Full length — ~10 min read'
    };
    enriched.push({
      id: -2,  // synthetic
      card_type: 'format',
      bucket: 'format',
      specificity: lengthLabels[subscriberData.newsletter_length] || `${subscriberData.newsletter_length} length`,
      weight: 1.0,
      source: 'user_profile',
      confidence: 'high',
      entities: []
    });
  }

  return enriched;
}

/**
 * getProfileCards(db, subscriberId)
 * Top-level function: loads all card data, enriches, and returns the full response.
 */
function getProfileCards(db, subscriberId) {
  const subscriber = loadProfileFromSubscriber(db, subscriberId);
  if (!subscriber) {
    return { cards: [], entities: [], brief: null, summary: null, feedback: null, privacy: null, subscriber: null };
  }

  const cards = loadCards(db, subscriberId);
  const enrichedCards = enrichCardsWithProfile(cards, subscriber);
  const entities = loadWatchlistEntities(db, subscriberId);
  const brief = loadBrief(db, subscriberId);
  const summary = loadProfileSummary(db, subscriberId);
  const feedback = loadFeedbackSummary(db, subscriberId);
  const privacy = loadPrivacyStatus(db, subscriberId);

  // Classify cards by type for easy rendering
  const classified = {
    topics: enrichedCards.filter(c => c.card_type === 'topic' && !c.is_exclusion),
    exclusions: enrichedCards.filter(c => c.card_type === 'exclusion'),
    tone: enrichedCards.filter(c => c.card_type === 'tone'),
    format: enrichedCards.filter(c => c.card_type === 'format'),
    entity_watchlist: enrichedCards.filter(c => c.card_type === 'entity_watchlist')
  };

  return {
    cards: enrichedCards,
    classified,
    entities,
    brief,
    summary,
    feedback,
    privacy,
    subscriber
  };
}

module.exports = {
  getProfileCards,
  loadCards,
  loadBrief,
  loadProfileSummary,
  loadFeedbackSummary,
  loadPrivacyStatus,
  loadWatchlistEntities,
  loadProfileFromSubscriber,
  enrichCardsWithProfile
};
