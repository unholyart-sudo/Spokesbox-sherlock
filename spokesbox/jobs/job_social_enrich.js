'use strict';
/**
 * job_social_enrich.js — async social profile enrichment job.
 *
 * This subsystem is DISABLED BY DEFAULT.
 * It will not run unless SOCIAL_ENRICHMENT_ENABLED=true is set in .env
 * AND an approved provider (currently only 'brightdata') is configured.
 *
 * Flow when enabled:
 *   1. Load queued social_profile_sources for session_id
 *   2. Fetch public profile data via the configured approved provider
 *   3. Store raw payload in social_profile_sources.raw_payload_json
 *   4. Normalize across platforms via social_normalize.js
 *   5. Call OpenAI to infer newsletter signals
 *   6. Upsert result to social_insight_rollups
 *
 * Called by the in-process job worker (see job queue in server.js).
 * Do NOT await this from the wizard — it runs async after the step advances.
 */

const https = require('https');
const { normalizeSocialPayloads } = require('../services/social_normalize');

// ── Feature flag — must be explicitly true to enable enrichment ───────────────
// Default is FALSE (safe). Setting SOCIAL_ENRICHMENT_ENABLED to anything other
// than the string 'true' (including absent/undefined) leaves the feature off.
const ENRICHMENT_ON = process.env.SOCIAL_ENRICHMENT_ENABLED === 'true';

const OPENAI_KEY      = process.env.OPENAI_API_KEY || '';
const MIN_CONFIDENCE  = parseFloat(process.env.SOCIAL_MIN_CONFIDENCE  || '0.70');
const TIMEOUT_MS      = parseInt(process.env.SOCIAL_ENRICHMENT_TIMEOUT_MS || '12000', 10);
const MAX_PROFILES    = parseInt(process.env.SOCIAL_MAX_PROFILES      || '3',  10);

// ── Provider selection ────────────────────────────────────────────────────────
// Only 'brightdata' is an approved provider. Data365 is explicitly excluded.
// Adding a new provider requires: (1) approval, (2) an adapter in /providers/,
// (3) adding it to APPROVED_PROVIDERS here.

const APPROVED_PROVIDERS = ['brightdata'];

function getSocialProvider() {
  if (!ENRICHMENT_ON) return null;

  const preferred = process.env.SOCIAL_PROVIDER || 'brightdata';

  if (!APPROVED_PROVIDERS.includes(preferred)) {
    console.warn(`[social_enrich] Provider '${preferred}' is not in the approved list (${APPROVED_PROVIDERS.join(', ')}). Enrichment skipped.`);
    return null;
  }

  try {
    const adapter = require(`../providers/${preferred}_social`);
    if (adapter.isConfigured()) return adapter;
    console.warn(`[social_enrich] Provider '${preferred}' is approved but not configured (missing API key). Enrichment skipped.`);
    return null;
  } catch (e) {
    console.warn(`[social_enrich] Could not load provider adapter '${preferred}': ${e.message}`);
    return null;
  }
}

// ── Main job ──────────────────────────────────────────────────────────────────

