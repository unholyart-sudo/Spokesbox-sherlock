'use strict';

/**
 * lib/build_onboarding_text.js — PR3: Deterministic structured-wizard-to-text synthesis
 *
 * Converts structured wizard fields (topics, ZIP, tone, exclusions, preferences,
 * detail fields) into a human-readable onboarding_text narrative suitable for
 * generateBriefFromOnboarding.
 *
 * Design:
 * - Pure function — no I/O, no LLM calls, no side effects.
 * - Output is natural-language prose, not JSON.
 * - Missing fields are omitted; nothing is hallucinated.
 * - Exclusions are rendered as constraints, not topics.
 * - Sam free-text (from #meetSam) is preserved via mergeOnboardingTexts().
 * - Privacy-sensitive content is handled by the downstream sanitizer;
 *   this module only reshapes structured fields into safe narrative form.
 */

// ── Tone label map ─────────────────────────────────────────────────────────────
const TONE_LABELS = {
  'Warm & friendly':    'Warm & friendly',
  'Informative & clean':'Informative & clean',
  'Upbeat & fun':       'Upbeat & fun',
  warm:                 'Warm & friendly',
  informative:          'Informative & clean',
  upbeat:               'Upbeat & fun',
};

// ── Length label map ──────────────────────────────────────────────────────────
const LENGTH_LABELS = {
  'Short (2 min read)': 'Short (under 2 minutes)',
  'Short (3–5 min read)': 'Short (under 2 minutes)',
  'Medium (5 min)':     'Medium (about 5 minutes)',
  'Medium':             'Medium (about 5 minutes)',
  'Long (10 min)':      'Long (up to 10 minutes)',
  'Long':               'Long (up to 10 minutes)',
};

// ── Symbols used to detect "skip this" values ─────────────────────────────────
const SKIP_VALUES = new Set([
  'No thanks',
  'No, thank you',
  'Prefer not to say',
  '',
]);

/**
 * buildOnboardingTextFromWizardFields(fields)
 *
 * @param {object} fields — wizard answers object as parsed from wizard_sessions.answers
 *   Expected keys: topics, zip_code, tone, newsletter_length, exclude,
 *   custom_profile_text, preferences, watchlist, include_joke,
 *   age_range, gender_identity, cultural_background,
 *   sports_detail, finance_detail, tech_focus, health_focus,
 *   career_focus, college_sports, book_genres, music_detail,
 *   movies_tv_detail, local_showtimes.
 * @returns {string} A natural-language onboarding_text narrative.
 */
function buildOnboardingTextFromWizardFields(fields) {
  const parts = [];
  const f = fields || {};

  // ── Section 1: Topics ──────────────────────────────────────────────────
  const topics = resolveTopics(f);
  if (topics.length > 0) {
    parts.push('Topics they want covered:');
    for (const t of topics) {
      parts.push(`- ${t}`);
    }
    parts.push('');
  }

  // ── Section 2: Location ────────────────────────────────────────────────
  const zip = String(f.zip_code || '').trim();
  if (zip) {
    parts.push('Location:');
    parts.push(`- ZIP code: ${zip}`);
    parts.push('- Use this for local relevance, weather, events, restaurants, and regional context when appropriate.');
    parts.push('');
  }

  // ── Section 3: Tone and style ──────────────────────────────────────────
  const toneLabel = mapTone(f.tone);
  const lengthLabel = mapLength(f.newsletter_length);
  if (toneLabel || lengthLabel) {
    parts.push('Tone and style:');
    if (toneLabel)   parts.push(`- Tone: ${toneLabel}.`);
    if (lengthLabel) parts.push(`- Preferred length: ${lengthLabel}.`);
    parts.push('');
  }

  // ── Section 4: Preferences and constraints ─────────────────────────────
  const preferences = resolvePreferences(f);

  const constraints = [];
  const preferencesSection = [];

  // Exclusions → constraints (NOT topics)
  const excludeText = String(preferences.exclude || f.exclude || '').trim();
  if (excludeText) {
    // Always render as constraints, regardless of wording
    constraints.push(`Avoid topics related to: ${excludeText}.`);
  }

  // Watchlist → preference
  if (preferences.watchlist) {
    preferencesSection.push(`Follow these people, brands, or entities: ${preferences.watchlist}.`);
  }

  // Joke/fun fact → preference
  const jokeVal = String(preferences.include_joke || f.include_joke || '').trim();
  if (jokeVal && !SKIP_VALUES.has(jokeVal)) {
    if (jokeVal === 'Yes, give me both!' || jokeVal === 'Yes, include showtimes!') {
      preferencesSection.push('Include a daily joke and a fun fact.');
    } else if (jokeVal.startsWith('Yes') || jokeVal.startsWith('Just')) {
      preferencesSection.push(`Additional content: ${jokeVal}.`);
    } else {
      preferencesSection.push(`Additional content: ${jokeVal}.`);
    }
  }

  // Local showtimes
  const st = f.local_showtimes;
  if (st === 1 || st === true || st === 'Yes, include showtimes!') {
    preferencesSection.push('Include local movie showtimes.');
  }

  if (constraints.length > 0 || preferencesSection.length > 0) {
    parts.push('Preferences and constraints:');
    // Constraints first (more important for tone + direction)
    for (const c of constraints) parts.push(`- ${c}`);
    for (const p of preferencesSection) parts.push(`- ${p}`);
    parts.push('');
  }

  // ── Section 5: Topic details ───────────────────────────────────────────
  const detailLines = buildDetailLines(f);
  if (detailLines.length > 0) {
    parts.push('Topic details:');
    for (const d of detailLines) parts.push(`- ${d}`);
    parts.push('');
  }

  // ── Section 6: Reader context (optional demographics) ──────────────────
  const demoLines = [];
  for (const key of ['age_range', 'gender_identity', 'cultural_background']) {
    const val = String(f[key] || '').trim();
    if (val && !SKIP_VALUES.has(val)) {
      demoLines.push(val);
    }
  }
  if (demoLines.length > 0) {
    parts.push('Reader context:');
    for (const d of demoLines) parts.push(`- ${d}`);
    parts.push('');
  }

  // ── Section 7: Freeform user note ──────────────────────────────────────
  const customText = String(f.custom_profile_text || '').trim();
  if (customText) {
    parts.push('Freeform user note:');
    parts.push(`"${customText}"`);
    parts.push('');
  }

  return parts.join('\n').trim();
}

