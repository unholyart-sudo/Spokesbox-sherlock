'use strict';
/**
 * lib/brief_llm.js — LLM-powered user brief generation and updates.
 * PR 2/3: LLM brief generation. No UI changes, no wizard changes.
 *
 * Provider: Anthropic Claude (claude-sonnet-4-6 default).
 * Override model via ANTHROPIC_MODEL env var.
 * No OPENAI_API_KEY dependency in this file.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getBrief, saveBrief } = require('./user_brief');
const { BRIEF_GENERATION_PROMPT, BRIEF_UPDATE_PROMPT, FOLLOWUP_QUESTIONS_PROMPT } = require('./brief_prompts');
const { sanitizeBriefText, filterFollowupQuestions, buildPrivacyContextForPrompt } = require('./privacy_redact');

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const TEMP          = 0.4;

// Test hook — set in test environments to avoid real API calls.
// Generalized name: _setLLMOverride (was _setOpenAIOverride in v1).
let _llmOverride = null;
function _setLLMOverride(fn) { _llmOverride = fn; }

// ── Anthropic call ─────────────────────────────────────────────────────────────

async function callLLM(systemPrompt, messages) {
  if (_llmOverride) return _llmOverride(systemPrompt, messages);

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    temperature: TEMP,
    system: systemPrompt,
    messages,
  });

  return response;
}

// ── Response validation ────────────────────────────────────────────────────────

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function extractContent(response) {
  // Anthropic: response.content is an array of blocks; find the first text block.
  if (Array.isArray(response?.content)) {
    const block = response.content.find(b => b.type === 'text');
    return block?.text || null;
  }
  return null;
}

function validateBriefResponse(response) {
  const content = extractContent(response);
  if (!content) return { ok: false, reason: 'empty response', rawContent: null };

  // Claude sometimes wraps JSON in markdown fences — strip them.
  const cleaned = content.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed;
  try { parsed = JSON.parse(cleaned); } catch { return { ok: false, reason: 'invalid JSON', rawContent: content }; }

  if (typeof parsed.brief_text !== 'string' || !parsed.brief_text.trim()) {
    return { ok: false, reason: 'missing brief_text', rawContent: content };
  }
  if (typeof parsed.edit_reason !== 'string') {
    return { ok: false, reason: 'missing edit_reason', rawContent: content };
  }
  const words = countWords(parsed.brief_text);
  if (words < 50) return { ok: false, reason: `brief_text too short (${words} words, min 50)`, rawContent: content };
  // 600-word cap enforced by saveBrief for clean error messages.
  if (parsed.edit_reason.length > 200) {
    return { ok: false, reason: 'edit_reason too long (>200 chars)', rawContent: content };
  }

  return { ok: true, brief_text: parsed.brief_text.trim(), edit_reason: parsed.edit_reason.trim() };
}

// ── LLM call with one retry ────────────────────────────────────────────────────

async function callWithRetry(systemPrompt, messages, fnName, subscriberId) {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const t0  = Date.now();
  const raw = await callLLM(systemPrompt, messages);
  const usage = raw?.usage || {};
  console.log(`[brief_llm] ${fnName} subscriberId=${subscriberId} attempt=1 model=${model} input_tokens=${usage.input_tokens ?? '?'} output_tokens=${usage.output_tokens ?? '?'} latency_ms=${Date.now() - t0}`);

  const result = validateBriefResponse(raw);
  if (result.ok) return result;

  // Retry with stricter suffix.
  console.log(`[brief_llm] ${fnName} subscriberId=${subscriberId} attempt=1 validation_fail="${result.reason}" — retrying`);
  const retryMessages = [
    ...messages,
    { role: 'assistant', content: result.rawContent || '' },
    { role: 'user',      content: 'Your last response was invalid JSON or wrong shape. Return ONLY {"brief_text":"…","edit_reason":"…"}' },
  ];

  const t1   = Date.now();
  const raw2 = await callLLM(systemPrompt, retryMessages);
  const usage2 = raw2?.usage || {};
  console.log(`[brief_llm] ${fnName} subscriberId=${subscriberId} attempt=2 model=${model} input_tokens=${usage2.input_tokens ?? '?'} output_tokens=${usage2.output_tokens ?? '?'} latency_ms=${Date.now() - t1}`);

  const result2 = validateBriefResponse(raw2);
  if (result2.ok) return result2;

  throw new Error(`[brief_llm] ${fnName}: LLM returned invalid response on both attempts. Last failure: ${result2.reason}`);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * generateBriefFromOnboarding({ subscriberId, onboardingText, clarifierText, db })
 * Builds a new brief from the subscriber's onboarding text.
 * Saves to DB with editedBy='llm'.
 * Returns { brief_text, brief_version, edit_reason }.
 */