async function run({ session_id, db }) {
  // Hard gate — must be explicitly enabled
  if (!ENRICHMENT_ON) {
    console.log(`[social_enrich] SKIPPED (disabled) — session ${session_id}. Set SOCIAL_ENRICHMENT_ENABLED=true to enable.`);
    return { status: 'skipped', reason: 'disabled' };
  }

  // Provider must be approved and configured
  const provider = getSocialProvider();
  if (!provider) {
    console.log(`[social_enrich] SKIPPED (no provider) — session ${session_id}. Configure an approved provider to enable.`);
    return { status: 'skipped', reason: 'no_provider_configured' };
  }

  const sources = db.prepare(
    "SELECT * FROM social_profile_sources WHERE session_id = ? AND status IN ('queued','failed')"
  ).all(session_id);

  if (sources.length === 0) {
    console.log(`[social_enrich] No queued sources for session ${session_id}`);
    return { status: 'skipped', reason: 'no_sources' };
  }

  // Cap profiles processed per session (guards API spend)
  const toProcess = sources.slice(0, MAX_PROFILES);
  if (sources.length > MAX_PROFILES) {
    console.warn(`[social_enrich] Capping to ${MAX_PROFILES} profiles for session ${session_id} (${sources.length} queued)`);
  }

  const records = [];

  for (const src of toProcess) {
    db.prepare("UPDATE social_profile_sources SET status='processing' WHERE id=?").run(src.id);
    try {
      const record = await provider.collectProfileByUrl({
        platform: src.platform,
        url:      src.normalized_url,
      });

      db.prepare(
        "UPDATE social_profile_sources SET status='done', raw_payload_json=?, fetched_at=datetime('now') WHERE id=?"
      ).run(JSON.stringify(record), src.id);

      records.push({ ...record, source_url: src.normalized_url });
    } catch (err) {
      console.error(`[social_enrich] Provider fetch failed for ${src.normalized_url}: ${err.message}`);
      db.prepare("UPDATE social_profile_sources SET status='failed', error=? WHERE id=?")
        .run(err.message, src.id);
    }
  }

  if (records.length === 0) {
    const lastErr = toProcess.map(s => {
      const row = db.prepare("SELECT error FROM social_profile_sources WHERE id=?").get(s.id);
      return row?.error || 'unknown';
    }).find(Boolean) || 'unknown';
    // Loud alert — this means provider is misconfigured or returning errors for all URLs
    console.error(`[social_enrich] ALL SOURCES FAILED for session ${session_id} (${toProcess.length} attempted) — last error: ${lastErr}`);
    return { status: 'error', reason: 'all_sources_failed', last_error: lastErr };
  }

  // Normalize across platforms (semantic pre-trim applied inside normalizeSocialPayloads)
  const normalized = normalizeSocialPayloads(records);
  if (normalized.profiles.length === 0) {
    console.log(`[social_enrich] Normalized payload empty for session ${session_id} — skipping LLM inference`);
    return { status: 'skipped', reason: 'empty_after_normalize' };
  }

  // LLM inference
  try {
    const rollup = await inferNewsletterSignals(normalized);
    upsertRollup(db, session_id, rollup);
    console.log(
      `[social_enrich] Rollup saved for ${session_id} — confidence ${rollup.confidence}, ` +
      `topics: [${rollup.top_topics?.join(', ')}]`
    );
    return { status: 'ok', confidence: rollup.confidence };
  } catch (err) {
    console.error(`[social_enrich] LLM inference failed for ${session_id}: ${err.message}`);
    return { status: 'error', reason: 'llm_inference_failed', error: err.message };
  }
}

// ── LLM inference ─────────────────────────────────────────────────────────────

async function inferNewsletterSignals(normalized) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not set');

  // Semantic pre-trim: cap total text before sending to LLM
  const MAX_TEXT_CHARS = parseInt(process.env.SOCIAL_MAX_TEXT_CHARS || '4000', 10);
  const MAX_POSTS      = parseInt(process.env.SOCIAL_MAX_POSTS_PER_PROFILE || '15', 10);

  const trimmedProfiles = normalized.profiles.map(p => ({
    ...p,
    bio:          trimToChars(p.bio,       800),
    headline:     trimToChars(p.headline,  200),
    recent_posts: p.recent_posts
      .slice(0, MAX_POSTS)
      .map(t => trimToChars(t, 280))      // ~tweet length per post
      .filter(Boolean),
    entities:     p.entities.slice(0, 15),
    locations:    p.locations.slice(0, 5),
    tone_hints:   p.tone_hints,
  }));

  // Enforce total character budget across all profiles
  const trimmedInput = semanticTrimToCharBudget({ profiles: trimmedProfiles }, MAX_TEXT_CHARS);

  const prompt = `You are generating newsletter personalization signals from a user's public social media presence.

Input JSON contains normalized public profile data:
- bios/headlines
- recent posts/captions/comments (trimmed to key signals)
- extracted entities and locations
- platform labels

Return ONLY strict JSON (no commentary) with this exact shape:
{
  "top_topics": [],
  "subtopics": [],
  "locations": [],
  "tone_preference": "",
  "sports_teams": [],
  "finance_interest_level": "low|medium|high",
  "politics_interest_level": "low|medium|high",
  "newsletter_modules": [],
  "confidence": 0.0,
  "evidence": []
}

Rules:
- Use recurring themes only, not one-off mentions.
- Prefer specific interests over broad categories.
- Do not infer protected classes, health conditions, religion, sexuality, or other sensitive traits.
- If evidence is weak, return fewer topics and a lower confidence score (< 0.70).
- Keep evidence snippets short (< 60 chars) and non-sensitive.
- Confidence is 0.0–1.0; only include topics you are confident about.
- When in doubt, return an empty topic list and low confidence rather than guessing.

Input:
${JSON.stringify(trimmedInput)}`;

  const body = JSON.stringify({
    model:           'gpt-4o-mini',
    messages:        [{ role: 'user', content: prompt }],
    max_tokens:      800,
    temperature:     0.2,
    response_format: { type: 'json_object' },
  });

  const raw = await openaiRequest(body);
  const content = raw?.choices?.[0]?.message?.content || '{}';
  let parsed;
  try   { parsed = JSON.parse(content); }
  catch (_) { parsed = {}; }

  return {
    top_topics:              parsed.top_topics              || [],
    subtopics:               parsed.subtopics               || [],
    locations:               parsed.locations               || [],
    tone_preference:         parsed.tone_preference         || '',
    sports_teams:            parsed.sports_teams            || [],
    finance_interest_level:  parsed.finance_interest_level  || 'low',
    politics_interest_level: parsed.politics_interest_level || 'low',
    newsletter_modules:      parsed.newsletter_modules      || [],
    confidence:              typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    evidence:                parsed.evidence                || [],
  };
}