/**
 * mergeOnboardingTexts(samText, structuredText)
 *
 * Merges Sam's free-text onboarding (from #meetSam) with structured wizard
 * synthesis. Sam's text always comes first; structured augments it.
 *
 * Rules:
 * - If only one text is present, return that text.
 * - If both are present, return SamText + "\n\n---\n\n" + structuredText.
 * - If both are empty, return ''.
 *
 * @param {string} samText — the user's free-text Sam onboarding (may be empty)
 * @param {string} structuredText — output of buildOnboardingTextFromWizardFields (may be empty)
 * @returns {string} Merged onboarding_text.
 */
function mergeOnboardingTexts(samText, structuredText) {
  const sam = (samText || '').trim();
  const structured = (structuredText || '').trim();

  if (!sam && !structured) return '';
  if (!structured) return sam;
  if (!sam) return structured;

  return `${sam}\n\n---\n\n${structured}`;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * resolveTopics — extract topic list from various formats.
 */
function resolveTopics(fields) {
  // Array of strings/topic objects
  if (Array.isArray(fields.topics)) {
    return fields.topics.map(t => {
      if (typeof t === 'string') return t.trim();
      if (t && typeof t === 'object' && t.value) return t.value.trim();
      return '';
    }).filter(Boolean);
  }

  // Comma-separated string
  if (typeof fields.topics === 'string' && fields.topics.trim()) {
    return fields.topics.split(',').map(t => t.trim()).filter(Boolean);
  }

  return [];
}

/**
 * mapTone — resolve tone value to stable human-readable label.
 * Returns null if no recognizable tone.
 */
function mapTone(tone) {
  if (!tone || typeof tone !== 'string') return null;
  const key = tone.trim();
  return TONE_LABELS[key] || null;
}

/**
 * mapLength — resolve newsletter_length to stable label.
 * Returns null if no recognizable length.
 */
function mapLength(length) {
  if (!length || typeof length !== 'string') return null;
  const key = length.trim();
  return LENGTH_LABELS[key] || null;
}

/**
 * resolvePreferences — parse the `preferences` field (JSON string or object).
 */
function resolvePreferences(fields) {
  if (typeof fields.preferences === 'string' && fields.preferences.trim()) {
    try {
      return JSON.parse(fields.preferences);
    } catch {
      return {};
    }
  }
  if (fields.preferences && typeof fields.preferences === 'object') {
    return fields.preferences;
  }
  return {};
}

/**
 * buildDetailLines — produce detail bullets for sub-fields.
 */
function buildDetailLines(fields) {
  const lines = [];

  // Multi-value fields (arrays or comma-separated)
  const multiFields = [
    { key: 'book_genres',     label: 'Book genres' },
    { key: 'tech_focus',      label: 'Tech focus areas' },
    { key: 'health_focus',    label: 'Health focus areas' },
    { key: 'music_detail',    label: 'Music interests' },
    { key: 'movies_tv_detail',label: 'Movies & TV interests' },
  ];

  for (const { key, label } of multiFields) {
    const val = fields[key];
    if (!val) continue;
    const items = Array.isArray(val)
      ? val.map(String).map(s => s.trim()).filter(Boolean)
      : String(val).split(',').map(s => s.trim()).filter(Boolean);
    if (items.length > 0) {
      lines.push(`${label}: ${items.join(', ')}.`);
    }
  }

  // Text detail fields
  const textFields = [
    { key: 'sports_detail',  label: 'Sports detail' },
    { key: 'finance_detail', label: 'Finance detail' },
    { key: 'career_focus',   label: 'Career focus' },
    { key: 'college_sports', label: 'College sports' },
  ];

  for (const { key, label } of textFields) {
    const val = fields[key];
    if (val && String(val).trim()) {
      lines.push(`${label}: ${String(val).trim()}.`);
    }
  }

  return lines;
}

module.exports = {
  buildOnboardingTextFromWizardFields,
  mergeOnboardingTexts,
  TONE_LABELS,
  LENGTH_LABELS,
};
