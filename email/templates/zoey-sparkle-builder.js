'use strict';
/**
 * Zoey's Daily Sparkle — Template Builder v1.0.0
 * Audience: Zoey, age 6 (1st grade). Tone: joyful, safe, magical.
 *
 * The LLM provides structured content; this module renders deterministic HTML + plain-text.
 * No free-form HTML from LLM — only text/links per section.
 *
 * content shape:
 * {
 *   date: string,
 *   taylorSection: { text: string, tryThis?: string },
 *   gymnastics:    { text: string, tryThis?: string },
 *   artTechnique:  { name: string, steps: string[], supplies: string },
 *   dollWorld:     { idea: string },
 *   math:          { question: string, answer: string, theme?: string },
 *   tongueTwister: string,
 *   joke:          { question: string, answer: string },
 *   sweetDreams:   string,
 * }
 */

const TEMPLATE_VERSION = '1.0.0';
const FROM_EMAIL = 'jared@jaredgreen.com';
const FROM_NAME  = 'Sherlock 🔍';

function buildSubject({ date }) {
  return `✨ Zoey's Daily Sparkle`;
}

function buildPreheader(content) {
  const artName = content.artTechnique?.name || 'art time';
  const mathQ   = content.math?.question?.split('?')[0]?.slice(0, 40) || 'math challenge';
  return `Taylor sparkle, ${artName}, ${mathQ}, and today's joke!`.slice(0, 150);
}

function buildZoeyHTML(content) {
  const { date, taylorSection, gymnastics, artTechnique, dollWorld, math, tongueTwister, joke, sweetDreams } = content;
  const preheader = buildPreheader(content);

  const artStepsHTML = (artTechnique?.steps || [])
    .map((s, i) => `<li style="margin-bottom:7px;color:#3f2a3d;font-size:16px;line-height:1.6;">${i + 1}. ${s}</li>`)
    .join('');

  const sec = (emoji, title, body) => `
    <div style="padding:16px 24px;border-bottom:2px dashed #f0c4e4;">
      <div style="font-size:17px;font-weight:bold;color:#e91e8c;margin-bottom:8px;">${emoji} ${title}</div>
      <div style="font-size:16px;color:#3f2a3d;line-height:1.7;">${body}</div>
    </div>`;

  const tryBlock = (text) => text
    ? `<div style="margin-top:10px;padding:10px 14px;background:#fff3fb;border-radius:8px;border-left:3px solid #e91e8c;font-size:14px;color:#9c27b0;"><strong>Try this:</strong> ${text}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>@media only screen and (max-width:620px){.container{width:100%!important;}.content-pad{padding:18px!important;}}</style>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Zoey's Daily Sparkle</title>
</head>
<body style="margin:0;padding:0;background:#fff9f0;font-family:'Helvetica Neue',Arial,sans-serif;">

  <!-- Preheader (hidden) -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#fff9f0;">
    ${preheader}
  </span>

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#fff7fb;">
  <tr><td align="center" style="padding:20px 12px;">
  <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:2px solid #f48fb1;">

    <!-- Header -->
    <tr><td style="background:linear-gradient(135deg,#f48fb1,#ce93d8);padding:24px 20px;text-align:center;">
      <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">✨ ZOEY'S DAILY SPARKLE ✨</div>
      <div style="font-size:14px;color:#fff;margin-top:4px;opacity:0.9;">${date}</div>
    </td></tr>

    <!-- Content sections -->
    ${taylorSection ? sec('🌟', 'Taylor Sparkle', taylorSection.text + tryBlock(taylorSection.tryThis)) : ''}
    ${gymnastics    ? sec('🤸', 'Gymnastics & Dance', gymnastics.text + tryBlock(gymnastics.tryThis)) : ''}

    ${artTechnique ? `
    <div style="padding:16px 24px;border-bottom:2px dashed #f0c4e4;">
      <div style="font-size:17px;font-weight:bold;color:#e91e8c;margin-bottom:8px;">🎨 Art Time: ${artTechnique.name}</div>
      <ol style="padding-left:20px;margin:0;color:#4a2060;">${artStepsHTML}</ol>
      ${artTechnique.supplies ? `<div style="margin-top:10px;font-size:13px;color:#9c27b0;font-style:italic;">You need: ${artTechnique.supplies}</div>` : ''}
    </div>` : ''}

    ${dollWorld ? sec('🧸', 'Doll World', dollWorld.idea) : ''}

    ${math ? `
    <div style="padding:16px 24px;border-bottom:2px dashed #f0c4e4;">
      <div style="font-size:17px;font-weight:bold;color:#e91e8c;margin-bottom:8px;">🧮 Math Challenge</div>
      <div style="font-size:16px;color:#3f2a3d;line-height:1.7;margin-bottom:10px;">${math.question}</div>
      <div style="background:#fff0f8;border:1.5px dashed #e91e8c;border-radius:10px;padding:12px 16px;font-size:15px;color:#6a1b9a;">
        <strong>Answer:</strong> ${math.answer}
      </div>
    </div>` : ''}

    ${tongueTwister ? `
    <div style="padding:16px 24px;border-bottom:2px dashed #f0c4e4;">
      <div style="font-size:17px;font-weight:bold;color:#e91e8c;margin-bottom:6px;">👅 Tongue Twister</div>
      <div style="font-size:15px;font-style:italic;color:#3f2a3d;margin-bottom:6px;">"${tongueTwister}"</div>
      <div style="font-size:13px;color:#9c27b0;">Try saying it 3 times fast! 😄</div>
    </div>` : ''}

    ${joke ? `
    <div style="padding:16px 24px;border-bottom:2px dashed #f0c4e4;">
      <div style="font-size:17px;font-weight:bold;color:#e91e8c;margin-bottom:8px;">😄 Joke of the Day</div>
      <div style="font-size:16px;color:#3f2a3d;"><strong>Q:</strong> ${joke.question}</div>
      <div style="font-size:16px;color:#3f2a3d;margin-top:4px;"><strong>A:</strong> ${joke.answer}</div>
    </div>` : ''}

    <!-- Sweet dreams -->
    ${sweetDreams ? `
    <div style="padding:16px 24px;background:#fce4ec;text-align:center;">
      <div style="font-size:15px;font-weight:bold;color:#9c27b0;margin-bottom:6px;">🌙 Sweet Dreams Thought</div>
      <div style="font-size:14px;color:#6a1b9a;font-style:italic;line-height:1.6;">${sweetDreams}</div>
    </div>` : ''}

    <!-- Footer -->
    <tr><td style="padding:14px 20px;text-align:center;background:#fff9f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Made with ❤️ by Sherlock 🔍 for Zoey</p>
    </td></tr>

  </table>
  </td></tr>
  </table>
</body>
</html>`;
}

