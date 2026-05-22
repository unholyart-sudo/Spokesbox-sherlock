'use strict';
/**
 * TorahTxt Email Builder — v1.0.0
 * Canonical module per EMAIL_OUTPUT_STANDARD.md
 *
 * Exports:
 *   buildDailyEmailHTML(params)    → HTML string
 *   buildDailyEmailText(params)    → plain-text string
 *   buildDailyEmailPayload(params) → { subject, preheader, html, text, metadata }
 *
 * params: { name, date, parasha, message, token, email, imageUrl, sourceDate? }
 */

const TEMPLATE_VERSION = '1.0.0';
const PROJECT          = 'torahtxt';
const FROM_EMAIL       = 'jared@jaredgreen.com';
const FROM_NAME        = 'TorahTxt';
const REPLY_TO         = 'sherlock.claw@gmail.com';
const BASE_URL         = process.env.BASE_URL || 'https://torahtxt.com';

// ─── Subject / Preheader ────────────────────────────────────────────────────

// Extract the actual parasha name from the first line of the email content
// e.g. "Parshat Bamidbar — Each Tribe, Each Mission" → "Bamidbar"
function extractParashaName(emailContent, fallback) {
  if (!emailContent) return fallback || 'Weekly Parasha';
  const firstLine = emailContent.split('\n')[0].trim();
  // Match "Parshat X", "Parashat X", "Parasha X" at start of line
  const m = firstLine.match(/^Parshat?a?\s+([^\u2014\u2013\-,]+)/i);
  if (m) return m[1].trim();
  return fallback || 'Weekly Parasha';
}

function buildSubject({ title }) {
  // Date omitted from subject — moved to preheader for cleaner inbox preview
  return `TorahTxt: ${title}`;
}

function buildPreheader({ parasha, message }) {
  // Reflective, parasha-specific — not a raw content dump
  const cleanParasha = parasha && !parasha.includes(' ') ? parasha
    : (parasha || '').split(/\s+/).slice(0, 2).join(' ');
  const firstSentence = (message || '')
    .replace(/\n/g, ' ')
    .replace(/\[Your Name\]/gi, 'the community')
    .replace(/<[^>]+>/g, '') // strip any HTML
    .replace(/\*([^*]+)\*/g, '$1') // strip markdown italics
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/[.,:;]\s*$/, '');
  return `${cleanParasha} teaches: ${firstSentence}.`;
}

// ─── HTML Builder ───────────────────────────────────────────────────────────

// ─── Dig Deeper links (always included) ─────────────────────────────────────
function buildDigDeeperSection(parasha) {
  const q = encodeURIComponent(parasha || '');
  return `
    <div style="background:#fdf8ee;border:1px solid #e5d9b0;
                border-radius:8px;padding:20px 24px;margin:0 0 24px 0;">
      <p style="color:#8b7340;font-size:0.8rem;letter-spacing:0.1em;
                text-transform:uppercase;margin:0 0 12px 0;font-weight:bold;">📚 Dig Deeper</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:0 0 7px 0;"><a href="https://www.sefaria.org/search#query=parashat+${q}" style="color:#8b7340;">📖 <strong>Sefaria</strong></a><span style="color:#6b7280;font-size:0.82rem;"> — Full Torah text + commentaries</span></td></tr>
        <tr><td style="padding:0 0 7px 0;"><a href="https://www.chabad.org/search/keyword_cdo/kid/8928/jewish/Parsha.htm" style="color:#8b7340;">🕍 <strong>Chabad.org</strong></a><span style="color:#6b7280;font-size:0.82rem;"> — Chassidic insights + weekly guides</span></td></tr>
        <tr><td style="padding:0 0 7px 0;"><a href="https://www.aish.com/tp/" style="color:#8b7340;">🔥 <strong>Aish.com</strong></a><span style="color:#6b7280;font-size:0.82rem;"> — Inspiring Torah perspectives</span></td></tr>
        <tr><td><a href="https://torah.org/torah/" style="color:#8b7340;">📜 <strong>Torah.org</strong></a><span style="color:#6b7280;font-size:0.82rem;"> — Weekly shiurim + in-depth study</span></td></tr>
      </table>
    </div>`;
}

// ─── Kids section (optional) ─────────────────────────────────────────────────
function buildKidsSection(kids) {
  if (!kids) return '';
  let kidsHtml;
  if (typeof kids === 'object') {
    const emoji = kids.emoji || '🌟';
    kidsHtml = kids.title
      ? `<strong>${emoji} ${kids.title}</strong><br>${kids.text || ''}`
      : kids.text || '';
  } else {
    kidsHtml = String(kids);
  }
  if (!kidsHtml.trim()) return '';
  return `
    <div style="background:#fdf8ee;border:2px solid #e5d9b0;
                border-radius:12px;padding:22px 24px;margin:0 0 24px 0;">
      <p style="color:#8b7340;font-size:0.8rem;letter-spacing:0.1em;
                text-transform:uppercase;margin:0 0 10px 0;font-weight:bold;">👑 Torah for Kids</p>
      <p style="color:#374151;font-size:1rem;line-height:1.8;margin:0;">${kidsHtml}</p>
    </div>`;
}

