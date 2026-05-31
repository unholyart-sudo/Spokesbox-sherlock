'use strict';

/**
 * test/build_onboarding_text.test.js — Unit tests for lib/build_onboarding_text.js
 *
 * Run: node test/build_onboarding_text.test.js
 *
 * Tests:
 *   1. Full structured input — all sections present
 *   2. Missing optional fields — no hallucination
 *   3. Exclusions as constraints, not topics
 *   4. Tone slider mapping
 *   5. mergeOnboardingTexts — both texts present
 *   6. mergeOnboardingTexts — only Sam text
 *   7. mergeOnboardingTexts — only structured text
 *   8. mergeOnboardingTexts — both empty
 *   9. Freeform-only compatibility
 *  10. Privacy-sensitive input (exclusions as constraints)
 *  11. Empty/all-missing input
 *  12. Multi-select detail fields
 */

const assert = require('assert');
const {
  buildOnboardingTextFromWizardFields,
  mergeOnboardingTexts,
  TONE_LABELS,
  LENGTH_LABELS,
} = require('../lib/build_onboarding_text');

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function fail(name, msg) { failed++; console.log(`  ✗ ${name}: ${msg}`); }
function head(title) { console.log(`\n${title}`); }

// ── Helper: check section presence ─────────────────────────────────────────────
function assertSection(text, sectionLabel) {
  if (!text.includes(sectionLabel)) {
    throw new Error(`Expected section "${sectionLabel}" not found`);
  }
}

