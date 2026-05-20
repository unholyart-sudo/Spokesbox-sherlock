#!/usr/bin/env node
/**
 * Email Output Validator — v1.0.0
 * Per EMAIL_OUTPUT_STANDARD.md
 *
 * Usage:
 *   node validate-email-output.js --project torahtxt
 *   node validate-email-output.js --project skytuned
 *   node validate-email-output.js --project spokesbox
 *   node validate-email-output.js --project todo
 *   node validate-email-output.js --all
 *   node validate-email-output.js --payload '{"subject":...}'   # raw JSON
 */
'use strict';

const path = require('path');
const fs   = require('fs');

const WS = path.resolve(__dirname, '..', '..');

// ─── Per-project required logo fragments ───────────────────────────────────
const REQUIRED_LOGOS = {
  torahtxt: 'logo-final.png',
  skytuned:  'logo-space-v2.jpg',
  // spokesbox + todo use text headers — no logo check
};

// ─── Astrology-era blocked strings (SkyTuned only) ─────────────────────────
const ASTROLOGY_BLOCKED = [
  'wordmark-email-v3',
  'Momentum',
  'Emotional Load',
  'Clarity Score',
  'Daily Horoscope',
];

// ─── Validator ──────────────────────────────────────────────────────────────

function validatePayload(payload, project) {
  const results = { pass: [], warn: [], fail: [] };

  const ok   = (msg) => results.pass.push(`✓ ${msg}`);
  const warn = (msg) => results.warn.push(`⚠ ${msg}`);
  const fail = (msg) => results.fail.push(`✗ ${msg}`);

  // 1. Envelope fields
  if (payload.subject)                ok('subject present');
  else                                fail('subject missing');

  if (payload.subject && payload.subject.length <= 70)  ok(`subject ≤ 70 chars (${payload.subject.length})`);
  else if (payload.subject)           warn(`subject ${payload.subject.length} chars (> 70 — may be clipped in some clients)`);

  if (payload.preheader)              ok('preheader present');
  else                                fail('preheader missing');

  if (payload.preheader && payload.preheader.length <= 150) ok(`preheader ≤ 150 chars (${payload.preheader.length})`);
  else if (payload.preheader)         warn(`preheader ${payload.preheader.length} chars (> 150)`);

  // 2. HTML
  if (payload.html)                   ok('html present');
  else                                fail('html missing');

  if (payload.html && /<html/i.test(payload.html) && /<\/html>/i.test(payload.html))
                                      ok('html has opening/closing <html> tags');
  else if (payload.html)              fail('html missing <html> / </html> tags');

  // 3. Preheader in HTML
  if (payload.html && /display:none.*mso-hide:all/i.test(payload.html.replace(/\s+/g,' ')))
                                      ok('hidden preheader span present in HTML');
  else if (payload.html)              fail('hidden preheader span missing from HTML (required for inbox preview)');

  // 4. Plain text
  if (payload.text && payload.text.trim().length > 0) ok('plain-text present');
  else                                fail('plain-text missing or empty');

  // 5. Logo check (branded projects)
  const logoRequired = REQUIRED_LOGOS[project];
  if (logoRequired) {
    if (payload.html && payload.html.includes(logoRequired)) ok(`correct logo found: ${logoRequired}`);
    else if (payload.html)            fail(`required logo '${logoRequired}' not found in HTML`);
  }

  // 6. Astrology-era guard (SkyTuned)
  if (project === 'skytuned' && payload.html) {
    const blocked = ASTROLOGY_BLOCKED.filter(m => payload.html.toLowerCase().includes(m.toLowerCase()));
    if (blocked.length > 0)           fail(`astrology-era content detected: ${blocked.join(', ')}`);
    else                              ok('no astrology-era content detected');
  }

  // 7. Unsubscribe (broadcast projects)
  const broadcastProjects = ['torahtxt', 'skytuned', 'spokesbox'];
  if (broadcastProjects.includes(project)) {
    if (payload.html && /unsubscribe/i.test(payload.html)) ok('unsubscribe link present');
    else if (payload.html)            fail('unsubscribe link missing (required for broadcast emails)');
  }

  // 8. Metadata
  const meta = payload.metadata || {};
  if (meta.project)            ok(`metadata.project = '${meta.project}'`);
  else                         fail('metadata.project missing');

  if (meta.template_version)   ok(`metadata.template_version = '${meta.template_version}'`);
  else                         warn('metadata.template_version missing');

  if (meta.generated_at)       ok(`metadata.generated_at set`);
  else                         warn('metadata.generated_at missing');

  if (meta.from_email)         ok(`metadata.from_email = '${meta.from_email}'`);
  else                         fail('metadata.from_email missing');

  return results;
}

function printResults(project, results) {
  const total   = results.pass.length + results.warn.length + results.fail.length;
  const status  = results.fail.length === 0
    ? (results.warn.length === 0 ? '✅ PASS' : '🟡 PASS WITH WARNINGS')
    : '❌ FAIL';

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`Project: ${project.toUpperCase()}  ${status}`);
  console.log(`${'═'.repeat(55)}`);
  results.pass.forEach(m => console.log(`  ${m}`));
  results.warn.forEach(m => console.log(`  ${m}`));
  results.fail.forEach(m => console.log(`  ${m}`));
  console.log(`${'─'.repeat(55)}`);
  console.log(`  ${results.pass.length} passed · ${results.warn.length} warned · ${results.fail.length} failed / ${total} checks`);

  return results.fail.length === 0;
}