// ── Semantic pre-trim helpers ─────────────────────────────────────────────────

/**
 * Trim a string to a character limit at a word boundary.
 * Prefers ending at a sentence boundary if within 20% of the limit.
 */
function trimToChars(text, limit) {
  if (!text || text.length <= limit) return text || '';
  // Try sentence boundary within final 20%
  const floor = Math.floor(limit * 0.8);
  const slice = text.slice(0, limit);
  const sentenceEnd = slice.search(/[.!?][^.!?]*$/);
  if (sentenceEnd > floor) return slice.slice(0, sentenceEnd + 1).trim();
  // Fall back to word boundary
  const wordEnd = slice.lastIndexOf(' ');
  return wordEnd > floor ? slice.slice(0, wordEnd).trim() : slice.trim();
}

/**
 * Reduce total characters in the normalized payload to stay within a budget.
 * Trims post arrays from the end of each profile proportionally.
 */
function semanticTrimToCharBudget(normalized, maxChars) {
  const json = JSON.stringify(normalized);
  if (json.length <= maxChars) return normalized;

  // Trim posts from each profile until we fit
  const profiles = normalized.profiles.map(p => ({ ...p, recent_posts: [...p.recent_posts] }));
  while (JSON.stringify({ profiles }).length > maxChars) {
    let trimmed = false;
    for (const p of profiles) {
      if (p.recent_posts.length > 2) {
        p.recent_posts.pop();
        trimmed = true;
      }
    }
    if (!trimmed) break; // can't trim further without destroying data
  }
  return { profiles };
}

// ── OpenAI HTTP helper ────────────────────────────────────────────────────────

function openaiRequest(body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${OPENAI_KEY}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try   { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`OpenAI parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error('OpenAI timeout')); });
    req.write(body);
    req.end();
  });
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function upsertRollup(db, session_id, rollup) {
  db.prepare(`INSERT INTO social_insight_rollups
    (session_id, top_topics_json, subtopics_json, locations_json, tone_preference,
     sports_teams_json, finance_interest_level, politics_interest_level,
     newsletter_modules_json, confidence, evidence_json, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET
      top_topics_json=excluded.top_topics_json,
      subtopics_json=excluded.subtopics_json,
      locations_json=excluded.locations_json,
      tone_preference=excluded.tone_preference,
      sports_teams_json=excluded.sports_teams_json,
      finance_interest_level=excluded.finance_interest_level,
      politics_interest_level=excluded.politics_interest_level,
      newsletter_modules_json=excluded.newsletter_modules_json,
      confidence=excluded.confidence,
      evidence_json=excluded.evidence_json,
      updated_at=datetime('now')`
  ).run(
    session_id,
    JSON.stringify(rollup.top_topics),
    JSON.stringify(rollup.subtopics),
    JSON.stringify(rollup.locations),
    rollup.tone_preference,
    JSON.stringify(rollup.sports_teams),
    rollup.finance_interest_level,
    rollup.politics_interest_level,
    JSON.stringify(rollup.newsletter_modules),
    rollup.confidence,
    JSON.stringify(rollup.evidence),
  );
}

// ── Failure rate monitor ─────────────────────────────────────────────────────
// Called hourly by the job worker heartbeat. Alerts if >50% of sources in the
// last 24h have status='failed' — catches silent provider outages early.
function checkFailureRate(db) {
  const window = "datetime('now', '-24 hours')";
  const total  = db.prepare(`SELECT COUNT(*) as n FROM social_profile_sources WHERE created_at >= ${window}`).get()?.n || 0;
  const failed = db.prepare(`SELECT COUNT(*) as n FROM social_profile_sources WHERE status='failed' AND created_at >= ${window}`).get()?.n || 0;
  if (total === 0) return;
  const rate = failed / total;
  if (rate > 0.5) {
    console.error(`[social_enrich] HIGH FAILURE RATE ALERT: ${failed}/${total} sources failed in last 24h (${Math.round(rate*100)}%) — check provider config`);
  } else {
    console.log(`[social_enrich] Failure rate OK: ${failed}/${total} in last 24h (${Math.round(rate*100)}%)`);
  }
}

module.exports = { run, checkFailureRate };