function assertNotSection(text, sectionLabel) {
  if (text.includes(sectionLabel)) {
    throw new Error(`Unexpected section "${sectionLabel}" found`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 1: Full structured input
// ══════════════════════════════════════════════════════════════════════════════
head('1. Full structured input');

try {
  const input = {
    topics: ['AI / Machine Learning', 'SpaceX / Space Industry', 'Markets / Economy', 'Israel / Middle East'],
    zip_code: '10701',
    tone: 'Warm & friendly',
    newsletter_length: 'Short (2 min read)',
    exclude: 'sports, celebrity news, generic hype',
    watchlist: '@elonmusk, @techmeme',
    include_joke: 'Yes, give me both!',
    custom_profile_text: 'I read Stratechery, so don\'t recap it — add what it missed.',
    age_range: '35-44',
    gender_identity: 'Prefer not to say',
    cultural_background: '',
  };

  const output = buildOnboardingTextFromWizardFields(input);

  // All sections present
  assertSection(output, 'Topics they want covered');
  assertSection(output, 'Location');
  assertSection(output, 'ZIP code: 10701');
  assertSection(output, 'Tone and style');
  assertSection(output, 'Warm & friendly');
  assertSection(output, 'Preferred length');
  assertSection(output, 'Preferences and constraints');
  assertSection(output, 'Freeform user note');
  assertSection(output, 'I read Stratechery');

  // Exclusions are constraints, NOT topics
  assertSection(output, 'Avoid topics related to');

  // Demographics: age_range present, gender (Prefer not to say) omitted, cultural (empty) omitted
  assertSection(output, 'Reader context');
  assert(output.includes('35-44'), 'age_range should appear');
  assert(!output.includes('Prefer not to say'), 'Prefer not to say should be omitted');
  assert(!output.includes('cultural'), 'empty cultural_background should be omitted');

  // Check exclusions are NOT in topics
  const topicsSection = output.substring(0, output.indexOf('Tone and style'));
  assert(!topicsSection.includes('sports'), 'exclusions should not appear in topics section');
  assert(!topicsSection.includes('celebrity'), 'exclusions should not appear in topics section');

  ok('All sections present with correct content');
} catch (e) {
  fail('Full structured input', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 2: Missing optional fields
// ══════════════════════════════════════════════════════════════════════════════
head('2. Missing optional fields');

try {
  const input = {
    topics: ['Technology', 'History'],
    tone: 'Informative & clean',
  };

  const output = buildOnboardingTextFromWizardFields(input);

  assertSection(output, 'Topics they want covered');
  assertSection(output, 'Tone and style');

  // Should NOT contain these sections
  assertNotSection(output, 'Location');
  assertNotSection(output, 'Preferences and constraints');
  assertNotSection(output, 'Freeform user note');
  assertNotSection(output, 'Reader context');

  ok('Missing fields omitted without hallucination');
} catch (e) {
  fail('Missing optional fields', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 3: Exclusions as constraints
// ══════════════════════════════════════════════════════════════════════════════
head('3. Exclusions as constraints');

try {
  const input = {
    topics: ['Sports', 'Finance'],
    exclude: 'no sports, no celebrity news',
  };

  const output = buildOnboardingTextFromWizardFields(input);

  // Topics section should have "Sports" as a topic
  const topicsSection = output.substring(0, output.indexOf('Preferences'));
  assert(topicsSection.includes('Sports'), 'Sports should be a topic');
  assert(topicsSection.includes('Finance'), 'Finance should be a topic');

  // Exclusions section — "no sports" rendered as constraint
  const constraintsSection = output.substring(output.indexOf('Preferences'));
  assert(constraintsSection.includes('Avoid topics related to:'), 'exclusion rendered as constraint');
  assert(constraintsSection.includes('no sports'), 'exclusion text included in constraint');
  assert(constraintsSection.includes('no celebrity news'), 'exclusion text included in constraint');

  ok('Exclusions rendered as constraints, not topics');
} catch (e) {
  fail('Exclusions as constraints', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 4: Tone slider mapping
// ══════════════════════════════════════════════════════════════════════════════
head('4. Tone slider mapping');

try {
  // Test all tone values
  const toneTests = [
    { value: 'Warm & friendly', expected: 'Warm & friendly' },
    { value: 'Informative & clean', expected: 'Informative & clean' },
    { value: 'Upbeat & fun', expected: 'Upbeat & fun' },
    { value: 'warm', expected: 'Warm & friendly' },
    { value: 'informative', expected: 'Informative & clean' },
    { value: 'upbeat', expected: 'Upbeat & fun' },
    { value: 'unknown_tone', expected: null },
    { value: '', expected: null },
    { value: null, expected: null },
  ];

  for (const tt of toneTests) {
    const output = buildOnboardingTextFromWizardFields({ tone: tt.value, topics: ['Test'] });
    if (tt.expected === null) {
      assert(!output.includes('Tone:'), `no tone for value "${tt.value}"`);
    } else {
      assert(output.includes(`Tone: ${tt.expected}.`), `tone value "${tt.value}" maps to "${tt.expected}"`);
    }
  }

  ok('All tone values map to stable labels');
} catch (e) {
  fail('Tone slider mapping', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 5: mergeOnboardingTexts — both texts
// ══════════════════════════════════════════════════════════════════════════════
head('5. mergeOnboardingTexts — both texts');

try {
  const samText = 'I read a lot about AI and am interested in how it affects the job market.';
  const structuredText = 'Topics they want covered:\n- AI / Machine Learning\n\nTone and style:\n- Tone: Informative & clean.';

  const merged = mergeOnboardingTexts(samText, structuredText);

  assert(merged.includes(samText), 'Sam text preserved');
  assert(merged.includes(structuredText), 'Structured text preserved');
  assert(merged.includes('---'), 'Separator present');
  assert(merged.indexOf(samText) < merged.indexOf('---'), 'Sam text comes first');

  ok('Both texts merged with separator');
} catch (e) {
  fail('mergeOnboardingTexts — both texts', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 6: mergeOnboardingTexts — only Sam text
// ══════════════════════════════════════════════════════════════════════════════
head('6. mergeOnboardingTexts — only Sam text');

try {
  const samText = 'I read Stratechery and want smart analysis.';
  const merged = mergeOnboardingTexts(samText, '');

  assert.strictEqual(merged, samText, 'Only Sam text returned as-is');
  assert(!merged.includes('---'), 'No separator when only one text');

  ok('Sam-only text returned unchanged');
} catch (e) {
  fail('mergeOnboardingTexts — only Sam text', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 7: mergeOnboardingTexts — only structured text
// ══════════════════════════════════════════════════════════════════════════════
head('7. mergeOnboardingTexts — only structured text');

try {
  const structuredText = 'Topics they want covered:\n- Technology';
  const merged = mergeOnboardingTexts('', structuredText);

  assert.strictEqual(merged, structuredText, 'Only structured text returned as-is');
  assert(!merged.includes('---'), 'No separator when only one text');

  ok('Structured-only text returned unchanged');
} catch (e) {
  fail('mergeOnboardingTexts — only structured text', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 8: mergeOnboardingTexts — both empty
// ══════════════════════════════════════════════════════════════════════════════
head('8. mergeOnboardingTexts — both empty');

try {
  const merged = mergeOnboardingTexts('', '');

  assert.strictEqual(merged, '', 'Empty input returns empty output');
  assert(!merged.includes('---'), 'No separator when both empty');

  const merged2 = mergeOnboardingTexts('  ', '  ');
  assert.strictEqual(merged2, '', 'Whitespace-only input returns empty output');

  ok('Empty inputs produce empty output');
} catch (e) {
  fail('mergeOnboardingTexts — both empty', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 9: Freeform-only compatibility
// ══════════════════════════════════════════════════════════════════════════════
head('9. Freeform-only compatibility');

try {
  const input = {
    custom_profile_text: 'I love technology and space exploration. Keep it concise.',
  };

  const output = buildOnboardingTextFromWizardFields(input);

  // Should produce the freeform user note section
  assertSection(output, 'Freeform user note');
  assert(output.includes('I love technology and space exploration'), 'freeform text preserved verbatim');

  // Should NOT invent other sections
  assertNotSection(output, 'Topics they want covered');
  assertNotSection(output, 'Location');
  assertNotSection(output, 'Tone and style');
  assertNotSection(output, 'Preferences and constraints');
  assertNotSection(output, 'Reader context');

  ok('Freeform-only input preserved without invented sections');
} catch (e) {
  fail('Freeform-only compatibility', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 10: Privacy-sensitive input (exclusions as constraints)
// ══════════════════════════════════════════════════════════════════════════════
head('10. Privacy-sensitive input');

try {
  const input = {
    topics: ['Technology', 'Finance'],
    exclude: "don't mention health or money stress",
    custom_profile_text: 'I have health issues and money stress but keep it off the newsletter.',
  };

  const output = buildOnboardingTextFromWizardFields(input);

  // Exclusions section — the sensitive text is rendered as a constraint
  assertSection(output, 'Avoid topics related to');
  assert(output.includes("don't mention health or money stress"), 'exclusion text included but ONLY as constraint');

  // The exclusion text should ONLY appear in the constraints section, not as a topic
  const topicsSection = output.substring(0, output.indexOf('Preferences'));
  assert(!topicsSection.includes('health'), 'health not in topics (only in constraints)');
  assert(!topicsSection.includes('money stress'), 'money stress not in topics (only in constraints)');

  // The freeform text is preserved verbatim (downstream sanitizer handles redaction)
  assertSection(output, 'Freeform user note');
  assert(output.includes('I have health issues'), 'freeform text preserved (sanitizer handles downstream)');

  ok('Sensitive exclusions rendered as constraints; freeform preserved for downstream sanitizer');
} catch (e) {
  fail('Privacy-sensitive input', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 11: Empty/all-missing input
// ══════════════════════════════════════════════════════════════════════════════
head('11. Empty/all-missing input');

try {
  const output = buildOnboardingTextFromWizardFields({});

  assert.strictEqual(output, '', 'Empty object produces empty string');

  const output2 = buildOnboardingTextFromWizardFields(null);
  assert.strictEqual(output2, '', 'null produces empty string');

  const output3 = buildOnboardingTextFromWizardFields(undefined);
  assert.strictEqual(output3, '', 'undefined produces empty string');

  ok('All empty/missing inputs produce empty string');
} catch (e) {
  fail('Empty/all-missing input', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 12: Multi-select detail fields
// ══════════════════════════════════════════════════════════════════════════════
head('12. Multi-select detail fields');

try {
  const input = {
    topics: ['Technology'],
    tech_focus: ['AI / ML', 'Space Tech', 'Cybersecurity'],
    book_genres: ['Sci-Fi', 'History', 'Biography'],
    sports_detail: 'Follows NFL and college basketball',
    local_showtimes: 'Yes, include showtimes!',
  };

  const output = buildOnboardingTextFromWizardFields(input);

  assertSection(output, 'Topic details');
  assert(output.includes('Tech focus areas: AI / ML, Space Tech, Cybersecurity.'), 'tech_focus multi-select rendered');
  assert(output.includes('Book genres: Sci-Fi, History, Biography.'), 'book_genres multi-select rendered');
  assert(output.includes('Sports detail: Follows NFL and college basketball.'), 'sports_detail text rendered');
  assert(output.includes('Include local movie showtimes.'), 'local_showtimes rendered');

  ok('Multi-select and text detail fields rendered correctly');
} catch (e) {
  fail('Multi-select detail fields', e.message);
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(50)}`);
const total = passed + failed;
if (failed === 0) {
  console.log(`\n✅ ALL ${total} TESTS PASSED\n`);
} else {
  console.log(`\n❌ ${failed}/${total} TESTS FAILED\n`);
}
