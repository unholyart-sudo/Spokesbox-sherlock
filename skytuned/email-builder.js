'use strict';
/**
 * SkyTuned Email Builder — v1.0.0
 * Canonical module per EMAIL_OUTPUT_STANDARD.md
 *
 * The AI-generation cron produces a structured content object (CONTENT_SCHEMA).
 * This module renders that object into a deterministic HTML + text email.
 *
 * Exports:
 *   buildSkyTunedEmailHTML(content, subscriber)    → HTML string
 *   buildSkyTunedEmailText(content, subscriber)    → plain-text string
 *   buildSkyTunedEmailPayload(content, subscriber) → { subject, preheader, html, text, metadata }
 *   validateContent(content)                       → { valid, errors }
 *
 * CONTENT_SCHEMA (what the cron agent must supply):
 * {
 *   date:       string,   // "Wednesday, May 20, 2026"
 *   sourceDate: string,   // "2026-05-20"
 *   lead: { headline: string, body: string, links?: [{text,url}] },
 *   missionControl: [{ label: string, text: string }],  // 4-6 bullets
 *   spotlight: { label: string, title: string, items: [{text:string}] },
 *   tonightsSky: string,
 *   spaceWeather: string,
 *   socialBuzz: string,
 *   onThePad: [{ mission: string, date: string, notes?: string }],
 *   marketSnapshot: [{ ticker: string, price: string, change: string }],
 * }
 */

const TEMPLATE_VERSION = '1.0.0';
const PROJECT          = 'skytuned';
const FROM_EMAIL       = 'jared@jaredgreen.com';
const FROM_NAME        = 'SkyTuned';
const REPLY_TO         = 'sherlock.claw@gmail.com';
const BASE_URL         = 'https://skytuned.com';
const LOGO_URL         = `${BASE_URL}/logo-space-v2.jpg`; // NEVER change to wordmark-email-v3.jpg
const LOGO_ALT         = 'SkyTuned';
const TAGLINE          = 'Space News. Comprehensive. Daily.';

// ─── Astrology-era guard ────────────────────────────────────────────────────
const ASTROLOGY_MARKERS = [
  'wordmark-email-v3',
  'Momentum',
  'Emotional Load',
  'Clarity',
  'Moon Phase',
  'Rising Sign',
  'astroathena',
  'daily horoscope',
];

function hasAstrologyContent(html) {
  const lower = html.toLowerCase();
  return ASTROLOGY_MARKERS.some(m => lower.includes(m.toLowerCase()));
}

// ─── Subject / Preheader ────────────────────────────────────────────────────

function buildSubject({ date }) {
  // Short, hook-first — date in preheader, not subject
  // Caller may override with a content-specific hook; fallback is the date
  return `🚀 SkyTuned: Your Daily Orbit`;
}

// Preheader is built dynamically from the day's actual lead + sections
function buildPreheader(content) {
  const leadSnippet = (content.lead?.headline || '').replace(/<[^>]+>/g, '').trim().slice(0, 60);
  const padCount    = (content.onThePad || []).filter(p => !p.notes?.includes('No launches')).length;
  const padStr      = padCount > 0 ? ` · ${padCount} launch${padCount > 1 ? 'es' : ''} on the pad` : '';
  const marketTop   = (content.marketSnapshot || [])[0];
  const marketStr   = marketTop ? ` · ${marketTop.ticker} ${marketTop.change}` : '';
  return `${leadSnippet}${padStr}${marketStr}`.slice(0, 150) || 'Launch watch, mission brief, sky events, space weather, and market moves.';
}

// ─── Content schema validation ──────────────────────────────────────────────

function validateContent(c) {
  const errors = [];
  if (!c)                         errors.push('content is null/undefined');
  if (!c?.date)                   errors.push('missing content.date');
  if (!c?.lead?.headline)         errors.push('missing content.lead.headline');
  if (!c?.lead?.body)             errors.push('missing content.lead.body');
  if (!Array.isArray(c?.missionControl) || c.missionControl.length === 0)
                                  errors.push('missing/empty content.missionControl[]');
  if (!c?.spotlight?.title)       errors.push('missing content.spotlight.title');
  if (!c?.tonightsSky)            errors.push('missing content.tonightsSky');
  if (!c?.spaceWeather)           errors.push('missing content.spaceWeather');
  if (!c?.marketSnapshot?.length) errors.push('missing/empty content.marketSnapshot[]');
  return { valid: errors.length === 0, errors };
}

// ─── Section renderers ──────────────────────────────────────────────────────

