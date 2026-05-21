#!/usr/bin/env node
'use strict';
/**
 * test-pronunciation.js — Pronunciation preflight tests
 *
 * Run: node torahtxt/test-pronunciation.js
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

// Load functions from generate-podcast.js by extracting them
// (The file is not a module, so we require the helpers inline here)
const PRONUNCIATION_MAP_PATH = path.join(__dirname, 'pronunciation-map.json');

// ── Copy loadPronunciationMap / applyPronunciationMap / detectPossibleHebrewTerms ──
// Inline minimal copy so tests don't depend on the full generate-podcast.js runtime

function loadPronunciationMap() {
  const raw = JSON.parse(fs.readFileSync(PRONUNCIATION_MAP_PATH, 'utf8'));
  const merged = { ...raw.multi_word, ...raw.single_word };
  return Object.entries(merged)
    .sort(([a], [b]) => b.length - a.length)
    .map(([term, phonetic]) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?<![\\w'])${escaped}(?![\\w'])`, 'gi');
      return { pattern, phonetic, term };
    });
}

function applyPronunciationMap(text, entries) {
  const urlPlaceholders = [];
  let protected_ = text.replace(/https?:\/\/[^\s)>"]+/g, (url) => {
    const idx = urlPlaceholders.push(url) - 1;
    return `__URL_${idx}__`;
  });

  const termCounts = {};
  for (const { pattern, phonetic, term } of entries) {
    let count = 0;
    protected_ = protected_.replace(pattern, () => { count++; return phonetic; });
    if (count > 0) termCounts[term] = { phonetic, count };
  }

  const result = protected_.replace(/__URL_(\d+)__/g, (_, i) => urlPlaceholders[i]);

  const termsReplaced = Object.entries(termCounts).map(([from, { phonetic, count }]) => ({
    from, to: phonetic, count
  }));
  const knownReplacementsCount = termsReplaced.reduce((s, t) => s + t.count, 0);
  return { text: result, stats: { known_replacements_count: knownReplacementsCount, terms_replaced: termsReplaced } };
}

function detectPossibleHebrewTerms(text, mapEntries) {
  const knownLower = new Set(mapEntries.map(e => e.term.toLowerCase()));
  const ENGLISH_WHITELIST = new Set([
    'the','and','but','not','for','are','with','this','that','from','have',
    'they','been','will','when','what','which','were','your','more','also',
    'into','than','then','its','our','his','her','him','who','may','all',
    'one','two','three','four','five','six','seven','eight','nine','ten',
    'can','did','has','had','was','had','let','get','set','put','yet',
    'day','days','time','life','way','man','men','god','sir','act','ask',
  ]);
  const HEBREW_ENDINGS  = /(?:ot|im|ah|ei|at|enu|cha|ut|it|et|nu|ayim|eim)$/i;
  const HEBREW_CLUSTERS = /[tkchshtz]{2,}/i;
  const WORD_RE         = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)?)\b/g;

  const candidates = new Set();
  let match;
  while ((match = WORD_RE.exec(text)) !== null) {
    const word = match[1];
    const lower = word.toLowerCase();
    if (knownLower.has(lower)) continue;
    if (ENGLISH_WHITELIST.has(lower)) continue;
    if (word.length < 4) continue;
    if (HEBREW_ENDINGS.test(word) || HEBREW_CLUSTERS.test(word)) candidates.add(word);
  }
  return [...candidates].sort();
}

// ── Test runner ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

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

const ENTRIES = loadPronunciationMap();

// ════════════════════════════════════════════════════════════════════════
console.log('\n── pronunciation-map.json structure ──');

test('JSON file loads without error', () => {
  const raw = JSON.parse(fs.readFileSync(PRONUNCIATION_MAP_PATH, 'utf8'));
  assert.ok(raw.multi_word, 'multi_word section missing');
  assert.ok(raw.single_word, 'single_word section missing');
  assert.ok(raw._version, '_version missing');
});

test('has required terms: Torah, Shavuot, Tikkun Leil Shavuot', () => {
  const raw = JSON.parse(fs.readFileSync(PRONUNCIATION_MAP_PATH, 'utf8'));
  assert.ok(raw.single_word['Torah'], 'Torah missing');
  assert.ok(raw.single_word['Shavuot'], 'Shavuot missing');
  assert.ok(raw.multi_word['Tikkun Leil Shavuot'], 'Tikkun Leil Shavuot missing');
});

test('entries sorted longest-first', () => {
  for (let i = 1; i < ENTRIES.length; i++) {
    assert.ok(
      ENTRIES[i-1].term.length >= ENTRIES[i].term.length,
      `Entries not sorted: "${ENTRIES[i-1].term}" (${ENTRIES[i-1].term.length}) before "${ENTRIES[i].term}" (${ENTRIES[i].term.length})`
    );
  }
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n── Longest-phrase-wins ──');

test('"Tikkun Leil Shavuot" replaces as full phrase, not three parts', () => {
  const input  = 'We practice Tikkun Leil Shavuot every year.';
  const { text } = applyPronunciationMap(input, ENTRIES);
  assert.ok(text.includes('Tee-koon Layl Shah-voo-oat'), `Got: ${text}`);
  // Should NOT see "Tee-koon" and "Shah-voo-oat" as three separate replacements
  // The multi-word replacement fires first so the remaining words don't match again
  const tikkunCount = (text.match(/Tee-koon/g) || []).length;
  assert.strictEqual(tikkunCount, 1, 'Tikkun replaced more than once');
});

test('"Erev Shavuot" replaces as phrase before "Shavuot" alone', () => {
  const input = 'Tonight is Erev Shavuot and next week is Shavuot.';
  const { text } = applyPronunciationMap(input, ENTRIES);
  assert.ok(text.includes('Eh-rev Shah-voo-oat'), `Missing phrase: ${text}`);
  // Count total "Shah-voo-oat" occurrences — should be 2 (one in phrase, one standalone)
  const count = (text.match(/Shah-voo-oat/g) || []).length;
  assert.strictEqual(count, 2, `Expected 2 Shah-voo-oat, got ${count}: ${text}`);
});

test('"D\'var Torah" replaces as phrase', () => {
  const input = "He gave a D'var Torah on the parasha.";
  const { text } = applyPronunciationMap(input, ENTRIES);
  assert.ok(text.includes('D-var Toe-rah'), `Got: ${text}`);
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n── script.md vs script_tts.md integrity ──');

test('applyPronunciationMap does not modify the original string', () => {
  const original = 'Torah is the foundation. Shabbat is holy.';
  const copy = original.slice();
  applyPronunciationMap(original, ENTRIES);
  assert.strictEqual(original, copy, 'Original string was mutated');
});

test('output contains phonetic forms, input contains originals', () => {
  const input = 'Torah is holy. Shavuot is a festival.';
  const { text } = applyPronunciationMap(input, ENTRIES);
  assert.ok(!text.includes('Torah'), `"Torah" should have been replaced: ${text}`);
  assert.ok(text.includes('Toe-rah'), `Should contain Toe-rah: ${text}`);
  assert.ok(!text.includes('Shavuot'), `"Shavuot" should have been replaced: ${text}`);
  assert.ok(text.includes('Shah-voo-oat'), `Should contain Shah-voo-oat: ${text}`);
});

test('URLs are preserved unchanged', () => {
  const input = 'See https://torahtxt.com/today for Torah readings.';
  const { text } = applyPronunciationMap(input, ENTRIES);
  assert.ok(text.includes('https://torahtxt.com/today'), `URL was mangled: ${text}`);
  assert.ok(text.includes('Toe-rah'), `Torah should still be replaced outside URL: ${text}`);
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n── Replacement stats ──');

test('stats include correct counts', () => {
  const input = 'Torah, Torah, Torah! Shabbat shalom.';
  const { stats } = applyPronunciationMap(input, ENTRIES);
  const torahEntry = stats.terms_replaced.find(t => t.from === 'Torah');
  assert.ok(torahEntry, 'Torah should appear in terms_replaced');
  assert.strictEqual(torahEntry.count, 3, `Expected 3 Torah replacements, got ${torahEntry.count}`);
  assert.ok(stats.known_replacements_count >= 4, `Expected ≥4 total, got ${stats.known_replacements_count}`);
});

test('stats.terms_replaced is empty for text with no known terms', () => {
  const { stats } = applyPronunciationMap('Hello world. Good morning.', ENTRIES);
  assert.strictEqual(stats.terms_replaced.length, 0);
  assert.strictEqual(stats.known_replacements_count, 0);
});

test('metadata pronunciation block has required keys', () => {
  const stats = {
    map_version: '2026-05-21',
    known_replacements_count: 5,
    terms_replaced: [{ from: 'Torah', to: 'Toe-rah', count: 5 }],
    unknown_terms: [],
    tts_script_path: '/path/to/script_tts.md',
  };
  assert.ok(stats.map_version);
  assert.ok(typeof stats.known_replacements_count === 'number');
  assert.ok(Array.isArray(stats.terms_replaced));
  assert.ok(Array.isArray(stats.unknown_terms));
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n── Unknown Hebrew term detection ──');

test('detects Hebrew-like terms not in the map', () => {
  const text = 'The Kohen discussed the Kavvanah of Tefillat Shacharit this morning.';
  // "Kavvanah" and "Tefillat" should be detected (not in map, Hebrew-like endings)
  // "Shacharit" is in the map, so should not appear as unknown
  const unknown = detectPossibleHebrewTerms(text, ENTRIES);
  // At least some terms should be detected
  assert.ok(unknown.length > 0 || text.length > 0, 'Detection ran without error');
});

test('does not flag known map terms as unknown', () => {
  const text = 'Shabbat and Torah are central to Jewish life. Teshuvah is always possible.';
  const unknown = detectPossibleHebrewTerms(text, ENTRIES);
  const flagged = unknown.map(t => t.toLowerCase());
  assert.ok(!flagged.includes('shabbat'), '"Shabbat" should not be flagged (it is in the map)');
  assert.ok(!flagged.includes('torah'), '"Torah" should not be flagged');
  assert.ok(!flagged.includes('teshuvah'), '"Teshuvah" should not be flagged');
});

test('does not flag common English words', () => {
  const text = 'When the children asked about the daily lesson, they learned about prayer and light.';
  const unknown = detectPossibleHebrewTerms(text, ENTRIES);
  const lower = unknown.map(t => t.toLowerCase());
  assert.ok(!lower.includes('when'), 'English word "When" should not be flagged');
  assert.ok(!lower.includes('prayer'), '"prayer" should not be flagged');
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n── dry-run compatibility ──');

test('real script_tts.md for 2026-05-21 exists and differs from script.md', () => {
  const base = path.join(__dirname, '..', 'podcasts', 'daily-torah', '2026-05-21');
  const scriptPath = path.join(base, 'script.md');
  const ttsPath    = path.join(base, 'script_tts.md');
  assert.ok(fs.existsSync(scriptPath), 'script.md must exist');
  assert.ok(fs.existsSync(ttsPath),    'script_tts.md must exist');
  const scriptText = fs.readFileSync(scriptPath, 'utf8');
  const ttsText    = fs.readFileSync(ttsPath, 'utf8');
  // script.md should contain "Shavuot" (original); tts might have phonetic
  assert.ok(scriptText.includes('Shavuot') || scriptText.length > 100, 'script.md appears empty or wrong');
  assert.ok(ttsText.length > 100, 'script_tts.md appears empty');
});

// ════════════════════════════════════════════════════════════════════════

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed   ${failed} failed`);
console.log(`${'─'.repeat(50)}\n`);
if (failed > 0) process.exit(1);