function buildZoeyText(content) {
  const { date, taylorSection, gymnastics, artTechnique, dollWorld, math, tongueTwister, joke, sweetDreams } = content;
  const hr = '─'.repeat(40);
  const lines = [
    `✨ ZOEY'S DAILY SPARKLE — ${date}`, hr, '',
  ];
  if (taylorSection) { lines.push('TAYLOR SPARKLE', hr, taylorSection.text, taylorSection.tryThis ? `Try this: ${taylorSection.tryThis}` : '', ''); }
  if (gymnastics)    { lines.push('GYMNASTICS & DANCE', hr, gymnastics.text, gymnastics.tryThis ? `Try this: ${gymnastics.tryThis}` : '', ''); }
  if (artTechnique) {
    lines.push(`ART TIME: ${artTechnique.name}`, hr,
      ...(artTechnique.steps||[]).map((s,i) => `${i+1}. ${s}`),
      artTechnique.supplies ? `You need: ${artTechnique.supplies}` : '', '');
  }
  if (dollWorld)     { lines.push('DOLL WORLD', hr, dollWorld.idea, ''); }
  if (math)          { lines.push('MATH CHALLENGE', hr, math.question, `Answer: ${math.answer}`, ''); }
  if (tongueTwister) { lines.push('TONGUE TWISTER', hr, `"${tongueTwister}"`, 'Try 3 times fast!', ''); }
  if (joke)          { lines.push('JOKE OF THE DAY', hr, `Q: ${joke.question}`, `A: ${joke.answer}`, ''); }
  if (sweetDreams)   { lines.push('SWEET DREAMS THOUGHT', hr, sweetDreams, ''); }
  lines.push(hr, 'Made with love by Sherlock 🔍 for Zoey');
  return lines.join('\n');
}

function buildZoeyEmailPayload(content) {
  const subject   = buildSubject({ date: content.date });
  const preheader = buildPreheader(content);
  const html      = buildZoeyHTML(content);
  const text      = buildZoeyText(content);
  return {
    subject, preheader, html, text,
    metadata: {
      project: 'zoey-sparkle', template_version: TEMPLATE_VERSION,
      generated_at: new Date().toISOString(),
      source_date: content.date,
      from_email: FROM_EMAIL, from_name: FROM_NAME, reply_to: null,
      subject, preheader,
    },
  };
}

module.exports = { buildZoeyEmailPayload, buildZoeyHTML, buildZoeyText, buildSubject, buildPreheader };