async function generateBriefFromOnboarding({ subscriberId, onboardingText, clarifierText = null, db }) {
  const userContent = clarifierText
    ? `${onboardingText}\n\nAdditional context: ${clarifierText}`
    : onboardingText;

  const messages = [{ role: 'user', content: userContent }];

  // Inject privacy context into system prompt (Guard C — reduces echoes at source)
  const privacyContext = buildPrivacyContextForPrompt(onboardingText);
  const systemPrompt = BRIEF_GENERATION_PROMPT.replace('[PRIVACY_CONTEXT]', privacyContext);

  const { brief_text: rawBriefText, edit_reason } = await callWithRetry(
    systemPrompt, messages, 'generateBriefFromOnboarding', subscriberId
  );

  // Apply privacy sanitizer before DB storage (Guard A — defense-in-depth)
  const { sanitized: brief_text, redacted, domains } = sanitizeBriefText(rawBriefText, onboardingText);
  if (redacted) {
    console.log(`[brief_llm] generateBriefFromOnboarding subscriberId=${subscriberId} privacy_redacted=true domains=${domains.join(',')}`);
  }

  const saved = saveBrief(db, { subscriberId, briefText: brief_text, editedBy: 'llm', editReason: edit_reason });
  return { brief_text: saved.brief_text, brief_version: saved.brief_version, edit_reason };
}

/**
 * updateBriefFromReply({ subscriberId, replyText, db })
 * Updates existing brief based on a reader reply.
 * Saves to DB with editedBy='llm'.
 * Returns { brief_text, brief_version, edit_reason }.
 */
async function updateBriefFromReply({ subscriberId, replyText, db }) {
  const current = getBrief(db, subscriberId);
  if (!current) {
    throw new Error('no existing brief to update — use generateBriefFromOnboarding first');
  }

  const systemPrompt = BRIEF_UPDATE_PROMPT
    .replace('[CURRENT_BRIEF]', current.brief_text)
    .replace('[REPLY_TEXT]', replyText);

  const messages = [{ role: 'user', content: replyText }];

  const { brief_text, edit_reason } = await callWithRetry(
    systemPrompt, messages, 'updateBriefFromReply', subscriberId
  );

  const saved = saveBrief(db, { subscriberId, briefText: brief_text, editedBy: 'llm', editReason: edit_reason });
  return { brief_text: saved.brief_text, brief_version: saved.brief_version, edit_reason };
}

// ── Follow-up question generation ───────────────────────────────────────────────
// Generates 2–4 concise, domain-specific follow-up questions based on the
// subscriber's initial onboarding text. Returns a validated array of
// { id, text } objects. Throws on LLM failure or malformed response;
// callers should handle errors and fall back to { questions: [] }.
async function generateFollowupQuestions(onboardingText) {
  // Inject privacy context into prompt (Guard C — reduces probe questions at source)
  const privacyContext = buildPrivacyContextForPrompt(onboardingText);
  const systemPrompt = FOLLOWUP_QUESTIONS_PROMPT
    .replace('[PRIVACY_CONTEXT]', privacyContext)
    .replace('[ONBOARDING_TEXT]', onboardingText);

  const messages = [{ role: 'user', content: 'Generate follow-up questions now.' }];

  const response = await callLLM(systemPrompt, messages);
  const content  = extractContent(response);
  if (!content) throw new Error('[followup] empty LLM response');

  // Strip markdown fences if present
  const cleaned = content.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch { throw new Error('[followup] invalid JSON: ' + cleaned.slice(0, 100)); }

  if (!Array.isArray(parsed.questions)) {
    throw new Error('[followup] questions field is not an array');
  }

  // Validate each item and cap at 4
  const valid = parsed.questions
    .filter(q => q && typeof q.id === 'string' && typeof q.text === 'string' && q.text.trim().length > 0)
    .slice(0, 4);

  if (valid.length < 2) {
    throw new Error(`[followup] too few valid questions: ${valid.length}`);
  }

  // Apply privacy filter (Guard B — defense-in-depth for probe questions)
  const filtered = filterFollowupQuestions(valid, onboardingText);
  if (filtered.length < valid.length) {
    console.log(`[brief_llm] generateFollowupQuestions privacy_filtered=${valid.length - filtered.length} questions removed`);
  }

  return filtered;
}

module.exports = {
  generateBriefFromOnboarding,
  updateBriefFromReply,
  generateFollowupQuestions,
  _setLLMOverride,
  // Legacy alias so existing tests that import _setOpenAIOverride still work.
  _setOpenAIOverride: _setLLMOverride,
};
