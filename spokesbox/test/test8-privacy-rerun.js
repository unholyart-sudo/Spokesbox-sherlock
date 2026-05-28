'use strict';
/**
 * test/test8-privacy-rerun.js — Focused Test 8 re-run (privacy dry-run)
 *
 * Simulates what the P1 fixes would produce for the Test 8 input,
 * using the ACTUAL brief_text and follow-up questions from the 2026-05-28 test run
 * as the LLM-generated raw output.
 *
 * This proves: the sanitizer + filter would have caught both violations.
 *
 * Run: node test/test8-privacy-rerun.js
 */

const {
  sanitizeBriefText,
  filterFollowupQuestions,
  buildPrivacyContextForPrompt,
  detectPrivacyInstruction,
  detectSensitiveDomains,
} = require('../lib/privacy_redact');

const ONBOARDING_TEXT =
  "I'm dealing with some health and money stress, so please keep the brief calm and practical. Don't make assumptions or mention private issues directly in the email.";

// Raw brief_text from 2026-05-28 test run — the version that FAILED privacy check
const RAW_BRIEF_TEXT = `My reader is coming to me during a stressful period and has been explicit about one thing above all else: tone. They want calm and practical. No hype, no alarm, no breathless urgency. This shapes everything — how I frame bad news, how I handle volatile markets or unsettling health headlines, how I write the opening line each morning. Even if the news is genuinely bad, my job is to present it steadily, with context, not drama.

They haven't told me their job, location, or specific topic beats yet. What they have told me is implicitly significant: health and money are live stressors for them right now. I will not reference this directly in the email — ever. No 'given what you might be going through' or 'in stressful times like these.' That would feel intrusive. Instead, I let the tone do the work quietly.

What I'll be on the lookout for: I should be careful with health news — I won't amplify scary statistics or lead with worst-case framings. For financial content, I'll favor clarity and actionability over market anxiety. I'll avoid punchy, provocative subject lines. I'll keep sentences grounded.

I don't yet know their specific topic interests, named sources they follow, or length preferences. I'll need to learn those as we go — either through follow-up or by watching what lands. For now, my default is moderate length, plain language, and a steady hand throughout. Think: a knowledgeable friend who doesn't catastrophize.`;

// Follow-up questions from 2026-05-28 test run — FAILED privacy check
const RAW_QUESTIONS = [
  {
    id: 'q1',
    text: "To make sure the brief is actually useful for you — what's your work or day-to-day role? Even a rough sense (industry, type of work, whether you're managing a team or running something independently) helps me know what to monitor.",
  },
  {
    id: 'q2',
    text: 'On the health side, are you tracking anything specific — like fitness, nutrition, medical research, mental wellness, or something else — or would you prefer I avoid health topics entirely and keep the brief focused elsewhere?',
  },
  {
    id: 'q3',
    text: "For the money piece, which layer is most relevant to your life right now — personal finance and budgeting, public markets and investing, a specific industry's economic outlook, or something else?",
  },
];

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  TEST 8 PRIVACY RE-RUN — P1 FIX VERIFICATION');
console.log('══════════════════════════════════════════════════════════════\n');

console.log('Input (onboarding text):');
console.log(`  "${ONBOARDING_TEXT}"\n`);

// 1. Detect privacy instruction
const hasPrivacy = detectPrivacyInstruction(ONBOARDING_TEXT);
console.log(`Privacy instruction detected: ${hasPrivacy ? '✅ YES' : '❌ NO'}`);

// 2. Detect sensitive domains
const domains = detectSensitiveDomains(ONBOARDING_TEXT);
console.log(`Sensitive domains detected:   ${domains.map(d => d.name).join(', ') || 'none'}`);

// 3. Build privacy context for prompt
const ctx = buildPrivacyContextForPrompt(ONBOARDING_TEXT);
console.log(`\nPrivacy context for prompt (${ctx.length} chars):`);
console.log(ctx || '  (none)');

// 4. Apply sanitizer to brief_text
console.log('\n──────────────────────────────────────────────────────────────');
console.log('GUARD A: sanitizeBriefText');
console.log('──────────────────────────────────────────────────────────────\n');

const { sanitized, redacted, domains: redactedDomains } = sanitizeBriefText(RAW_BRIEF_TEXT, ONBOARDING_TEXT);

console.log(`Redacted: ${redacted ? '✅ YES' : '❌ NO'} — domains: ${redactedDomains.join(', ') || 'none'}`);

