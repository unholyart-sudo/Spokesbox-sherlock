'use strict';
/**
 * Spokesbox Email Builder — v1.0.0
 * Canonical module per EMAIL_OUTPUT_STANDARD.md
 *
 * The LLM produces structured JSON (validated by email-schema.js).
 * This module renders that JSON into a FIXED HTML shell — the LLM never writes HTML.
 *
 * Exports:
 *   buildSpokesboxEmailHTML(brief, subscriber)    → HTML string
 *   buildSpokesboxEmailText(brief, subscriber)    → plain-text string
 *   buildSpokesboxEmailPayload(brief, subscriber) → { subject, preheader, html, text, metadata }
 */

const { parseLLMResponse, validateBriefJSON } = require('./email-schema');

const TEMPLATE_VERSION = '1.0.0';
const PROJECT          = 'spokesbox';
const FROM_EMAIL       = 'jared@jaredgreen.com';
const FROM_NAME        = 'Spokesbox';
const REPLY_TO         = 'sherlock.claw@gmail.com';
const BASE_URL         = 'https://spokesbox.com';
const PREHEADER        = "Your personalized brief: the stories and signals Sam is watching for you today.";

// ─── Subject ────────────────────────────────────────────────────────────────

function buildSubject({ name, date }) {
  const firstName = (name || '').split(' ')[0] || '';
  const dateShort = date || new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York',
  });
  return firstName
    ? `📬 ${firstName}, your Spokesbox Brief — ${dateShort}`
    : `📬 Your Spokesbox Brief — ${dateShort}`;
}

// ─── HTML Renderers ─────────────────────────────────────────────────────────

function renderSectionHTML(section) {
  const bullets = (section.bullets || [])
    .map(b => `<li style="margin-bottom:6px;color:#2d3748;line-height:1.6;">${b}</li>`)
    .join('');
  const links = (section.links || [])
    .map(l => `<a href="${l.url}" style="color:#667eea;font-size:12px;display:inline-block;margin-right:12px;margin-top:4px;">→ ${l.text}</a>`)
    .join('');

  return `
    <div style="padding:16px 32px;border-bottom:1px solid #e2e8f0;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;
                  color:#667eea;font-weight:bold;margin-bottom:6px;">
        ${section.emoji} ${section.title}
      </div>
      ${section.summary
        ? `<p style="font-size:14px;color:#4a5568;line-height:1.6;margin:0 0 8px 0;">${section.summary}</p>`
        : ''}
      ${bullets
        ? `<ul style="padding-left:18px;margin:6px 0;">${bullets}</ul>`
        : ''}
      ${links ? `<div style="margin-top:6px;">${links}</div>` : ''}
    </div>`;
}

function buildSpokesboxEmailHTML(brief, subscriber) {
  const { email = '', token = '', name = '' } = subscriber || {};
  const unsubLink = `${BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  });
  const subject = buildSubject({ name, date });

  const sectionsHTML = (brief.sections || []).map(renderSectionHTML).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Spokesbox Brief</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Georgia,serif;">

  <!-- Preheader (hidden) -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#f0f4f8;">
    ${PREHEADER}
  </span>

  <div style="max-width:600px;margin:0 auto;background:#fff;">

    <!-- Header -->
    <div style="background:#1a2744;padding:24px 32px;text-align:center;">
      <div style="color:#fff;font-size:26px;font-weight:bold;letter-spacing:2px;">📬 SPOKESBOX</div>
      <div style="color:#a0aec0;font-size:12px;margin-top:4px;">Your personalized daily brief</div>
    </div>

    <!-- Greeting -->
    <div style="padding:24px 32px 8px;">
      <p style="font-size:18px;color:#1a2744;margin:0;">
        ${brief.greeting}${name ? `, <strong>${name.split(' ')[0]}</strong>` : ''}! ☀️
      </p>
      <p style="font-size:13px;color:#718096;margin:4px 0 0;">${date} · Your personalized brief is ready</p>
    </div>

    <!-- Sections -->
    ${sectionsHTML}

    <!-- Closing -->
    ${brief.closing
      ? `<div style="padding:16px 32px;"><p style="font-size:14px;color:#4a5568;font-style:italic;margin:0;">${brief.closing}</p></div>`
      : ''}

    <!-- Footer -->
    <div style="background:#f7fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="font-size:11px;color:#a0aec0;margin:0;">
        You're receiving this because you signed up at spokesbox.com
      </p>
      <p style="font-size:11px;color:#a0aec0;margin:4px 0 0;">
        <a href="${unsubLink}" style="color:#667eea;">Unsubscribe</a>
        &nbsp;·&nbsp;
        <a href="${BASE_URL}" style="color:#667eea;">spokesbox.com</a>
      </p>
    </div>

  </div>
</body>
</html>`;
}

// ─── Plain-text ─────────────────────────────────────────────────────────────

function buildSpokesboxEmailText(brief, subscriber) {
  const { email = '', token = '', name = '' } = subscriber || {};
  const unsubLink = `${BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  });
  const firstName = (name || '').split(' ')[0] || '';
  const hr = '-'.repeat(50);

  const sections = (brief.sections || []).map(s => [
    `${s.emoji} ${s.title.toUpperCase()}`,
    hr,
    s.summary || '',
    ...(s.bullets || []).map(b => `  • ${b}`),
    ...(s.links  || []).map(l => `  → ${l.text}: ${l.url}`),
    '',
  ].join('\n')).join('\n');

  return [
    `📬 SPOKESBOX — ${date}`,
    '='.repeat(50),
    '',
    `${brief.greeting}${firstName ? `, ${firstName}` : ''}!`,
    '',
    sections,
    brief.closing || '',
    '',
    hr,
    `Website: ${BASE_URL}`,
    `Unsubscribe: ${unsubLink}`,
    '© Spokesbox · Your personalized daily brief',
  ].join('\n');
}

// ─── Payload Builder ────────────────────────────────────────────────────────

/**
 * Primary entry point.
 * @param {object|string} briefOrRaw - validated brief object OR raw LLM response string
 * @param {object} subscriber        - { email, name, token, ... }
 * @param {object} [opts]            - { sourceDate, date }
 */
function buildSpokesboxEmailPayload(briefOrRaw, subscriber, opts = {}) {
  let brief;

  if (typeof briefOrRaw === 'string') {
    const result = parseLLMResponse(briefOrRaw);
    if (!result.valid) {
      throw new Error(`Spokesbox LLM output invalid:\n  ${result.errors.join('\n  ')}`);
    }
    brief = result.sanitized;
  } else {
    const result = validateBriefJSON(briefOrRaw);
    if (!result.valid) {
      throw new Error(`Spokesbox brief invalid:\n  ${result.errors.join('\n  ')}`);
    }
    brief = result.sanitized;
  }

  const date    = opts.date || new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  });
  const subject = buildSubject({ name: subscriber?.name, date });
  const html    = buildSpokesboxEmailHTML(brief, subscriber);
  const text    = buildSpokesboxEmailText(brief, subscriber);

  return {
    subject,
    preheader: PREHEADER,
    html,
    text,
    metadata: {
      project:          PROJECT,
      template_version: TEMPLATE_VERSION,
      generated_at:     new Date().toISOString(),
      source_date:      opts.sourceDate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
      from_email:       FROM_EMAIL,
      from_name:        FROM_NAME,
      reply_to:         REPLY_TO,
      subject,
      preheader:        PREHEADER,
    },
  };
}

module.exports = {
  buildSpokesboxEmailHTML,
  buildSpokesboxEmailText,
  buildSpokesboxEmailPayload,
  buildSubject,
  PREHEADER,
};