function buildDailyEmailHTML({ name, date, parasha, message, token, email, imageUrl, kids }) {
  const unsubLink = `${BASE_URL}/unsubscribe/email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  const preheaderText = buildPreheader({ parasha, message });

  const messageHtml = (message || '')
    .replace(/\[Your Name\]/gi, 'The TorahTxt Team')
    .split('\n')
    .map(line => {
      const t = line.trim();
      if (!t) return '';
      // Render reflection/italic lines (starting with _) as styled callout
      if (t.startsWith('_') && t.endsWith('_')) {
        const txt = t.slice(1, -1);
        return '<div style="border-left:3px solid #c9a84c;padding:12px 0 12px 18px;margin:20px 0;color:#374151;font-style:italic;font-size:14px;line-height:1.65;">' + txt + '</div>';
      }
      if (t.startsWith('•')) {
        return `<li style="color:#374151;font-size:15px;line-height:1.75;margin-bottom:0.75em;padding-left:0.5em;">${
          t.slice(1).trim().replace(/\*(.*?)\*/g, '<em style="color:#8b7340;">$1</em>')
        }</li>`;
      }
      return `<p style="color:#374151;font-size:15px;line-height:1.75;margin:0 0 1em 0;">${
        t.replace(/\*(.*?)\*/g, '<em style="color:#8b7340;">$1</em>')
      }</p>`;
    })
    .join('\n')
    .replace(/(<li[^>]*>.*?<\/li>\n?)+/gs, m =>
      `<ul style="padding-left:1.2em;margin:0.5em 0 1.2em 0;">${m}</ul>`
    );

  const dailyImage = imageUrl
    ? `<tr><td style="padding-bottom:0;">
         <img src="${BASE_URL}${imageUrl}" alt="Today's D'var Torah" width="600"
              style="width:100%;max-width:600px;border-radius:12px 12px 0 0;display:block;">
       </td></tr>`
    : '';

  const cardRadius = imageUrl ? '0 0 12px 12px' : '12px';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TorahTxt — Daily D'var Torah</title>
  <style>
  @media only screen and (max-width:620px) {
    .container { width:100% !important; }
    .content-pad { padding:22px 20px !important; }
    .stack { display:block !important; width:100% !important; margin-bottom:10px !important; }
    .center-mobile { text-align:center !important; }
  }
  body,table{background:#f5f4ef!important;}
</style>
</head>
<body style="margin:0;padding:0;background:#f5f4ef;font-family:Georgia,serif;color:#1a1a2a;">

  <!-- Preheader (hidden) -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#f5f4ef;">
    ${preheaderText.replace(/</g,'&lt;')}
  </span>

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f5f4ef;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" class="container" style="max-width:600px;width:100%;">

        <!-- Logo + tagline -->
        <tr><td style="text-align:center;padding-bottom:8px;">
          <img src="${BASE_URL}/images/logo-final.png" alt="TorahTxt" width="220"
               style="width:220px;height:auto;display:block;margin:0 auto;">
        </td></tr>
        <tr><td style="text-align:center;padding-bottom:24px;">
          <span style="font-family:Georgia,serif;font-size:0.9rem;font-style:italic;
                       color:#8b7340;letter-spacing:0.05em;">Divine Inspiration. Delivered Daily.</span>
        </td></tr>

        ${dailyImage}

        <!-- Card -->
        <tr><td style="background:#ffffff;border:1px solid #e5e0d5;
                       border-radius:${cardRadius};padding:36px;">

          <!-- Date + Parasha -->
          <p style="color:#6b7280;font-size:0.8rem;letter-spacing:0.1em;
                    text-transform:uppercase;margin:0 0 4px 0;">${date}</p>
          <h2 style="color:#8b7340;font-family:Georgia,serif;margin:0 0 24px 0;
                     font-size:1.25rem;">Parashat ${parasha}</h2>
          <div style="height:2px;background:linear-gradient(90deg,transparent,#c9a84c,transparent);
                      margin-bottom:28px;"></div>

          <!-- Message -->
          ${messageHtml}

          <!-- View online -->
          <p style="text-align:center;margin:28px 0;font-size:0.85rem;color:#6b7280;">
            <a href="${BASE_URL}/today" style="color:#c9a84c;">View this online</a>
          </p>

          <div style="height:1px;background:#e5e0d5;margin:0 0 24px 0;"></div>

          <!-- Dig Deeper -->
          ${buildDigDeeperSection(parasha)}

          <!-- Torah for Kids -->
          ${buildKidsSection(kids)}

          <!-- CTAs -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td class="stack" style="text-align:center;padding:0 8px;">
                <a href="${BASE_URL}/#signup"
                   style="display:inline-block;background:transparent;border:1px solid #c9a84c;
                          color:#8b7340;text-decoration:none;padding:10px 20px;border-radius:6px;
                          font-size:0.85rem;">📱 Get Text Messages</a>
              </td>
              <td style="text-align:center;padding:0 8px;">
                <a href="${BASE_URL}/sponsor"
                   style="display:inline-block;background:transparent;border:1px solid #c9a84c;
                          color:#8b7340;text-decoration:none;padding:10px 20px;border-radius:6px;
                          font-size:0.85rem;">🕯️ Sponsor a Day</a>
              </td>
            </tr>
          </table>

          <div style="height:1px;background:#e5e0d5;margin:24px 0;"></div>

          <!-- Footer -->
          <p style="color:#6b7280;font-size:0.75rem;text-align:center;margin:0;line-height:1.8;">
            You're receiving this because you subscribed to TorahTxt.<br>
            <a href="${unsubLink}" style="color:#8b7340;">Unsubscribe</a>
            &nbsp;·&nbsp;
            <a href="${BASE_URL}" style="color:#8b7340;">torahtxt.com</a>
          </p>
        </td></tr>

        <tr><td style="text-align:center;padding-top:20px;color:#6b7280;font-size:0.75rem;">
          © TorahTxt · Divine Inspiration. Delivered Daily.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Plain-text Builder ─────────────────────────────────────────────────────

function buildDailyEmailText({ name, date, parasha, message, email, token, kids }) {
  const unsubLink = `${BASE_URL}/unsubscribe/email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  const cleanMessage = (message || '')
    .replace(/\[Your Name\]/gi, 'The TorahTxt Team')
    .replace(/\*(.*?)\*/g, '$1')
    .trim();

  return [
    'TorahTxt — Divine Inspiration. Delivered Daily.',
    '='.repeat(50),
    '',
    `${date}`,
    `Parashat ${parasha}`,
    '',
    '-'.repeat(50),
    '',
    cleanMessage,
    '',
    '--- Dig Deeper ---',
    `Sefaria (full text + commentaries): https://www.sefaria.org/search#query=parashat+${encodeURIComponent(parasha||'')}`,
    `Aish.com: https://www.aish.com/tp/`,
    `Torah.org: https://torah.org/torah/`,
    '',
    ...(kids ? [
      '--- Torah for Kids ---',
      typeof kids === 'object' ? `${kids.emoji||''} ${kids.title||''}: ${kids.text||''}`.trim() : String(kids),
      '',
    ] : []),
    '-'.repeat(50),
    '',
    `Read online: ${BASE_URL}/today`,
    `Subscribe via SMS: ${BASE_URL}/#signup`,
    `Sponsor a day: ${BASE_URL}/sponsor`,
    '',
    `Unsubscribe: ${unsubLink}`,
    `Website: ${BASE_URL}`,
    '',
    '© TorahTxt · Divine Inspiration. Delivered Daily.',
  ].join('\n');
}

