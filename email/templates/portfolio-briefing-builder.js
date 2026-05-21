'use strict';
/**
 * Portfolio Briefing AM — Template Builder v1.0.0
 * Dark theme · action-oriented · source-discipline enforced
 *
 * content shape:
 * {
 *   date: string,
 *   dayRotation: { sector: string, framework: string },   // e.g. "Fintech & Crypto", "Two Sigma"
 *   topStory:    { headline: string, body: string, sourceLabel?: string },
 *   holdings:    [{ ticker: string, price: string, change: string, changeDir: 'up'|'down'|'flat', note: string }],
 *   crypto:      { walletTotal: string, items: [{ symbol, price, change, changeDir, note }] },
 *   watchList?:  string[],   // 2-3 things to check before close
 *   artSignal?:  string,     // omit if nothing notable
 * }
 */

const TEMPLATE_VERSION = '1.0.0';
const FROM_EMAIL = 'jared@jaredgreen.com';
const FROM_NAME  = 'Sherlock 🔍';

function buildSubject({ topStory, dayRotation }) {
  // Short, signal-first
  const hook = (topStory?.headline || '')
    .replace(/<[^>]+>/g, '')
    .split(/[—,.]/)
    .map(p => p.trim())
    .filter(p => p.length > 4)[0] || dayRotation?.sector || 'morning brief';
  return `Portfolio: ${hook.slice(0, 40)}`;
}

function buildPreheader(content) {
  const sector  = content.dayRotation?.sector || '';
  const topLine = (content.topStory?.headline || '').replace(/<[^>]+>/g, '').slice(0, 60);
  const cryptoLine = content.crypto?.walletTotal ? ` · Wallet ${content.crypto.walletTotal}` : '';
  return `${topLine}${cryptoLine} · ${sector} lens`.slice(0, 150);
}

function changeColor(dir) {
  if (dir === 'up')   return '#4caf87';
  if (dir === 'down') return '#e07a4c';
  return '#9ca3af';
}

