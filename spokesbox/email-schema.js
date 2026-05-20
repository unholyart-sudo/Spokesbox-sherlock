'use strict';
/**
 * Spokesbox LLM Output Schema Validator — v1.0.0
 * The LLM must return structured JSON matching this schema.
 * The renderer (email-builder.js) ONLY accepts validated JSON — never raw HTML.
 */

const REQUIRED_SECTION_IDS = ['lead']; // at minimum one section with id='lead'

function validateSection(s, idx) {
  const errors = [];
  if (!s || typeof s !== 'object')   { return [`sections[${idx}] is not an object`]; }
  if (!s.id)                         errors.push(`sections[${idx}].id missing`);
  if (!s.title)                      errors.push(`sections[${idx}].title missing`);
  if (!s.emoji)                      errors.push(`sections[${idx}].emoji missing`);
  if (typeof s.summary !== 'string') errors.push(`sections[${idx}].summary must be string`);
  if (!Array.isArray(s.bullets))     errors.push(`sections[${idx}].bullets must be array`);
  if (s.links && !Array.isArray(s.links)) errors.push(`sections[${idx}].links must be array`);
  return errors;
}

/**
 * Validate raw LLM output JSON.
 * Returns { valid, errors, sanitized? }
 */
function validateBriefJSON(raw) {
  const errors = [];

  // Must be an object
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['LLM output must be a JSON object'] };
  }

  if (typeof raw.greeting !== 'string' || !raw.greeting.trim())
    errors.push('greeting missing or empty');

  if (!Array.isArray(raw.sections) || raw.sections.length === 0)
    errors.push('sections[] missing or empty');
  else
    raw.sections.forEach((s, i) => errors.push(...validateSection(s, i)));

  if (typeof raw.closing !== 'string')
    errors.push('closing missing or not a string');

  // Check for free-form HTML injection
  const asStr = JSON.stringify(raw);
  if (/<[a-z][^>]*>/i.test(asStr)) {
    errors.push('LLM output contains raw HTML tags — structured JSON only, no markup');
  }

  // Check required sections
  const ids = (raw.sections||[]).map(s => s.id);
  for (const req of REQUIRED_SECTION_IDS) {
    if (!ids.includes(req)) errors.push(`Required section id '${req}' missing`);
  }

  if (errors.length > 0) return { valid: false, errors };

  // Sanitize: strip any accidental HTML, truncate over-long fields
  const sanitized = {
    greeting: raw.greeting.trim().slice(0, 120),
    sections: raw.sections.map(s => ({
      id:      s.id,
      title:   String(s.title).replace(/<[^>]+>/g,'').slice(0, 100),
      emoji:   String(s.emoji).slice(0, 10),
      summary: String(s.summary||'').replace(/<[^>]+>/g,'').slice(0, 300),
      bullets: (s.bullets||[]).map(b => String(b).replace(/<[^>]+>/g,'').slice(0, 300)),
      links:   (s.links||[]).map(l => ({
        text: String(l.text||'').replace(/<[^>]+>/g,'').slice(0, 100),
        url:  String(l.url||'').slice(0, 500),
      })).filter(l => l.url.startsWith('http')),
    })),
    closing: String(raw.closing||'').replace(/<[^>]+>/g,'').slice(0, 300),
  };

  return { valid: true, errors: [], sanitized };
}

/**
 * Parse LLM response string into validated JSON.
 * Handles ```json fences, stray whitespace, etc.
 */
function parseLLMResponse(responseStr) {
  if (!responseStr) return { valid: false, errors: ['Empty LLM response'] };
  let str = responseStr.trim();
  // Strip code fences
  str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(str);
  } catch (e) {
    return { valid: false, errors: [`JSON parse failed: ${e.message}`] };
  }
  return validateBriefJSON(parsed);
}

module.exports = { validateBriefJSON, parseLLMResponse, validateSection };