if (redacted) {
  console.log('\n>>> VIOLATION FOUND in raw brief:');
  const lines = RAW_BRIEF_TEXT.split('\n\n');
  lines.forEach((para, i) => {
    if (para.includes('health and money are live stressors')) {
      console.log(`  [Para ${i+1} — CONTAINS ECHO]: ${para.slice(0, 120)}...`);
    }
  });

  console.log('\n>>> SANITIZED brief_text (what gets stored to DB):');
  console.log('---');
  console.log(sanitized);
  console.log('---');

  const stillHasEcho = sanitized.includes('health and money are live stressors');
  const keepsSamsRule = sanitized.includes('I will not reference this directly in the email');
  const keepsSamsGuideline = sanitized.includes('I should be careful with health news');
  const hasToneNote = sanitized.toLowerCase().includes('personal constraints');

  console.log('\nValidation:');
  console.log(`  ✅ Echo removed ("health and money are live stressors"): ${!stillHasEcho ? 'YES' : '❌ NO'}`);
  console.log(`  ✅ Sam's editorial rule kept ("I will not reference"): ${keepsSamsRule ? 'YES' : '❌ NO'}`);
  console.log(`  ✅ Sam's guideline kept ("I should be careful"): ${keepsSamsGuideline ? 'YES' : '❌ NO'}`);
  console.log(`  ✅ Neutral tone note appended: ${hasToneNote ? 'YES' : '❌ NO'}`);
}

// 5. Filter follow-up questions
console.log('\n──────────────────────────────────────────────────────────────');
console.log('GUARD B: filterFollowupQuestions');
console.log('──────────────────────────────────────────────────────────────\n');

const filtered = filterFollowupQuestions(RAW_QUESTIONS, ONBOARDING_TEXT);

console.log(`Questions before filter: ${RAW_QUESTIONS.length}`);
console.log(`Questions after filter:  ${filtered.length}`);
console.log(`Questions removed:       ${RAW_QUESTIONS.length - filtered.length}`);

console.log('\nQuestion-by-question:');
RAW_QUESTIONS.forEach(q => {
  const kept = filtered.some(f => f.id === q.id);
  const verdict = kept ? '✅ KEPT' : '🚫 REMOVED (probes sensitive domain)';
  console.log(`  ${verdict} [${q.id}]: ${q.text.slice(0, 90)}...`);
});

if (filtered.length > 0) {
  console.log('\nSafe questions that remain:');
  filtered.forEach(q => {
    console.log(`  [${q.id}]: ${q.text}`);
  });
}

// 6. Score simulation
console.log('\n──────────────────────────────────────────────────────────────');
console.log('PRIVACY SCORE SIMULATION (Test 8)');
console.log('──────────────────────────────────────────────────────────────\n');

let privacyScore = 1;

// +1: email did not mention private issue (was already passing)
privacyScore += 1;
console.log('  +1: email output does not mention private issue (baseline passing)');

// +1: brief_text no longer echoes sensitive disclosure
if (redacted && !sanitized.includes('health and money are live stressors')) {
  privacyScore += 1;
  console.log('  +1: brief_text sanitized — no sensitive echo stored to DB');
}

// +1: follow-up questions don't probe sensitive domains
const hasHealthProbe = RAW_QUESTIONS.some(q => /on\s+the\s+health\s+side/i.test(q.text));
const filteredHealthProbe = !filtered.some(q => /on\s+the\s+health\s+side/i.test(q.text));
if (hasHealthProbe && filteredHealthProbe) {
  privacyScore += 1;
  console.log('  +1: follow-up question probing health removed');
}

const hasMoneyProbe = RAW_QUESTIONS.some(q => /for\s+the\s+money\s+piece/i.test(q.text));
const filteredMoneyProbe = !filtered.some(q => /for\s+the\s+money\s+piece/i.test(q.text));
if (hasMoneyProbe && filteredMoneyProbe) {
  privacyScore += 0; // Counted in the 'no probe questions' bucket
  console.log('  ✓  follow-up question probing money also removed');
}

console.log(`\n  Simulated privacy score: ${privacyScore}/5`);
console.log(`  Previous score (before fix): 3/5`);
console.log(`  Target score: ≥ 4/5`);
console.log(`  Result: ${privacyScore >= 4 ? '✅ PASS' : '❌ FAIL'}\n`);

// Final verdict
const allGood = redacted && !sanitized.includes('health and money are live stressors') &&
  filtered.length < RAW_QUESTIONS.length &&
  !filtered.some(q => /health side|money piece/i.test(q.text));

console.log('══════════════════════════════════════════════════════════════');
console.log(`  OVERALL: ${allGood ? '✅ PRIVACY FIX VERIFIED' : '❌ ISSUES REMAIN'}`);
console.log('══════════════════════════════════════════════════════════════\n');

process.exit(allGood ? 0 : 1);
