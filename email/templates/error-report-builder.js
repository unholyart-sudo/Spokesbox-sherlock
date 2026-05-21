'use strict';
/**
 * Daily Error Report (Sherlock) — Template Builder v1.0.0
 * Only sends if there are errors (configurable). Terse, action-oriented.
 *
 * jobs shape: [{ name, schedule, lastRunStatus, consecutiveErrors, lastError, lastRunAt, nextRunAt }]
 * opts: { date?, alwaysSend? (default false — only send when errors exist) }
 */

const TEMPLATE_VERSION = '1.0.0';
const FROM_EMAIL = 'jared@jaredgreen.com';
const FROM_NAME  = 'Sherlock 🔍';
const REPLY_TO   = 'sherlock.claw@gmail.com';

function buildSubject({ highPriority, totalErrors }) {
  if (highPriority.length > 0) {
    const firstName = highPriority[0].name.split(' — ')[0].slice(0, 35);
    return `Error: ${firstName} failed ${highPriority[0].consecutiveErrors}x`;
  }
  if (totalErrors > 0) return `Warning: ${totalErrors} cron job${totalErrors > 1 ? 's' : ''} with errors`;
  return 'Cron: all clear';
}

function buildPreheader({ highPriority, healthy }) {
  if (highPriority.length > 0) {
    const j = highPriority[0];
    return `${j.name}: "${(j.lastError || '').slice(0, 60)}". Last run ${j.lastRunAt || 'unknown'}. Fix: check send path.`;
  }
  return `${healthy.length} jobs healthy. No errors.`;
}

function fmtTime(ms) {
  if (!ms) return 'unknown';
  // Accept epoch ms numbers or already-formatted strings
  if (typeof ms === 'string' && isNaN(Number(ms))) return ms;
  const d = new Date(Number(ms));
  if (isNaN(d)) return 'unknown';
  return d.toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/New_York' });
}

