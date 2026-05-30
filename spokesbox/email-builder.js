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
const DEFAULT_PREHEADER = 'Your personalized brief is ready.';

// Build a content-specific preheader from the actual section summaries
function buildDynamicPreheader(brief) {
  if (!brief || !Array.isArray(brief.sections) || brief.sections.length === 0) {
    return DEFAULT_PREHEADER;
  }
  const topSections = brief.sections
    .filter(s => s.id !== 'joke' && s.summary)
    .slice(0, 3);
  if (topSections.length === 0) return DEFAULT_PREHEADER;
  const snippets = topSections.map(s => {
    // Split on sentence-ending punctuation, but NOT on decimal points (e.g. 0.4%)
    const first = (s.summary || '')
      .replace(/(\d)\.(\d)/g, '$1·$2') // protect decimals
      .split(/[.!?]/)[0]
      .replace(/·/g, '.')
      .trim();
    return first.length > 10 ? first.slice(0, 60) : null;
  }).filter(Boolean);
  return snippets.join(' · ').slice(0, 150) || DEFAULT_PREHEADER;
}

// ─── Subject ────────────────────────────────────────────────────────────────

// Content-specific, short subject: "Jared: markets, tech, South Orange"
function buildSubject({ name, brief }) {
  const firstName = (name || '').split(' ')[0] || '';
  const topSections = (brief?.sections || [])
    .filter(s => s.id !== 'joke')
    .slice(0, 3)
    .map(s => (s.title || '').toLowerCase().replace(/[^a-z0-9& ]/gi, '').trim())
    .filter(Boolean);
  if (firstName && topSections.length >= 2) {
    return `${firstName}: ${topSections.slice(0, 2).join(', ')}`.slice(0, 50);
  }
  if (firstName) return `${firstName}: your brief`;
  return 'Your brief today';
}

// ─── HTML Renderers ─────────────────────────────────────────────────────────

function renderSectionHTML(section, skin) {
  skin = skin || { labelColor:"#667eea", textColor:"#263142", fontSize:"15px", sectionBg:"#f8faff", sectionBorder:"#e2e8f0" };
  const bullets = (section.bullets || [])
    .map(b => `<li style="margin-bottom:6px;color:${skin.textColor};line-height:1.65;font-size:${skin.fontSize};">${b}</li>`)
    .join('');
  const links = (section.links || [])
    .map(l => `<a href="${l.url}" style="color:#667eea;font-size:12px;display:inline-block;margin-right:12px;margin-top:4px;">→ ${l.text}</a>`)
    .join('');

  return `
    <div style="margin:0 16px 10px;background:${skin.sectionBg};border:1px solid ${skin.sectionBorder};border-radius:10px;padding:16px 18px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;
                  color:${skin.labelColor};font-weight:bold;margin-bottom:6px;">
        ${section.emoji} ${section.title}
      </div>
      ${section.summary
        ? `<p style="font-size:${skin.fontSize};color:${skin.textColor};line-height:1.6;margin:0 0 8px 0;">${section.summary}</p>`
        : ''}
      ${bullets
        ? `<ul style="padding-left:18px;margin:6px 0;">${bullets}</ul>`
        : ''}
      ${links ? `<div style="margin-top:6px;">${links}</div>` : ''}
    </div>`;
}

