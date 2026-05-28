'use strict';
/**
 * lib/privacy_redact.js — Privacy sanitizer for Spokesbox SAM briefs.
 *
 * Prevents sensitive self-disclosures from being echoed verbatim in
 * user_briefs.brief_text, and prevents follow-up questions from probing
 * explicitly private/excluded domains.
 *
 * Two guards (P1 fixes from text-input-quality-test-2026-05-28):
 *   A. sanitizeBriefText(briefText, onboardingText)
 *      → redacts sensitive reader-fact echoes before DB save
 *   B. filterFollowupQuestions(questions, onboardingText)
 *      → removes questions that probe explicitly private domains
 *
 * Companion helper:
 *   C. buildPrivacyContextForPrompt(onboardingText)
 *      → returns LLM-prompt injection string to reduce echoes at source
 */

// ── Privacy instruction detection ─────────────────────────────────────────
// Phrases that signal the user wants their sensitive disclosure kept private.
const PRIVACY_INSTRUCTION_PATTERNS = [
  /don['']?t\s+(?:mention|reference|include|discuss|bring\s+up)/i,
  /please\s+(?:don['']?t|do\s+not)\s+(?:mention|reference|include|discuss)/i,
  /don['']?t\s+make\s+assumptions?/i,
  /do\s+not\s+make\s+assumptions?/i,
  /no\s+(?:assumptions?|direct\s+mention)/i,
  /keep\s+(?:it\s+)?(?:private|confidential)/i,
  /(?:private|sensitive)\s+(?:issue|matter|topic|detail|information)/i,
  /mention\s+private\s+issues?/i,
  /keep\s+(?:the\s+)?brief\s+(?:calm|private|confidential)/i,
];