function row(label, labelColor, body) {
  return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
    <td style="padding:10px 0;color:${labelColor || '#c9a84c'};font-weight:700;width:70px;font-size:0.88rem;">${label}</td>
    <td style="padding:10px 0;color:#d0d8f0;font-size:0.88rem;line-height:1.5;">${body}</td>
  </tr>`;
}

function section(labelEmoji, labelText, bodyHTML) {
  return `
    <div style="padding:20px 28px;border-top:1px solid rgba(201,168,76,0.1);">
      <div style="font-size:0.7rem;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:12px;">${labelEmoji} ${labelText}</div>
      ${bodyHTML}
    </div>`;
}


// KPI strip: Market Tone + Wallet + Sector
function buildKPIStrip(content) {
  const headline = (content.topStory?.headline || '').toLowerCase();
  const tone = headline.includes('lift') || headline.includes(' up') || headline.includes('gain') || headline.includes('rally')
    ? { label: 'Risk-on ↑', color: '#4caf87' }
    : headline.includes('fall') || headline.includes('down') || headline.includes('loss') || headline.includes('drop')
    ? { label: 'Risk-off ↓', color: '#e07a4c' }
    : { label: 'Mixed →', color: '#c9a84c' };
  const wallet = content.crypto?.walletTotal || '—';
  const sector = content.dayRotation?.sector || '—';
  return `
    <tr><td style="padding:0 28px 14px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td width="33%" style="padding-right:6px;">
            <div style="background:#1a1d27;border:1px solid rgba(201,168,76,0.2);border-radius:6px;padding:10px 12px;text-align:center;">
              <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7a96;margin-bottom:4px;">Market Tone</div>
              <div style="font-size:13px;font-weight:700;color:\${tone.color};">\${tone.label}</div>
            </div>
          </td>
          <td width="33%" style="padding:0 3px;">
            <div style="background:#1a1d27;border:1px solid rgba(201,168,76,0.2);border-radius:6px;padding:10px 12px;text-align:center;">
              <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7a96;margin-bottom:4px;">Crypto Wallet</div>
              <div style="font-size:13px;font-weight:700;color:#c9a84c;">\${wallet}</div>
            </div>
          </td>
          <td width="33%" style="padding-left:6px;">
            <div style="background:#1a1d27;border:1px solid rgba(201,168,76,0.2);border-radius:6px;padding:10px 12px;text-align:center;">
              <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7a96;margin-bottom:4px;">Today's Lens</div>
              <div style="font-size:12px;font-weight:700;color:#d0d8f0;">\${sector.slice(0,16)}</div>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>`;
}

function buildPortfolioHTML(content) {
  const preheader = buildPreheader(content);

  const holdingsHTML = (content.holdings || []).length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;">
        <tr style="border-bottom:1px solid rgba(201,168,76,0.15);">
          <th style="text-align:left;padding:5px 8px 5px 0;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6b7a96;font-weight:600;">Ticker</th>
          <th style="text-align:left;padding:5px 8px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6b7a96;font-weight:600;">Price</th>
          <th style="text-align:left;padding:5px 8px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6b7a96;font-weight:600;">Move</th>
          <th style="text-align:left;padding:5px 0;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6b7a96;font-weight:600;">Read-through</th>
        </tr>` +
        (content.holdings || []).map(h => {
          const dir = h.changeDir === 'up' ? '↑' : h.changeDir === 'down' ? '↓' : '→';
          const clr = h.changeDir === 'up' ? '#4caf87' : h.changeDir === 'down' ? '#e07a4c' : '#9ca3af';
          return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:9px 8px 9px 0;font-size:13px;font-weight:700;color:#c9a84c;">${h.ticker}</td>
            <td style="padding:9px 8px;font-size:13px;color:#d0d8f0;font-variant-numeric:tabular-nums;">${h.price}</td>
            <td style="padding:9px 8px;font-size:13px;font-weight:600;color:${clr};">${dir} ${h.change}</td>
            <td style="padding:9px 0;font-size:12px;color:#9ca3af;line-height:1.4;">${h.note || ''}</td>
          </tr>`;
        }).join('') + `</table>`
    : '<div style="color:#6b7a96;font-size:0.85rem;font-style:italic;">No holdings with notable news today.</div>';

  const cryptoHTML = content.crypto
    ? `<div style="font-size:1rem;font-weight:700;color:#fff;margin-bottom:10px;">Wallet: <span style="color:#c9a84c;">${content.crypto.walletTotal}</span></div>
       <table width="100%" cellpadding="0" cellspacing="0">${
         (content.crypto.items || []).map(c =>
           row(c.symbol, '#c9a84c',
             `${c.price} <span style="color:${changeColor(c.changeDir)};">${c.change}</span>${c.note ? ` — ${c.note}` : ''}`)
         ).join('')
       }</table>`
    : '';

  const watchHTML = (content.watchList || []).length > 0
    ? (content.watchList || []).map(w => `<div style="padding:5px 0;color:#d0d8f0;font-size:0.85rem;">• ${w}</div>`).join('')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Portfolio Briefing</title>
  <style>
@media only screen and (max-width:620px){.container{width:100%!important;}.content-pad{padding:18px 14px!important;}}
body,table{background:#0f1117!important;}
</style>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Helvetica Neue',Arial,sans-serif;color:#d0d8f0;">

  <!-- Preheader -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#0f1117;">
    ${preheader}
  </span>

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr><td align="center" style="padding:24px 16px;">
  <table width="600" cellpadding="0" cellspacing="0" role="presentation" class="container" style="max-width:600px;">

    <!-- Header -->
    <tr><td style="background:#1a1d27;border-radius:12px 12px 0 0;padding:24px 28px 16px;">
      <div style="font-size:0.7rem;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:6px;">🌅 MORNING BRIEF</div>
      <div style="font-size:0.85rem;color:#d0d8f0;">${content.date}</div>
      ${content.dayRotation ? `<div style="font-size:0.75rem;color:#6b7a96;margin-top:2px;">${content.dayRotation.sector} · ${content.dayRotation.framework} Framework</div>` : ''}
    </td></tr>
    <tr><td style="height:2px;background:linear-gradient(90deg,transparent,#c9a84c,transparent);"></td></tr>

    <tr><td style="background:#1a1d27;">

      <!-- KPI Strip -->
      \${buildKPIStrip(content)}

      <!-- Top Story -->
      ${section('📰', 'TOP STORY', `
        <div style="font-size:1rem;font-weight:700;color:#fff;margin-bottom:8px;">${content.topStory?.headline || ''}</div>
        <div style="font-size:0.88rem;color:#b0b8c8;line-height:1.7;">${content.topStory?.body || ''}${content.topStory?.sourceLabel ? `<span style="font-size:0.75rem;color:#6b7a96;margin-left:6px;">[${content.topStory.sourceLabel}]</span>` : ''}</div>
      `)}

      <!-- Holdings -->
      ${section('📡', 'PORTFOLIO IMPACT', holdingsHTML)}

      <!-- Crypto -->
      ${content.crypto ? section('🪙', 'CRYPTO PULSE', cryptoHTML) : ''}

      <!-- Watch list -->
      ${content.watchList?.length ? section('👁️', 'WATCH BEFORE CLOSE', watchHTML) : ''}

      <!-- Art signal (omit if not present) -->
      ${content.artSignal ? section('🎨', 'ART SIGNAL', `<div style="font-size:0.85rem;color:#b0b8c8;">${content.artSignal}</div>`) : ''}

    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#0f1117;padding:16px 28px;text-align:center;border-radius:0 0 12px 12px;">
      <p style="font-size:0.72rem;color:#6b7a96;margin:0;">🔍 Sherlock · Morning Portfolio Briefing · To: unholyart@gmail.com</p>
    </td></tr>

  </table>
  </td></tr>
  </table>
</body>
</html>`;
}

function buildPortfolioText(content) {
  const hr = '─'.repeat(50);
  const lines = [
    `PORTFOLIO BRIEFING — ${content.date}`,
    content.dayRotation ? `${content.dayRotation.sector} · ${content.dayRotation.framework}` : '',
    hr, '',
    'TOP STORY', hr,
    (content.topStory?.headline || '').replace(/<[^>]+>/g, ''),
    '',
    (content.topStory?.body || '').replace(/<[^>]+>/g, ''),
    content.topStory?.sourceLabel ? `[Source: ${content.topStory.sourceLabel}]` : '',
    '',
    'PORTFOLIO IMPACT', hr,
    ...(content.holdings || []).map(h => `  ${h.ticker}: ${h.price} ${h.change} — ${h.note}`),
    (content.holdings || []).length === 0 ? '  No holdings with notable news.' : '',
    '',
    'CRYPTO PULSE', hr,
    content.crypto?.walletTotal ? `Wallet: ${content.crypto.walletTotal}` : '',
    ...(content.crypto?.items || []).map(c => `  ${c.symbol}: ${c.price} ${c.change}${c.note ? ` — ${c.note}` : ''}`),
    '',
    ...(content.watchList?.length ? ['WATCH BEFORE CLOSE', hr, ...(content.watchList || []).map(w => `  • ${w}`), ''] : []),
    ...(content.artSignal ? ['ART SIGNAL', hr, content.artSignal, ''] : []),
    hr,
    'Sherlock 🔍 · Morning Portfolio Briefing',
  ].filter(l => l !== null);
  return lines.join('\n');
}

function buildPortfolioEmailPayload(content) {
  const subject   = buildSubject(content);
  const preheader = buildPreheader(content);
  const html      = buildPortfolioHTML(content);
  const text      = buildPortfolioText(content);
  return {
    subject, preheader, html, text,
    metadata: {
      project: 'portfolio-briefing', template_version: TEMPLATE_VERSION,
      generated_at: new Date().toISOString(), source_date: content.date,
      from_email: FROM_EMAIL, from_name: FROM_NAME, reply_to: null,
      subject, preheader,
    },
  };
}

module.exports = { buildPortfolioEmailPayload, buildPortfolioHTML, buildPortfolioText };