// ─── Test harnesses ─────────────────────────────────────────────────────────

function testTorahTxt() {
  const { buildDailyEmailPayload } = require(path.join(WS, 'torahtxt/email-builder'));
  const dataFile = path.join(WS, 'torahtxt/content/daily');
  const dates = fs.readdirSync(dataFile)
    .filter(f => f.endsWith('.json'))
    .sort().slice(-3); // test last 3 days

  let allPass = true;
  for (const df of dates) {
    const data = JSON.parse(fs.readFileSync(path.join(dataFile, df), 'utf8'));
    const date = df.replace('.json','');
    const payload = buildDailyEmailPayload({
      name: 'Test User',
      date: new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{
        weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}),
      title: data.title,
      parasha: data.title || 'Test Parasha',
      message: data.email || data.sms,
      token: 'test-token',
      email: 'test@example.com',
      kids: data.kids || null,
      sourceDate: date,
    });
    const results = validatePayload(payload, 'torahtxt');
    console.log(`\n  [${date}] ${data.title}`);
    const pass = printResults('torahtxt', results);
    if (!pass) allPass = false;
  }
  return allPass;
}

function testSkyTuned() {
  const { buildSkyTunedEmailPayload } = require(path.join(WS, 'skytuned/email-builder'));
  // Minimal valid content fixture
  const fixture = {
    date: 'Wednesday, May 20, 2026',
    sourceDate: '2026-05-20',
    lead: {
      headline: 'Test Lead Headline',
      body: 'This is the lead story body for testing purposes.',
      links: [{ text: 'Read more', url: 'https://example.com' }],
    },
    missionControl: [
      { label: '🚀 Launches', text: 'Starship IFT-12 targeting today' },
      { label: '📈 Markets',  text: 'RKLB +2.1%  ASTS +0.5%' },
    ],
    spotlight: {
      label: '🔬 Science Spotlight',
      title: 'Test Spotlight Title',
      items: [{ text: 'Spotlight item one' }, { text: 'Spotlight item two' }],
    },
    tonightsSky:  'Waxing Gibbous 81% — good viewing conditions.',
    spaceWeather: 'Kp index: 2 (quiet). Solar flux: 142.',
    socialBuzz:   'Elon Musk tweeted about Starship payload capacity.',
    onThePad: [{ mission: 'Starship IFT-12', date: 'NET Today', notes: 'Pad 2' }],
    marketSnapshot: [
      { ticker: 'RKLB', price: '$22.40', change: '+2.1%' },
      { ticker: 'ASTS', price: '$18.90', change: '+0.5%' },
    ],
  };
  const payload = buildSkyTunedEmailPayload(fixture, { email: 'test@example.com', token: 'tok', name: 'Test' });
  return printResults('skytuned', validatePayload(payload, 'skytuned'));
}

function testSpokesbox() {
  const { buildSpokesboxEmailPayload } = require(path.join(WS, 'spokesbox/email-builder'));
  const brief = {
    greeting: 'Good morning',
    sections: [
      {
        id: 'lead',
        title: 'Top Story',
        emoji: '📰',
        summary: 'A major headline happened today.',
        bullets: ['Detail one', 'Detail two'],
        links: [{ text: 'Read more', url: 'https://example.com' }],
      },
      {
        id: 'sports',
        title: 'Sports',
        emoji: '⚽',
        summary: 'Your team won last night.',
        bullets: ['Final score 3-1'],
        links: [],
      },
    ],
    closing: 'Have a great day!',
  };
  const payload = buildSpokesboxEmailPayload(brief, { email: 'avi@example.com', token: 'tok', name: 'Avi' });
  return printResults('spokesbox', validatePayload(payload, 'spokesbox'));
}

function testTodo() {
  const { buildTodoEmailPayload } = require(path.join(WS, 'todo/email-builder'));
  const sections = [
    { section: '🔴 Time-Sensitive', items: [{ item: 'Pay insurance', status: 'unpaid', notes: 'Due June 16' }] },
    { section: '💰 Money Out',      items: [{ item: 'Chase Ink', status: 'pending', notes: '$8,843.76' }] },
  ];
  const payload = buildTodoEmailPayload(sections, { recipient: 'Jride' });
  return printResults('todo', validatePayload(payload, 'todo'));
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const projArg  = args[args.indexOf('--project') + 1];
const runAll   = args.includes('--all');

const runners = { torahtxt: testTorahTxt, skytuned: testSkyTuned, spokesbox: testSpokesbox, todo: testTodo };

if (runAll || (!projArg && !args.includes('--payload'))) {
  let anyFail = false;
  for (const [name, fn] of Object.entries(runners)) {
    try { if (!fn()) anyFail = true; }
    catch (e) { console.error(`\n❌ ${name} threw: ${e.message}`); anyFail = true; }
  }
  process.exit(anyFail ? 1 : 0);
} else if (projArg && runners[projArg]) {
  try { process.exit(runners[projArg]() ? 0 : 1); }
  catch (e) { console.error(e.message); process.exit(1); }
} else if (args.includes('--payload')) {
  const payloadStr = args[args.indexOf('--payload') + 1];
  const project    = projArg || 'unknown';
  const payload    = JSON.parse(payloadStr);
  const results    = validatePayload(payload, project);
  process.exit(printResults(project, results) ? 0 : 1);
} else {
  console.error('Usage: validate-email-output.js [--all] [--project <name>]');
  process.exit(1);
}