// ── Sensitive domain definitions ───────────────────────────────────────────
// Each domain tracks:
//   onboardingKeywords  — how the user discloses this in free text
//   briefEchoPatterns   — sentences in brief_text that state it as a reader fact
//   questionProbePatterns — questions that probe this domain intrusively
const SENSITIVE_DOMAINS = [
  {
    name: 'health',
    label: 'health or medical topics',
    onboardingKeywords: [
      'health stress', 'health issue', 'health problem', 'health concern',
      'health and money', 'money and health',
      'medical', 'illness', 'sick ', 'diagnosis', 'doctor', 'hospital',
      'medication', 'treatment', 'symptoms', 'disease', 'condition', 'surgery',
      'anxiety', 'depression', 'mental health', 'therapy', 'chronic', 'disability',
    ],
    // Sentences that echo health disclosure as a READER FACT (not Sam's editorial rule).
    // Sentences starting with "I " are Sam's own editorial statements — never remove those.
    briefEchoPatterns: [
      /\bhealth\s+(?:and\s+\w+\s+)?(?:are|is)\s+(?:a\s+)?(?:live\s+)?stressors?\b/i,
      /\bhealth\s+(?:stress|issues?|problems?|concerns?)\s+(?:for|of)\s+(?:them|this\s+reader|the\s+reader)\b/i,
      /\bhealth\s+and\s+money\s+are\s+(?:live\s+)?stressors?\b/i,
      /\bthey(?:'re|\s+are)\s+(?:currently\s+)?dealing\s+with\s+.{0,40}\bhealth\b/i,
      /\bhealth\s+(?:is|are)\s+(?:an?\s+)?(?:active|live|current|ongoing)\s+(?:stressor|concern|issue)\b/i,
      /\breader\s+(?:is|has)\s+.{0,30}\bhealth\s+(?:stress|issue|stressor|problem)\b/i,
    ],
    questionProbePatterns: [
      /\bon\s+the\s+health\s+side\b/i,
      /\bfor\s+the\s+health\s+(?:piece|front|aspect)\b/i,
      /\bhealth.{0,40}\b(?:tracking|following|monitoring|dealing\s+with|are\s+you)\b/i,
      /\bhealth\s+(?:side|topics?|area|domain|situation).{0,40}\b(?:specific|track|focus|tell)\b/i,
      /\btell\s+me\s+more.{0,40}\bhealth\b/i,
      /\belaborate.{0,40}\bhealth\b/i,
      /\bwhat.{0,40}\bhealth\s+(?:issue|problem|stressor|concern|situation)\b/i,
      /\bmedical\s+(?:issue|research|topic|concern).{0,40}\b(?:specific|tracking|interested|dealing)\b/i,
      /\bhealth\s+(?:issue|situation|stressor).{0,20}\b(?:fitness|nutrition|mental wellness|longevity)\b/i,
    ],
  },
  {
    name: 'money',
    label: 'financial stress or money problems',
    onboardingKeywords: [
      'money stress', 'financial stress', 'money problem', 'financial problem',
      'money issue', 'financial issue', 'money concern', 'financial concern',
      'money and health', 'health and money',
      'debt ', 'bills ', 'bankruptcy', 'broke ', 'struggling financially',
      'cash flow problem', 'cash flow issue',
    ],
    briefEchoPatterns: [
      /\bmoney\s+(?:and\s+\w+\s+)?(?:are|is)\s+(?:a\s+)?(?:live\s+)?stressors?\b/i,
      /\bfinancial\s+(?:stress|stressors?)\s+(?:for|of)\s+(?:them|this\s+reader|the\s+reader)\b/i,
      /\bmoney\s+(?:stress|stressors?)\s+(?:for|of)\s+(?:them|this\s+reader|the\s+reader)\b/i,
      /\bhealth\s+and\s+money\s+are\s+(?:live\s+)?stressors?\b/i,
      /\bthey(?:'re|\s+are)\s+(?:currently\s+)?dealing\s+with\s+.{0,40}\b(?:financial|money)\s+(?:stress|issue|problem)\b/i,
      /\breader\s+(?:is|has)\s+.{0,30}\b(?:financial|money)\s+(?:stress|issue|stressor|problem)\b/i,
    ],
    questionProbePatterns: [
      /\bon\s+the\s+money\s+(?:side|piece|front)\b/i,
      /\bfor\s+the\s+(?:money|financial)\s+(?:piece|side|front|aspect)\b/i,
      /\bfinancial\s+(?:stress|situation|issue|problem).{0,40}\b(?:dealing|tracking|relevant|layer)\b/i,
      /\bmoney\s+(?:stress|situation|issue|problem).{0,40}\b(?:dealing|tracking|relevant|layer)\b/i,
      /\bwhich\s+(?:layer|aspect|area).{0,50}\b(?:financial|money)\b(?!.*invest)/i,
      /\bwhat.{0,40}\b(?:financial|money)\s+(?:stress|situation|layer|piece|stressor)\b/i,
      /\btell\s+me\s+more.{0,40}\b(?:financial|money)\s+(?:stress|situation|issue|stressor)\b/i,
    ],
  },
  {
    name: 'family_private',
    label: 'family or relationship issues',
    onboardingKeywords: [
      'family stress', 'family issues', 'family problems', 'family crisis',
      'relationship stress', 'relationship issues', 'divorce', 'separation',
      'custody', 'domestic issues',
    ],
    briefEchoPatterns: [
      /\bfamily\s+(?:stress|stressors?)\s+(?:for|of)\s+(?:them|this\s+reader)\b/i,
      /\brelationship\s+(?:stress|stressor|issue|problem)s?\s+(?:for|of)\s+(?:them|this\s+reader)\b/i,
    ],
    questionProbePatterns: [
      /\bwhat.{0,40}\bfamily\s+(?:stress|issue|situation|problem)\b/i,
      /\btell\s+me\s+more.{0,40}\bfamily\s+(?:stress|issue)\b/i,
      /\brelationship\s+(?:stress|issue).{0,40}\b(?:dealing|tracking|elaborate)\b/i,
    ],
  },
  {
    name: 'legal',
    label: 'legal matters',
    onboardingKeywords: [
      'legal issues', 'legal trouble', 'lawsuit', 'attorney', 'lawyer',
      'criminal charges', 'legal problems', 'legal stress',
    ],
    briefEchoPatterns: [
      /\blegal\s+(?:stress|stressor|issue|problem)s?\s+(?:for|of)\s+(?:them|this\s+reader)\b/i,
    ],
    questionProbePatterns: [
      /\blegal\s+(?:issue|trouble|situation|stress).{0,40}\b(?:dealing|tracking|elaborate)\b/i,
    ],
  },
  {
    name: 'mental_health',
    label: 'mental health topics',
    onboardingKeywords: [
      'mental health stress', 'mental health issue', 'panic attacks',
      'stress disorder', 'ptsd', 'burnout', 'overwhelmed',
      'struggling mentally',
    ],
    briefEchoPatterns: [
      /\bmental\s+health\s+(?:stress|stressors?|issue)s?\s+(?:for|of)\s+(?:them|this\s+reader)\b/i,
    ],
    questionProbePatterns: [
      /\bmental\s+health.{0,40}\b(?:dealing|tracking|elaborate|issue|stressor)\b/i,
    ],
  },
];

// ── Core detection functions ───────────────────────────────────────────────

/**
 * detectPrivacyInstruction(text)
 * Returns true if text contains an explicit "don't mention / keep private" signal.
 */
function detectPrivacyInstruction(text) {
  if (!text || typeof text !== 'string') return false;
  return PRIVACY_INSTRUCTION_PATTERNS.some(re => re.test(text));
}

/**
 * detectSensitiveDomains(text)
 * Returns array of domain objects whose keywords appear in text.
 */
function detectSensitiveDomains(text) {
  if (!text || typeof text !== 'string') return [];
  const lower = text.toLowerCase();
  return SENSITIVE_DOMAINS.filter(domain =>
    domain.onboardingKeywords.some(kw => lower.includes(kw.toLowerCase()))
  );
}

// ── Guard A: Brief text sanitizer ─────────────────────────────────────────

/**
 * splitSentences(paragraph)
 * Splits a paragraph into sentences on sentence-boundary+uppercase patterns.
 * Preserves trailing punctuation on each sentence.
 */
function splitSentences(paragraph) {
  // Split at sentence boundaries: '. ', '! ', '? ' followed by a capital letter,
  // quote, or dash (common in brief text).
  const parts = paragraph.split(/(?<=[.!?])\s+(?=[A-Z"'\u2018\u201C\u2014—])/);
  return parts.filter(s => s.trim().length > 0);
}

/**
 * isSensitiveEcho(sentence, echoPatterns)
 * Returns true if the sentence echoes a sensitive disclosure as a reader fact.
 *
 * Sentences starting with "I " are Sam's editorial statements — never remove.
 * (E.g. "I will not reference this directly" = good editorial rule, keep it.)
 */
function isSensitiveEcho(sentence, echoPatterns) {
  const trimmed = sentence.trim();
  // Sam's editorial sentences ("I will...", "I should...", "I'll...") are never echoes.
  if (/^I(?:\s|'|\u2019)/i.test(trimmed)) return false;
  return echoPatterns.some(pattern => pattern.test(trimmed));
}

/**
 * sanitizeBriefText(briefText, onboardingText)
 *
 * If onboardingText contains a privacy instruction AND at least one sensitive
 * domain keyword, removes sentences from briefText that echo those sensitive
 * domains as personal facts about the reader, then appends a neutral tone note.
 *
 * Returns: { sanitized: string, redacted: boolean, domains: string[] }
 *
 * Safe to call with any input — returns { sanitized: briefText, redacted: false }
 * when no privacy instruction or sensitive domain is detected.
 */
function sanitizeBriefText(briefText, onboardingText) {
  if (!briefText || typeof briefText !== 'string') {
    return { sanitized: briefText, redacted: false, domains: [] };
  }

  if (!detectPrivacyInstruction(onboardingText)) {
    return { sanitized: briefText, redacted: false, domains: [] };
  }

  const activeDomains = detectSensitiveDomains(onboardingText);
  if (activeDomains.length === 0) {
    return { sanitized: briefText, redacted: false, domains: [] };
  }

  const allEchoPatterns = activeDomains.flatMap(d => d.briefEchoPatterns);

  // Process paragraph by paragraph
  const paragraphs = briefText.split(/\n\n+/);
  let anyRedacted = false;

  const sanitizedParagraphs = paragraphs.map(para => {
    const sentences = splitSentences(para);
    const kept = sentences.filter(sent => {
      if (isSensitiveEcho(sent, allEchoPatterns)) {
        anyRedacted = true;
        return false;    // drop this sentence
      }
      return true;
    });

    // If all sentences were dropped, return null to remove the whole paragraph
    if (kept.length === 0) return null;

    return kept.join(' ').trim();
  }).filter(p => p !== null && p.length > 0);

  let sanitized = sanitizedParagraphs.join('\n\n');

  if (anyRedacted) {
    // Clean up artefacts from removal
    sanitized = sanitized.replace(/  +/g, ' ').trim();

    // Add a neutral tone/constraint note if not already present
    const toneNote = "Reader has indicated personal constraints — keep tone calm, grounded, and practical. Do not reference personal stressors, make assumptions about the reader's private circumstances, or use emotionally charged framing.";
    if (!sanitized.toLowerCase().includes('personal constraints')) {
      sanitized = sanitized + '\n\n' + toneNote;
    }
  }

  return {
    sanitized,
    redacted: anyRedacted,
    domains: activeDomains.map(d => d.name),
  };
}

// ── Guard B: Follow-up question filter ────────────────────────────────────

/**
 * filterFollowupQuestions(questions, onboardingText)
 *
 * Removes questions that probe explicitly sensitive/private domains.
 * Returns filtered array (may be empty — caller should handle gracefully).
 *
 * questions: array of { id: string, text: string }
 * onboardingText: subscriber's original free-text input
 */
function filterFollowupQuestions(questions, onboardingText) {
  if (!Array.isArray(questions) || questions.length === 0) return questions;
  if (!detectPrivacyInstruction(onboardingText)) return questions;

  const activeDomains = detectSensitiveDomains(onboardingText);
  if (activeDomains.length === 0) return questions;

  const allProbePatterns = activeDomains.flatMap(d => d.questionProbePatterns);
  if (allProbePatterns.length === 0) return questions;

  return questions.filter(q => {
    const text = (q.text || '').trim();
    return !allProbePatterns.some(pattern => pattern.test(text));
  });
}

// ── Guard C: Prompt context builder ───────────────────────────────────────

/**
 * buildPrivacyContextForPrompt(onboardingText)
 *
 * Returns an injection string for LLM prompts that pre-empts sensitive echoes
 * at the source. Returns '' if no privacy instruction is detected.
 *
 * Used for both brief generation and follow-up question prompts.
 */
function buildPrivacyContextForPrompt(onboardingText) {
  if (!detectPrivacyInstruction(onboardingText)) return '';

  const domains = detectSensitiveDomains(onboardingText);
  if (domains.length === 0) return '';

  const labels = domains.map(d => d.label).join(', ');
  return `\n\nPRIVACY OVERRIDE (apply now): This reader explicitly requested privacy. You MUST NOT echo or elaborate on: ${labels}. These were disclosed as background context only — translate them into tone rules ("keep tone calm and practical"), not reader-fact statements ("health and money are live stressors for them"). Do not generate questions about these domains.`;
}

module.exports = {
  detectPrivacyInstruction,
  detectSensitiveDomains,
  sanitizeBriefText,
  filterFollowupQuestions,
  buildPrivacyContextForPrompt,
  // Exported for tests
  SENSITIVE_DOMAINS,
  PRIVACY_INSTRUCTION_PATTERNS,
};