function buildErrorReportHTML(jobs, opts = {}) {
  const highPriority = jobs.filter(j => (j.consecutiveErrors || 0) >= 3);
  const warnings     = jobs.filter(j => (j.consecutiveErrors || 0) >= 1 && (j.consecutiveErrors || 0) < 3);
  const healthy      = jobs.filter(j => (j.consecutiveErrors || 0) === 0 && j.lastRunStatus === 'ok');
  const subject      = buildSubject({ highPriority, totalErrors: highPriority.length + warnings.length });
  const preheader    = buildPreheader({ highPriority, healthy });
  const date         = opts.date || new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric', timeZone:'America/New_York' });

  const jobCard = (j, bgColor, borderColor, labelColor, label) => `
    <div style="background:${bgColor};border-left:3px solid ${borderColor};border-radius:6px;padding:14px 16px;margin-bottom:10px;">
      <div style="font-size:0.7rem;letter-spacing:1px;text-transform:uppercase;color:${labelColor};font-weight:700;margin-bottom:6px;">${label}</div>
      <div style="font-size:0.95rem;font-weight:700;color:#fff;margin-bottom:4px;">${j.name}</div>
      ${j.lastError ? `<div style="font-size:0.82rem;color:#d0d8f0;margin-bottom:4px;">Error: <em>"${j.lastError.slice(0, 120)}"</em></div>` : ''}
      <div style="font-size:0.78rem;color:#9ca3af;">
        Last run: ${fmtTime(j.lastRunAt)} · Next: ${fmtTime(j.nextRunAt)}
      </div>
      ${j.consecutiveErrors >= 3 ? '<div style="font-size:0.78rem;color:#e07a4c;margin-top:4px;">Suggested check: review email send path and API key validity.</div>' : ''}
    </div>`;

  const healthyList = healthy.length > 0
    ? `<ul style="padding-left:18px;margin:0;color:#d0d8f0;font-size:0.85rem;line-height:2;">
        ${healthy.map(j => `<li>${j.name} ✅</li>`).join('')}
       </ul>`
    : '<div style="color:#6b7a96;font-size:0.85rem;font-style:italic;">No jobs confirmed healthy this run.</div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sherlock Error Report</title>
  <style>body,table{background:#0f1117!important;}</style>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Helvetica Neue',Arial,sans-serif;color:#d0d8f0;">

  <!-- Preheader -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#0f1117;">
    ${preheader}
  </span>

  <table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:24px 16px;">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;">

    <!-- Header -->
    <tr><td style="background:#1a1d27;border-radius:12px 12px 0 0;padding:20px 28px 14px;">
      <div style="font-size:0.7rem;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;">🔍 SHERLOCK DAILY REPORT</div>
      <div style="font-size:1.1rem;font-weight:700;color:#fff;margin:4px 0 2px;">${highPriority.length + warnings.length > 0 ? `${highPriority.length + warnings.length} job${highPriority.length + warnings.length > 1 ? 's' : ''} with errors` : 'All clear'}</div>
      <div style="font-size:0.78rem;color:#6b7a96;">${date}</div>
    </td></tr>
    <tr><td style="height:2px;background:linear-gradient(90deg,transparent,#c9a84c,transparent);"></td></tr>

    <tr><td style="background:#1a1d27;padding:16px 28px;">

      ${highPriority.length > 0 ? `
        <div style="font-size:0.7rem;letter-spacing:1px;text-transform:uppercase;color:#e07a4c;margin-bottom:10px;">🚨 HIGH PRIORITY (${highPriority.length})</div>
        ${highPriority.map(j => jobCard(j, 'rgba(224,122,76,0.12)', '#e07a4c', '#e07a4c', `${j.consecutiveErrors} consecutive failures`)).join('')}
      ` : ''}

      ${warnings.length > 0 ? `
        <div style="font-size:0.7rem;letter-spacing:1px;text-transform:uppercase;color:#f0b429;margin:16px 0 10px;">⚠️ WARNINGS (${warnings.length})</div>
        ${warnings.map(j => jobCard(j, 'rgba(240,180,41,0.08)', '#f0b429', '#f0b429', `${j.consecutiveErrors} failure${j.consecutiveErrors > 1 ? 's' : ''}`)).join('')}
      ` : ''}

      <div style="font-size:0.7rem;letter-spacing:1px;text-transform:uppercase;color:#4caf87;margin:16px 0 10px;">✅ HEALTHY (${healthy.length})</div>
      ${healthyList}

    </td></tr>

    <tr><td style="background:#0f1117;padding:14px 28px;text-align:center;border-radius:0 0 12px 12px;">
      <p style="font-size:0.72rem;color:#6b7a96;margin:0;">🔍 Sherlock · Daily Error Report · Reply to report an issue</p>
    </td></tr>

  </table>
  </td></tr>
  </table>
</body>
</html>`;
}

function buildErrorReportText(jobs, opts = {}) {
  const highPriority = jobs.filter(j => (j.consecutiveErrors || 0) >= 3);
  const warnings     = jobs.filter(j => (j.consecutiveErrors || 0) >= 1 && (j.consecutiveErrors || 0) < 3);
  const healthy      = jobs.filter(j => (j.consecutiveErrors || 0) === 0 && j.lastRunStatus === 'ok');
  const date         = opts.date || new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const hr = '─'.repeat(50);
  const lines = [`SHERLOCK DAILY ERROR REPORT — ${date}`, hr, ''];

  if (highPriority.length > 0) {
    lines.push(`HIGH PRIORITY (${highPriority.length})`, hr);
    highPriority.forEach(j => {
      lines.push(j.name, `  Failures: ${j.consecutiveErrors} consecutive`, `  Error: "${j.lastError || 'unknown'}"`, `  Last run: ${fmtTime(j.lastRunAt)}`, `  Next run: ${fmtTime(j.nextRunAt)}`, '  Check: email send path / API key validity.', '');
    });
  }
  if (warnings.length > 0) {
    lines.push(`WARNINGS (${warnings.length})`, hr);
    warnings.forEach(j => lines.push(j.name, `  ${j.consecutiveErrors} failure(s) — "${j.lastError || ''}"`, ''));
  }
  lines.push(`HEALTHY (${healthy.length})`, hr, ...healthy.map(j => `  ${j.name} ✅`), '', hr, 'Reply to this email to report an issue. · Sherlock 🔍');
  return lines.join('\n');
}

function buildErrorReportPayload(jobs, opts = {}) {
  const highPriority = jobs.filter(j => (j.consecutiveErrors || 0) >= 3);
  const warnings     = jobs.filter(j => (j.consecutiveErrors || 0) >= 1 && (j.consecutiveErrors || 0) < 3);
  const totalErrors  = highPriority.length + warnings.length;

  // Skip if no errors and alwaysSend is false
  if (totalErrors === 0 && !opts.alwaysSend) return null;

  const subject   = buildSubject({ highPriority, totalErrors });
  const preheader = buildPreheader({ highPriority, healthy: jobs.filter(j => (j.consecutiveErrors || 0) === 0) });
  const html      = buildErrorReportHTML(jobs, opts);
  const text      = buildErrorReportText(jobs, opts);

  return {
    subject, preheader, html, text,
    metadata: {
      project: 'error-report', template_version: TEMPLATE_VERSION,
      generated_at: new Date().toISOString(), source_date: opts.date || '',
      from_email: FROM_EMAIL, from_name: FROM_NAME, reply_to: REPLY_TO,
      subject, preheader,
      highPriorityCount: highPriority.length, warningCount: warnings.length,
    },
  };
}

module.exports = { buildErrorReportPayload, buildErrorReportHTML, buildErrorReportText };
