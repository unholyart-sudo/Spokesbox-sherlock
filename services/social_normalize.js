'use strict';
/**
 * social_normalize.js — cross-platform normalization layer.
 * Converts raw provider responses into a consistent schema before LLM inference.
 * Called by job_social_enrich.js.
 */

/**
 * Normalize an array of raw provider records into a unified input shape.
 * @param {Array} records — each has { platform, profile, posts, comments, source_meta }
 * @returns {{ profiles: Array }}
 */
function normalizeSocialPayloads(records) {
  return {
    profiles: records
      .filter(r => r && r.profile)
      .map(r => ({
        platform:     r.platform,
        url:          r.profile.url || '',
        bio:          cleanText(extractBio(r)),
        headline:     cleanText(extractHeadline(r)),
        recent_posts: extractRecentPosts(r).slice(0, 15).map(cleanText),
        entities:     extractEntities(r),
        locations:    extractLocations(r),
        tone_hints:   extractToneHints(r),
      }))
      .filter(p => p.bio || p.headline || p.recent_posts.length > 0),
  };
}

// ── Extractors ────────────────────────────────────────────────────────────────

function extractBio(r) {
  return r.profile?.bio || r.profile?.description || r.profile?.summary || '';
}

function extractHeadline(r) {
  return r.profile?.headline || r.profile?.title || r.profile?.job_title || '';
}

function extractRecentPosts(r) {
  const posts    = (r.posts    || []).map(p => p.text || '');
  const comments = (r.comments || []).map(c => c.text || '');
  return [...posts, ...comments].filter(Boolean);
}

function extractEntities(r) {
  // Combine all text and extract capitalized multi-word phrases as entity hints
  const allText = [
    extractBio(r),
    extractHeadline(r),
    ...extractRecentPosts(r),
  ].join(' ');

  const entities = new Set();
  // Match capitalized 1–3 word phrases (org names, brands, etc.)
  const matches = allText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || [];
  const stopWords = new Set(['The','And','But','For','With','From','This','That','Here','When','Where','What','How']);
  matches.forEach(m => {
    if (!stopWords.has(m) && m.length > 3) entities.add(m);
  });
  return Array.from(entities).slice(0, 20);
}

function extractLocations(r) {
  const locs = new Set();
  if (r.profile?.location) locs.add(r.profile.location);
  // City/state patterns in bio
  const bioText = extractBio(r);
  const locMatch = bioText.match(/\b([A-Z][a-z]+(?:,?\s+[A-Z]{2})?)\b/g) || [];
  locMatch.forEach(l => { if (l.length > 3 && l.length < 40) locs.add(l); });
  return Array.from(locs).slice(0, 5);
}

function extractToneHints(r) {
  const allText = extractRecentPosts(r).join(' ').toLowerCase();
  const hints = [];
  if ((allText.match(/\b(lol|haha|😂|😄|joke|funny|humor)\b/g) || []).length >= 2) hints.push('humorous');
  if ((allText.match(/\b(data|research|analysis|study|report|according)\b/g) || []).length >= 2) hints.push('analytical');
  if ((allText.match(/\b(excited|amazing|love|great|incredible|awesome)\b/g) || []).length >= 3) hints.push('upbeat');
  if ((allText.match(/\b(therefore|however|moreover|furthermore|consequently)\b/g) || []).length >= 2) hints.push('formal');
  return hints;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

/**
 * Clean and semantically trim a text fragment.
 * Strips URLs, normalizes whitespace, then trims to `limit` chars
 * at the nearest sentence or word boundary — not a raw character slice.
 *
 * @param {string} text
 * @param {number} [limit=500] — soft character ceiling
 */
function cleanText(text, limit = 500) {
  if (!text) return '';
  const cleaned = text
    .replace(/https?:\/\/\S+/g, '')       // strip URLs
    .replace(/[^\x20-\x7E\n]/g, ' ')       // strip non-ASCII
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= limit) return cleaned;

  // Prefer trimming at a sentence boundary within the final 20% of the limit
  const floor = Math.floor(limit * 0.8);
  const slice = cleaned.slice(0, limit);
  const sentenceEnd = slice.search(/[.!?][^.!?]*$/);
  if (sentenceEnd > floor) return slice.slice(0, sentenceEnd + 1).trim();

  // Fall back to word boundary
  const wordEnd = slice.lastIndexOf(' ');
  return (wordEnd > floor ? slice.slice(0, wordEnd) : slice).trim();
}

module.exports = { normalizeSocialPayloads };
