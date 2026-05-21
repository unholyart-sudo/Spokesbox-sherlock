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
function buildTodoPreheader(sections) {
  const urgentItems = [];
  for (const sec of (sections || [])) {
    for (const it of (sec.items || [])) {
      const s = (it.status || '').toLowerCase();
      if (s.includes('unpaid') || s.includes('overdue') || s.includes('⚠️')) {
        // Truncate at word boundary
      const truncated = it.item.slice(0, 45);
      urgentItems.push(truncated.lastIndexOf(" ") > 10 ? truncated.slice(0, truncated.lastIndexOf(" ")) : truncated);
      }
    }
  }
  if (urgentItems.length > 0) {
    return `Needs attention: ${urgentItems.slice(0, 2).join(', ')}.`.slice(0, 150);
  }
  const sectionNames = (sections || []).slice(0, 3).map(s => s.section.replace(/^[^\w]+/, '').trim().split('.')[0]).join(', ');
  return `${sectionNames} — and more.`.slice(0, 150);
}

// Status badge colors

function statusBadge(status) {
  if (!status || status.toLowerCase() === 'open') return '';
  const s = status.toLowerCase();
  let style;
  if (s.includes('unpaid') || s.includes('overdue') || s.includes('⚠️')) {
    style = 'background:#3a1f1f;color:#ffb4a2;';
  } else if (s.includes('pending') || s.includes('waiting') || s.includes('tbd')) {
    style = 'background:#3a2f1a;color:#f4d06f;';
  } else if (s.includes('paid') || s.includes('done') || s.includes('complete') || s.includes('✅')) {
    style = 'background:#183025;color:#8fe1b2;';
  } else if (s.includes('active') || s.includes('received') || s.includes('in progress')) {
    style = 'background:#1e2a45;color:#b8c7ff;';
  } else {
    style = 'background:#2a2d3a;color:#c0c0c0;';
  }
  return `<span style="${style}font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;margin-left:8px;">${status}</span>`;
}

// Build a "Top Priority" block from the highest-urgency items
function buildTopPriorityBlock(sections) {
  const urgentItems = [];
  for (const sec of (sections || [])) {
    for (const it of (sec.items || [])) {
      const s = (it.status || '').toLowerCase();
      if (s.includes('unpaid') || s.includes('overdue') || s.includes('⚠️') || s.includes('blocked')) {
        urgentItems.push(it.item);
      }
    }
  }
  if (urgentItems.length === 0) return '';
  const items = urgentItems.slice(0, 3).map((item, i) =>
    `<div style="padding:5px 0;font-size:15px;color:#d4cfc4;line-height:1.6;"><strong style="color:#f4d06f;">${i + 1}.</strong> ${item}</div>`
  ).join('');
  return `
    <div style="background:#1a1c24;border:1px solid rgba(201,168,76,0.3);border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#c9a84c;margin-bottom:10px;font-weight:700;">⚡ TOP PRIORITY TODAY</div>
      ${items}
    </div>`;
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

  const topPriorityBlock = buildTopPriorityBlock(sections);
  const sectionsHTML = sections.map(sec => {
    const rows = (sec.items || []).map(item => `
      <tr style="border-bottom:1px solid rgba(201,168,76,0.1);">
        <td style="padding:9px 12px;font-size:15px;color:#d4cfc4;line-height:1.6;">
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
  <style>
  @media only screen and (max-width:620px) {
    .container { width:100% !important; }
    .content-pad { padding:20px 16px !important; }
  }
  body,table{background:#07090f!important;}
</style>
</head>
<body style="margin:0;padding:0;background:#07090f;font-family:'Helvetica Neue',Arial,sans-serif;">

  <!-- Preheader (hidden) -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#07090f;">
    ${buildTodoPreheader(sections)}
  </span>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07090f;">
    <tr><td align="center" style="padding:28px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" class="container" style="max-width:600px;width:100%;">

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
          ${topPriorityBlock}
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
  // Count items needing attention (unpaid, overdue, pending, blocked)
  const urgentStatuses = ['unpaid', 'overdue', 'pending', 'blocked', '⚠️ unpaid', 'due'];
  const urgentCount = sections.reduce((n, sec) =>
    n + sec.items.filter(it => urgentStatuses.some(s => (it.status||'').toLowerCase().includes(s))).length, 0
  );
  const subjectLine = urgentCount > 0
    ? `TODO: ${urgentCount} item${urgentCount > 1 ? 's' : ''} need attention`
    : `TODO: your list`;
  const subject = subjectLine;
  const preheader = buildTodoPreheader(sections);
  const html    = buildTodoEmailHTML(sections, opts);
  const text    = buildTodoEmailText(sections, opts);

  return {
    subject,
    preheader,
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
      preheader,
      private:          true,
    },
  };
}

module.exports = { buildTodoEmailHTML, buildTodoEmailText, buildTodoEmailPayload };