function buildSpokesboxEmailHTML(brief, subscriber) {
  const { email = '', token = '', name = '' } = subscriber || {};
  const isKids = brief.audience === 'kids' || name === 'Avi';
  // Kid skin overrides
  const skin = isKids ? {
    bg: '#f4f8ff', header: '#1d4ed8', accent: '#f59e0b', textColor: '#1f2937',
    mutedColor: '#64748b', sectionBg: '#ffffff', sectionBorder: '#dbeafe',
    labelColor: '#2563eb', fontSize: '16px', fontFamily: 'Arial, Verdana, sans-serif',
    logo: '⭐ AVI\'S DAILY BRIEF', logoSub: 'YOUR PERSONALIZED KIDS BRIEF',
    signal: false,
  } : {
    bg: '#fff', header: '#1a2744', accent: '#667eea', textColor: '#263142',
    mutedColor: '#718096', sectionBg: '#f8faff', sectionBorder: '#e2e8f0',
    labelColor: '#667eea', fontSize: '15px', fontFamily: "Arial,'Helvetica Neue',sans-serif",
    logoUrl: 'https://spokesbox.com/spokesbox-logo-transparent.png',
    logoUrl2x: 'https://spokesbox.com/spokesbox-logo-transparent@2x.png',
    signal: true,
  };
  const unsubLink = `${BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  });
  const subject = buildSubject({ name, brief });

  const sectionsHTML = (brief.sections || []).map(s => renderSectionHTML(s, skin)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>@media only screen and (max-width:620px) {
    .container { width:100% !important; }
    .content-pad { padding:18px 16px !important; }
    .stack { display:block !important; width:100% !important; }
  }</style>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Spokesbox Brief</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:${skin.fontFamily};">

  <!-- Preheader (hidden) -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#f0f4f8;">
    ${buildDynamicPreheader(brief)}
  </span>

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#eef3f8;">
  <tr><td align="center" style="padding:20px 12px;">
  <table width="600" cellpadding="0" cellspacing="0" role="presentation" class="container" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">

    <!-- Header -->
    <tr><td style="background:${skin.header};padding:30px 20px;text-align:center;">
      ${skin.logoUrl
        ? `<img src="${skin.logoUrl}"${skin.logoUrl2x ? ` srcset="${skin.logoUrl2x} 2x"` : ''} alt="Spokesbox" width="160" style="display:block;width:160px;max-width:160px;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto;background:transparent;">`
        : `<div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:1px;">${skin.logo}</div><div style="color:#a0aec0;font-size:11px;margin-top:3px;letter-spacing:0.05em;">${skin.logoSub}</div>`
      }
    </td></tr>

    <!-- Greeting -->
    <tr><td class="content-pad" style="padding:20px 24px 8px;">
      <p style="font-size:17px;color:#1a2744;font-weight:600;margin:0 0 2px;">
        ${isKids ? `Here's what's happening today, <strong>${name.split(' ')[0]}</strong>! 🌟` : `${brief.greeting}${name ? `, <strong>${name.split(' ')[0]}</strong>` : ''}! ☀️`}
      </p>
      <p style="font-size:12px;color:#718096;margin:0;">${date}</p>
    </td></tr>

    <!-- Today's Signal callout -->
    ${(()=>{
      const topSignals = (brief.sections||[]).filter(s=>s.id!=='joke' && s.summary).slice(0,2)
        .map(s=>(s.summary||'').replace(/<[^>]+>/g,'').split(/[!?]/)[0].split('.')[0].trim()).filter(Boolean);
      if(!topSignals.length || !skin.signal) return '';
      return '<tr><td style="padding:0 24px 12px;"><div style="background:#f6f8ff;border-left:4px solid #667eea;border-radius:8px;padding:12px 16px;"><p style="margin:0;color:#1a2744;font-size:14px;line-height:1.55;">' + topSignals.join('. ') + '.</p></div></td></tr>';
    })()}

    <!-- Sections -->
    <tr><td style="padding:4px 8px;">${sectionsHTML}</td></tr>

    <!-- Closing -->
    ${brief.closing
      ? `<tr><td style="padding:12px 24px;"><p style="font-size:14px;color:#4a5568;font-style:italic;margin:0;">${brief.closing}</p></td></tr>`
      : ''}

    <!-- Footer -->
    <tr><td style="background:#f7fafc;padding:18px 24px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="font-size:11px;color:#a0aec0;margin:0;">
        You're receiving this because you signed up at spokesbox.com
      </p>
      <p style="font-size:11px;color:#a0aec0;margin:4px 0 0;">
        <a href="${unsubLink}" style="color:#667eea;">Unsubscribe</a>
        &nbsp;·&nbsp;
        <a href="${BASE_URL}" style="color:#667eea;">spokesbox.com</a>
      </p>
    </td></tr>

  </table>
  </td></tr>
  </table>
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
  const subject = buildSubject({ name: subscriber?.name, brief });
  const html    = buildSpokesboxEmailHTML(brief, subscriber);
  const text    = buildSpokesboxEmailText(brief, subscriber);

  return {
    subject,
    preheader: buildDynamicPreheader(brief),
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
      preheader:        buildDynamicPreheader(brief),
    },
  };
}

module.exports = {
  buildSpokesboxEmailHTML,
  buildSpokesboxEmailText,
  buildSpokesboxEmailPayload,
  buildSubject,
  buildDynamicPreheader,
  DEFAULT_PREHEADER,
};
