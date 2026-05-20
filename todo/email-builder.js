'use strict';
/**
 * TODO Email Builder — v1.0.0
 * Canonical module per EMAIL_OUTPUT_STANDARD.md
 *
 * Builds a private assistant digest email from Google Sheet TODO data.
 * NOT a marketing broadcast — no unsubscribe link required.
 *
 * Exports:
 *   buildTodoEmailHTML(sections, opts)    → HTML string
 *   buildTodoEmailText(sections, opts)    → plain-text string
 *   buildTodoEmailPayload(sections, opts) → { subject, preheader, html, text, metadata }
 *
 * sections: Array<{ section: string, items: Array<{ item, status, notes }> }>
 * opts: { date?, recipient? }
 */

const TEMPLATE_VERSION = '1.0.0';
const PROJECT          = 'todo';
const FROM_EMAIL       = 'jared@jaredgreen.com';
const FROM_NAME        = 'Sherlock';
const PREHEADER        = "Today's open tasks, deadlines, money items, and follow-ups.";

// Status badge colors
const STATUS_STYLE = {
  done:        'background:#d1fae5;color:#065f46;',
  complete:    'background:#d1fae5;color:#065f46;',
  paid:        'background:#d1fae5;color:#065f46;',
  pending:     'background:#fef3c7;color:#92400e;',
  'in progress':'background:#dbeafe;color:#1e40af;',
  unpaid:      'background:#fee2e2;color:#991b1b;',
  overdue:     'background:#fee2e2;color:#991b1b;',
};

function statusBadge(status) {
  if (!status || status.toLowerCase() === 'open') return '';
  const style = STATUS_STYLE[status.toLowerCase()] || 'background:#e5e7eb;color:#374151;';
  return `<span style="${style}font-size:11px;font-weight:600;padding:2px 7px;border-radius:10px;margin-left:8px;">${status}</span>`;
}

function buildDate(dateStr) {
  if (dateStr) return dateStr;
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  });
}

// ─── HTML Builder ───────────────────────────────────────────────────────────

function buildTodoEmailHTML(sections, opts = {}) {
  const date      = buildDate(opts.date);
  const recipient = opts.recipient || 'Jride';

  const sectionsHTML = sections.map(sec => {
    const rows = (sec.items || []).map(item => `
      <tr style="border-bottom:1px solid rgba(201,168,76,0.1);">
        <td style="padding:9px 12px;font-size:14px;color:#d4cfc4;line-height:1.5;">
          ${item.item || ''}
          ${statusBadge(item.status)}
          ${item.notes ? `<div style="font-size:12px;color:#6b7a96;margin-top:3px;">${item.notes}</div>` : ''}
        </td>
      </tr>`).join('');

    return `
      <div style="margin-bottom:24px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;
                    color:#c9a84c;padding:8px 0;border-bottom:2px solid rgba(201,168,76,0.3);
                    margin-bottom:4px;">
          ${sec.section}
        </div>
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#0d1121;border-radius:6px;overflow:hidden;">
          ${rows || '<tr><td style="padding:9px 12px;font-size:13px;color:#6b7a96;font-style:italic;">No items</td></tr>'}
        </table>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Jride TODO — ${date}</title>
  <style>body,table{background:#07090f!important;}</style>
</head>
<body style="margin:0;padding:0;background:#07090f;font-family:'Helvetica Neue',Arial,sans-serif;">

  <!-- Preheader (hidden) -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#07090f;">
    ${PREHEADER}
  </span>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07090f;">
    <tr><td align="center" style="padding:28px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:#0d1121;border:1px solid rgba(201,168,76,0.2);
                       border-radius:12px 12px 0 0;padding:24px 28px 20px;">
          <div style="font-size:22px;font-weight:700;color:#c9a84c;">📋 ${recipient} TODO</div>
          <div style="font-size:13px;color:#6b7a96;margin-top:4px;">${date}</div>
          <div style="font-size:11px;color:#6b7a96;margin-top:8px;font-style:italic;
                      border-top:1px solid rgba(201,168,76,0.1);padding-top:8px;">
            Private assistant digest · Not for forwarding
          </div>
        </td></tr>

        <!-- Content -->
        <tr><td style="background:#07090f;border-left:1px solid rgba(201,168,76,0.1);
                       border-right:1px solid rgba(201,168,76,0.1);padding:24px 28px;">
          ${sectionsHTML}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#0d1121;border:1px solid rgba(201,168,76,0.2);
                       border-radius:0 0 12px 12px;padding:16px 28px;text-align:center;">
          <p style="font-size:11px;color:#6b7a96;margin:0;line-height:1.8;">
            Private assistant digest · Not for forwarding<br>
            Generated by Sherlock 🔍 · <a href="https://torahtxt.com" style="color:#c9a84c;">OpenClaw</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Plain-text Builder ─────────────────────────────────────────────────────

function buildTodoEmailText(sections, opts = {}) {
  const date      = buildDate(opts.date);
  const recipient = opts.recipient || 'Jride';
  const hr = '-'.repeat(50);

  const secLines = sections.map(sec => {
    const items = (sec.items || []).map(item => {
      const status = item.status ? ` [${item.status}]` : '';
      const notes  = item.notes  ? ` — ${item.notes}` : '';
      return `  • ${item.item}${status}${notes}`;
    }).join('\n');
    return `${sec.section}\n${hr}\n${items || '  (no items)'}`;
  }).join('\n\n');

  return [
    `📋 ${recipient} TODO — ${date}`,
    '='.repeat(50),
    '',
    secLines,
    '',
    hr,
    'Private assistant digest · Not for forwarding',
    'Generated by Sherlock 🔍',
  ].join('\n');
}

// ─── Payload Builder ────────────────────────────────────────────────────────

function buildTodoEmailPayload(sections, opts = {}) {
  const date    = buildDate(opts.date);
  const subject = `📋 Jride TODO List — ${new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  })}`;
  const html    = buildTodoEmailHTML(sections, opts);
  const text    = buildTodoEmailText(sections, opts);

  return {
    subject,
    preheader: PREHEADER,
    html,
    text,
    metadata: {
      project:          PROJECT,
      template_version: TEMPLATE_VERSION,
      generated_at:     new Date().toISOString(),
      source_date:      new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
      from_email:       FROM_EMAIL,
      from_name:        FROM_NAME,
      reply_to:         null,
      subject,
      preheader:        PREHEADER,
      private:          true,
    },
  };
}

module.exports = { buildTodoEmailHTML, buildTodoEmailText, buildTodoEmailPayload };