function renderSection(labelEmoji, labelText, bodyHtml) {
  return `
    <tr><td style="padding:0 28px 24px;">
      <div style="font-size:10px;letter-spacing:2px;color:#c9a84c;text-transform:uppercase;
                  margin-bottom:14px;">${labelEmoji} ${labelText}</div>
      ${bodyHtml}
      <div style="border-top:1px solid #1e2a45;margin-top:20px;"></div>
    </td></tr>`;
}

function renderBullet(text) {
  return `<div style="font-size:14px;color:#c0cce0;line-height:1.65;padding:6px 0;
                      border-bottom:1px solid #1a2035;">${text}</div>`;
}

function buildSkyTunedEmailHTML(content, subscriber) {
  const { email = '', token = '', name = '' } = subscriber || {};
  const unsubLink = `${BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  const subject   = buildSubject({ date: content.date });

  // ── Sections ──
  const leadHtml = `
    <div style="font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;margin-bottom:12px;">
      ${content.lead.headline}
    </div>
    <div style="font-size:15px;color:#c0cce0;line-height:1.7;">${content.lead.body}</div>
    ${(content.lead.links||[]).map(l =>
      `<div style="margin-top:10px;"><a href="${l.url}" style="color:#c9a84c;font-size:13px;">${l.text} →</a></div>`
    ).join('')}`;

  const missionHtml = content.missionControl.map(item =>
    renderBullet(`<strong style="color:#ffffff;">${item.label}:</strong> ${item.text}`)
  ).join('');

  const spotlightHtml = `
    <div style="font-size:16px;font-weight:700;color:#ffffff;margin-bottom:14px;">
      ${content.spotlight.title}
    </div>
    ${(content.spotlight.items||[]).map(i => renderBullet(i.text)).join('')}`;

  const padHtml = (content.onThePad||[]).map(p =>
    renderBullet(`<strong style="color:#ffffff;">🚀 ${p.mission}</strong> — ${p.date}${p.notes ? ` · ${p.notes}` : ''}`)
  ).join('') || renderBullet('<span style="color:#6b7a96;">No launches scheduled in the next 48 hours.</span>');

  const marketHtml = (content.marketSnapshot||[]).map(m =>
    renderBullet(`<strong style="color:#ffffff;">${m.ticker}</strong> ${m.price} <span style="color:${m.change.startsWith('-') ? '#f87171' : '#4ade80'};">${m.change}</span>`)
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SkyTuned · Your Daily Orbit</title>
  <style>body,table{background:#07090f!important;}</style>
</head>
<body style="margin:0;padding:0;background:#07090f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!-- Preheader (hidden) -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#07090f;">
    ${buildPreheader(content)}
  </span>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07090f;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Logo -->
        <tr><td style="background:#000000;text-align:center;padding:24px 0 8px;">
          <img src="${LOGO_URL}" alt="${LOGO_ALT}" width="240"
               style="display:block;margin:0 auto;background:#000000;">
        </td></tr>
        <!-- Tagline -->
        <tr><td style="background:#000000;text-align:center;padding:0 0 16px;">
          <span style="font-size:11px;letter-spacing:2px;color:#c9a84c;text-transform:uppercase;">
            ${TAGLINE}
          </span>
        </td></tr>
        <!-- Date bar -->
        <tr><td style="background:#07090f;padding:12px 0;text-align:center;">
          <span style="color:#8899bb;font-size:12px;letter-spacing:1px;text-transform:uppercase;">
            ${content.date}
          </span>
        </td></tr>

        <!-- Content card -->
        <tr><td style="background:#0d1121;border-radius:8px;overflow:hidden;">
          <table width="100%" cellpadding="0" cellspacing="0">

            <!-- 1. Today's Lead -->
            ${renderSection('🔭', "Today's Lead", leadHtml)}

            <!-- 2. Mission Control -->
            ${renderSection('📡', 'Mission Control', missionHtml)}

            <!-- 3. Spotlight -->
            ${renderSection('🔬', content.spotlight.label || 'Spotlight', spotlightHtml)}

            <!-- 4. Tonight's Sky -->
            ${renderSection('🌙', "Tonight's Sky",
              `<div style="font-size:14px;color:#c0cce0;line-height:1.7;">${content.tonightsSky}</div>`)}

            <!-- 5. Space Weather -->
            ${renderSection('🌤️', 'Space Weather',
              `<div style="font-size:14px;color:#c0cce0;line-height:1.7;">${content.spaceWeather}</div>`)}

            <!-- 6. Social Buzz -->
            ${content.socialBuzz ? renderSection('💬', 'Social Buzz',
              `<div style="font-size:14px;color:#c0cce0;line-height:1.7;">${content.socialBuzz}</div>`) : ''}

            <!-- 7. On the Pad -->
            ${renderSection('🚀', 'On the Pad', padHtml)}

            <!-- 8. Market Snapshot -->
            ${renderSection('📈', 'Market Snapshot', marketHtml)}

          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="font-size:11px;color:#6b7a96;margin:0;line-height:1.8;">
            You're receiving this because you subscribed to SkyTuned.<br>
            <a href="${unsubLink}" style="color:#c9a84c;">Unsubscribe</a>
            &nbsp;·&nbsp;
            <a href="${BASE_URL}" style="color:#c9a84c;">skytuned.com</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Guard: reject if astrology-era content leaked in
  if (hasAstrologyContent(html)) {
    throw new Error('ASTROLOGY_ERA_CONTENT_DETECTED: email HTML contains deprecated astrology markers. Aborting.');
  }

  return html;
}

// ─── Plain-text Builder ─────────────────────────────────────────────────────

// Strip HTML tags from text (for plain-text version of fields that may contain HTML)
function stripHTML(str) {
  return (str || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSkyTunedEmailText(content, subscriber) {
  const { email = '', token = '' } = subscriber || {};
  const unsubLink = `${BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  const hr = '-'.repeat(50);

  const missionLines = (content.missionControl||[])
    .map(i => `  • ${stripHTML(i.label)}: ${stripHTML(i.text)}`)
    .join('\n');

  const spotlightLines = (content.spotlight?.items||[])
    .map(i => `  • ${stripHTML(i.text)}`)
    .join('\n');

  const padLines = (content.onThePad||[])
    .map(p => `  • ${stripHTML(p.mission)} — ${stripHTML(p.date)}${p.notes ? ` (${stripHTML(p.notes)})` : ''}`)
    .join('\n') || '  • No launches in the next 48 hours.';

  const marketLines = (content.marketSnapshot||[])
    .map(m => `  ${stripHTML(m.ticker)}: ${stripHTML(m.price)} ${stripHTML(m.change)}`)
    .join('\n');

  // Lead links as plain text
  const leadLinks = (content.lead?.links || [])
    .map(l => `    ${l.text}: ${l.url}`)
    .join('\n');

  return [
    `SkyTuned · Your Daily Orbit`,
    content.date,
    'Space News. Comprehensive. Daily.',
    '='.repeat(50),
    '',
    `TODAY'S LEAD`,
    hr,
    stripHTML(content.lead.headline),
    '',
    stripHTML(content.lead.body),
    leadLinks ? `\n${leadLinks}` : '',
    '',
    `MISSION CONTROL`,
    hr,
    missionLines,
    '',
    `SPOTLIGHT: ${stripHTML(content.spotlight.title)}`,
    hr,
    spotlightLines,
    '',
    `TONIGHT'S SKY`,
    hr,
    stripHTML(content.tonightsSky),
    '',
    `SPACE WEATHER`,
    hr,
    stripHTML(content.spaceWeather),
    '',
    content.socialBuzz ? `SOCIAL BUZZ\n${hr}\n${stripHTML(content.socialBuzz)}\n` : '',
    `ON THE PAD`,
    hr,
    padLines,
    '',
    `MARKET SNAPSHOT`,
    hr,
    marketLines,
    '',
    '='.repeat(50),
    `Website: ${BASE_URL}`,
    `Unsubscribe: ${unsubLink}`,
    '© SkyTuned · Space News. Comprehensive. Daily.',
  ].filter(l => l !== null).join('\n');
}

// ─── Payload Builder ────────────────────────────────────────────────────────

function buildSkyTunedEmailPayload(content, subscriber) {
  const { valid, errors } = validateContent(content);
  if (!valid) {
    throw new Error(`SkyTuned content validation failed:\n  ${errors.join('\n  ')}`);
  }

  const subject   = content.subjectHook
    ? `🚀 SkyTuned: ${content.subjectHook}`
    : buildSubject({ date: content.date });
  const preheader = buildPreheader(content);
  const html      = buildSkyTunedEmailHTML(content, subscriber);
  const text      = buildSkyTunedEmailText(content, subscriber);

  return {
    subject,
    preheader,
    html,
    text,
    metadata: {
      project:          PROJECT,
      template_version: TEMPLATE_VERSION,
      generated_at:     new Date().toISOString(),
      source_date:      content.sourceDate || content.date,
      from_email:       FROM_EMAIL,
      from_name:        FROM_NAME,
      reply_to:         REPLY_TO,
      subject,
      preheader:        preheader,
    },
  };
}

module.exports = {
  buildSkyTunedEmailHTML,
  buildSkyTunedEmailText,
  buildSkyTunedEmailPayload,
  validateContent,
  hasAstrologyContent,
  buildPreheader,
};