// ─── Payload Builder ────────────────────────────────────────────────────────

function buildDailyEmailPayload({ name, date, parasha, message, token, email, imageUrl, kids, sourceDate, title }) {
  // title is required for subject; fall back to parasha
  const resolvedTitle = title || parasha || 'Daily D\'var Torah';
  // Extract real parasha name from email content to avoid "Parashat Your Calling..."
  const resolvedParasha = extractParashaName(message, parasha);
  const resolvedDate  = date || new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  });

  const subject   = buildSubject({ title: resolvedTitle });
  const preheader = buildPreheader({ parasha: resolvedParasha, message });
  const html      = buildDailyEmailHTML({ name, date: resolvedDate, parasha: resolvedParasha, message, token, email, imageUrl, kids });
  const text      = buildDailyEmailText({ name, date: resolvedDate, parasha: resolvedParasha, message, email, token, kids });

  return {
    subject,
    preheader,
    html,
    text,
    metadata: {
      project:          PROJECT,
      template_version: TEMPLATE_VERSION,
      generated_at:     new Date().toISOString(),
      source_date:      sourceDate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
      from_email:       FROM_EMAIL,
      from_name:        FROM_NAME,
      reply_to:         REPLY_TO,
      subject,
      preheader,
    },
  };
}

module.exports = { buildDailyEmailHTML, buildDailyEmailText, buildDailyEmailPayload };
