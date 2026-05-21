'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const sgMail = require('@sendgrid/mail');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { loadSignals } = require('./lib/load_signals');
const { getBrief, saveBrief, getBriefHistory, deleteBrief } = require('./lib/user_brief');
const { generateBriefFromOnboarding, updateBriefFromReply, generateFollowupQuestions } = require('./lib/brief_llm');
const { PROFILE_FIELDS, BRANCH_FIELDS } = require('./lib/profile_fields');

// ── Content Moderation ──────────────────────────────────────────
const HATE_PATTERNS = [
  // Racial slurs and hate terms (regex patterns, case-insensitive)
  /\bn[i\u00ef][g\u011f]{1,2}[e3]r/i,
  /\bk[i\u00ef]k[e3]/i,
  /\bsp[i\u00ef][c\u00e7]/i,
  /\bch[i\u00ef]nk/i,
  /\bgook/i,
  /\bwetback/i,
  /\bbeaner/i,
  /\btr[a@]nny/i,
  /\bf[a@][g9]{1,2}[o0]t/i,
  /\bwhite\s+suprem/i,
  /\bwhite\s+power/i,
  /\bwhite\s+nationalist/i,
  /\bn[a@]z[i1]/i,
  /\bsieg\s+heil/i,
  /\bheil\s+hitler/i,
  /\bkill\s+(all\s+)?(jews|blacks|muslims|hispanics|gays|immigrants)/i,
  /\bdeath\s+to\s+(jews|blacks|muslims|hispanics|gays)/i,
  /\b14\s*words\b/i,
  /\brace\s+war/i,
  /\bgreat\s+replacement/i,
  /\bjudenrat/i,
  /\bjew\s*hate/i,
  /\bant[i\u00ef]\s*semit/i,
];

const HATE_KEYWORDS = [
  'white genocide', 'ethnic cleansing', 'final solution', 'gas the', 'jew world order',
  'ZOG', 'cultural marxism', 'replacement theory', '88 means', 'aryans only',
];

function containsHateSpeech(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  for (const pattern of HATE_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  for (const kw of HATE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return true;
  }
  return false;
}

function moderateObject(obj) {
  // Returns true if any string value in the object contains hate speech
  if (!obj || typeof obj !== 'object') return false;
  for (const val of Object.values(obj)) {
    if (typeof val === 'string' && containsHateSpeech(val)) return true;
    if (typeof val === 'object' && moderateObject(val)) return true;
  }
  return false;
}


// ─── Content Moderation ────────────────────────────────────────────────────────
const BANNED_KEYWORDS = [
  'porn', 'pornography', 'xxx', 'adult content', 'nude', 'nudity', 'naked',
  'escort', 'prostitut', 'sex work', 'onlyfans', 'cam girl', 'strip club',
  'child porn', 'csam', 'lolita', 'underage',
  'kill', 'murder', 'suicide', 'self harm', 'bomb', 'terrorist',
  'drug dealer', 'buy drugs', 'cocaine', 'heroin', 'meth',
  'hack', 'phishing', 'malware', 'ransomware',
];

function moderateContent(text) {
  if (!text || typeof text !== 'string') return { safe: true };
  const lower = text.toLowerCase();
  for (const kw of BANNED_KEYWORDS) {
    if (lower.includes(kw)) {
      return { safe: false, reason: `Prohibited content detected: "${kw}"` };
    }
  }
  return { safe: true };
}

async function moderateWithOpenAI(text) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  return new Promise((resolve) => {
    const body = JSON.stringify({ input: text });
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/moderations',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const result = parsed.results?.[0];
          if (result?.flagged) {
            const cats = Object.entries(result.categories)
              .filter(([, v]) => v).map(([k]) => k);
            resolve({ safe: false, reason: `Content flagged: ${cats.join(', ')}` });
          } else {
            resolve({ safe: true });
          }
        } catch { resolve({ safe: true }); }
      });
    });
    req.on('error', () => resolve({ safe: true }));
    req.setTimeout(3000, () => { req.destroy(); resolve({ safe: true }); });
    req.write(body);
    req.end();
  });
}

async function checkContent(text) {
  const local = moderateContent(text);
  if (!local.safe) return local;
  return await moderateWithOpenAI(text);
}

// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3002;

// ─── Private Beta Gate ────────────────────────────────────────────────────────
// Set SITE_PASSWORD in .env to enable. Unset/blank = gate disabled (public).
// Set BETA_MODE=true to show beta-specific UI copy.
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';
const BETA_MODE     = process.env.BETA_MODE === 'true';

// In-memory session store: token → expiresAtMs
// Suitable for single-server private beta with O(100) testers.
// Replace with Redis/DB-backed store if multi-server deployment is needed.
const betaSessions = new Map();
const BETA_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx < 1) return;
    const k = decodeURIComponent(pair.slice(0, idx).trim());
    const v = decodeURIComponent(pair.slice(idx + 1).trim());
    out[k] = v;
  });
  return out;
}

function isBetaSession(req) {
  if (!SITE_PASSWORD) return true; // gate disabled
  const cookies = parseCookies(req);
  const token = cookies.sb_beta;
  if (!token) return false;
  const entry = betaSessions.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) { betaSessions.delete(token); return false; }
  return true;
}

// Paths that never require authentication (monitoring, unsubscribe, gate itself)
const BETA_EXEMPT_RE = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|webp|map)$/i;
function isBetaExempt(req) {
  const p = req.path;
  if (!SITE_PASSWORD) return true;
  if (p === '/health')                   return true;
  if (p.startsWith('/beta-login'))       return true;
  if (p.startsWith('/webhook/'))         return true;
  if (p === '/unsubscribe')              return true;
  if (BETA_EXEMPT_RE.test(p))            return true;
  return false;
}

function betaGateMiddleware(req, res, next) {
  if (isBetaExempt(req)) return next();
  if (isBetaSession(req)) return next();

  // API / wizard calls from an unauthenticated session → 401
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/wizard/')) {
    return res.status(401).json({ error: 'beta_auth_required', message: 'Private beta — authentication required.' });
  }

  // Browser navigations → redirect to login page
  const next_url = encodeURIComponent(req.originalUrl);
  return res.redirect(302, `/beta-login?next=${next_url}`);
}

// Purge expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of betaSessions) {
    if (now > entry.expiresAt) betaSessions.delete(token);
  }
}, 60 * 60 * 1000).unref();

// ─── Social Enrichment Feature Flag ──────────────────────────────────────────
// Single authoritative flag. Must be explicitly 'true' — absent/undefined/false
// all leave it off. All call sites that make external social-data calls, enqueue
// enrichment jobs, or surface inferred signals must check this flag first.
const SOCIAL_ENRICHMENT_ENABLED = process.env.SOCIAL_ENRICHMENT_ENABLED === 'true';
if (!SOCIAL_ENRICHMENT_ENABLED) {
  console.log('[social] Social enrichment is DISABLED. Wizard and preview run from explicit answers only.');
}

// ─── SendGrid ─────────────────────────────────────────────────────────────────
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ─── DB ───────────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'subscribers.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    zip_code TEXT,
    city TEXT,
    state TEXT,
    timezone TEXT DEFAULT 'America/New_York',
    delivery_time TEXT DEFAULT '07:00',
    tone TEXT DEFAULT 'warm',
    newsletter_length TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'trial',
    trial_start TEXT DEFAULT (datetime('now')),
    trial_end TEXT DEFAULT (datetime('now', '+7 days')),
    -- TODO P2 Q3-2026: Drop stripe_customer_id + stripe_subscription_id once confirmed no payment revival.
    --   SQLite < 3.35 has no ALTER TABLE DROP COLUMN — do it deliberately with a table-rebuild migration.
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    plan TEXT,
    preferences TEXT DEFAULT '{}',
    wizard_complete INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id INTEGER,
    topic TEXT,
    enabled INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 5,
    notes TEXT,
    FOREIGN KEY(subscriber_id) REFERENCES subscribers(id)
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id INTEGER,
    email_date TEXT,
    feedback_text TEXT,
    processed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(subscriber_id) REFERENCES subscribers(id)
  );

  CREATE TABLE IF NOT EXISTS wizard_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE,
    email TEXT,
    step INTEGER DEFAULT 0,
    answers TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS social_profile_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    source_url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    raw_payload_json TEXT,
    fetched_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS social_insight_rollups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    top_topics_json TEXT,
    subtopics_json TEXT,
    locations_json TEXT,
    tone_preference TEXT,
    sports_teams_json TEXT,
    finance_interest_level TEXT,
    politics_interest_level TEXT,
    newsletter_modules_json TEXT,
    confidence REAL,
    evidence_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS job_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_name TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    run_after DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );
  CREATE TABLE IF NOT EXISTS user_briefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id INTEGER NOT NULL UNIQUE REFERENCES subscribers(id) ON DELETE CASCADE,
    brief_text TEXT NOT NULL,
    brief_version INTEGER NOT NULL DEFAULT 1,
    last_edited_by TEXT NOT NULL CHECK(last_edited_by IN ('user','llm','system')),
    last_edited_at DATETIME NOT NULL DEFAULT (datetime('now')),
    created_at DATETIME NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS user_brief_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    brief_text TEXT NOT NULL,
    brief_version INTEGER NOT NULL,
    edited_by TEXT NOT NULL CHECK(edited_by IN ('user','llm','system')),
    edited_at DATETIME NOT NULL,
    edit_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_brief_history_sub_ver
    ON user_brief_history(subscriber_id, brief_version);

  -- ── Brief Tuning PR 1 ──────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS brief_profiles (
    subscriber_id  INTEGER PRIMARY KEY REFERENCES subscribers(id) ON DELETE CASCADE,
    version        INTEGER NOT NULL DEFAULT 1,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS brief_interests (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id  INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    bucket         TEXT    NOT NULL,
    subtopic       TEXT,
    specificity    TEXT,
    weight         REAL    NOT NULL DEFAULT 1.0,
    depth          TEXT    NOT NULL DEFAULT 'standard'
                     CHECK(depth IN ('headline', 'standard', 'deep')),
    notes          TEXT,
    source         TEXT    NOT NULL DEFAULT 'user_feedback'
                     CHECK(source IN ('user_feedback', 'sam_onboarding_seed', 'manual')),
    confidence     TEXT    NOT NULL DEFAULT 'high'
                     CHECK(confidence IN ('high', 'medium', 'low')),
    is_exclusion   INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_brief_interests_sub
    ON brief_interests(subscriber_id, is_exclusion, weight);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_brief_interests_unique
    ON brief_interests(subscriber_id, bucket, COALESCE(subtopic, ''));

  CREATE TABLE IF NOT EXISTS brief_entities (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    interest_id    INTEGER NOT NULL REFERENCES brief_interests(id) ON DELETE CASCADE,
    entity_type    TEXT    NOT NULL
                     CHECK(entity_type IN ('team','person','company','ticker','place','topic')),
    entity_value   TEXT    NOT NULL,
    weight         REAL    NOT NULL DEFAULT 1.0,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_brief_entities_interest
    ON brief_entities(interest_id);

  CREATE TABLE IF NOT EXISTS brief_feedback (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id  INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    token_id       TEXT,
    action         TEXT    NOT NULL
                     CHECK(action IN ('more','less','mute','unmute','add','remove','edit')),
    context_bucket TEXT,
    context_label  TEXT,
    context_date   TEXT,
    applied_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_brief_feedback_sub_date
    ON brief_feedback(subscriber_id, applied_at);

  CREATE TABLE IF NOT EXISTS tune_tokens (
    id             TEXT    PRIMARY KEY,
    subscriber_id  INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    action         TEXT    NOT NULL,
    payload        TEXT,
    issued_at      INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL,
    used_at        INTEGER,
    use_count      INTEGER NOT NULL DEFAULT 0,
    max_uses       INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_tune_tokens_sub
    ON tune_tokens(subscriber_id, expires_at);

  CREATE TABLE IF NOT EXISTS brief_source_suggestions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id  INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    bucket         TEXT    NOT NULL,
    suggested_source TEXT  NOT NULL,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
`);

// ─── DB Migration Helper ───────────────────────────────────────────────────────
/**
 * Safely add a column to a table only if it doesn't already exist.
 * SQLite doesn't support IF NOT EXISTS on ALTER TABLE, so we check PRAGMA.
 */
function addColumnIfMissing(table, column, colDef) {
  try {
    const cols = db.prepare(`PRAGMA table_info("${table}")`).all();
    if (!cols.some(c => c.name === column)) {
      db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${colDef}`);
      console.log(`[DB] Migration: added ${table}.${column}`);
    }
  } catch (err) {
    console.error(`[DB] Migration failed for ${table}.${column}:`, err.message);
  }
}

// Run all migrations
[
  ['subscribers', 'age_range',        'TEXT'],
  ['subscribers', 'sports_detail',    'TEXT'],
  ['subscribers', 'finance_detail',   'TEXT'],
  ['subscribers', 'book_genres',      'TEXT'],
  ['subscribers', 'tech_focus',       'TEXT'],
  ['subscribers', 'health_focus',     'TEXT'],
  ['subscribers', 'trial_active',        'INTEGER DEFAULT 0'],
  ['subscribers', 'trial_started_at',    'TEXT'],
  ['subscribers', 'gender_identity',     'TEXT'],
  ['subscribers', 'cultural_background', 'TEXT'],
  ['subscribers', 'college_sports',      'TEXT'],
  ['subscribers', 'career_focus',        'TEXT'],
  ['subscribers', 'social_linkedin',     'TEXT'],
  ['subscribers', 'social_instagram',    'TEXT'],
  ['subscribers', 'social_twitter',      'TEXT'],
  ['subscribers', 'social_reddit',       'TEXT'],
  ['subscribers', 'social_facebook',     'TEXT'],
  ['subscribers', 'template_style',      'TEXT DEFAULT \'modern\''],
  ['subscribers', 'music_detail',        'TEXT'],
  ['subscribers', 'movies_tv_detail',    'TEXT'],
  ['subscribers', 'local_showtimes',          'INTEGER DEFAULT 0'],
  ['subscribers', 'onboarding_email_sent',    'INTEGER DEFAULT 0'],
  ['subscribers', 'onboarding_completed_at',  'TEXT'],
  // social_insight_rollups — enrichment signal columns
  ['social_insight_rollups', 'enriched_at',      'TEXT'],
  ['social_insight_rollups', 'entities_json',    'TEXT'],
  ['social_insight_rollups', 'engagement_json',  'TEXT'],
  ['social_insight_rollups', 'source_provider',  "TEXT DEFAULT 'brightdata'"],
  ['social_insight_rollups', 'error',            'TEXT'],
].forEach(([t, c, d]) => addColumnIfMissing(t, c, d));

// ─── Wizard Questions ──────────────────────────────────────────────────────────
/**
 * MAIN_QUESTIONS: the primary wizard flow (v2 — 4 visible steps).
 * section: maps to sidebar step highlight key
 * The 'complete' type is handled as a terminal state (not shown as a step).
 * Cut questions (demographics, delivery_time, etc.) are in lib/profile_fields.js.
 */
const MAIN_QUESTIONS = [
  {
    idx: 0, key: 'email_and_name', section: 'identity',
    question: "Let's get started",
    type: 'email_and_name',
    placeholder_email: 'your@email.com',
    placeholder_name:  'First name'
  },
  {
    idx: 1, key: 'zip_code', section: 'location',
    question: "What's your ZIP code?",
    sub: "We'll use this for local news and weather.",
    type: 'zip_code_with_social',
    placeholder: 'e.g. 10001',
    social_placeholder: 'LinkedIn or other profile URL (optional)'
  },
  {
    idx: 2, key: 'topics', section: 'topics',
    question: "What would you like in your newsletter?",
    sub: "Pick at least 3.",
    type: 'multi',
    min_selections: 3,
    display: 'tile_grid',
    groups: [
      { id: 'group_news_locals',  label: 'News & Locals',  topics: ['Local News','World News','Politics','Weather'] },
      { id: 'group_interests',    label: 'Your Interests', topics: ['Sports','Finance','Technology','Health Tips','Food & Recipes','Travel','Books & Reading','Music','Movies & TV','Career Tips'] },
      { id: 'group_just_for_fun', label: 'Just for Fun',   topics: ['Humor/Jokes','Fun Facts','Pets','History'] }
    ],
    options: [
      'Local News','World News','Politics','Weather','Sports','Finance','Technology',
      'Health Tips','Food & Recipes','Travel','Books & Reading','Music','Movies & TV',
      'Career Tips','Humor/Jokes','Fun Facts','Pets','History'
    ]
  },
  {
    idx: 3, key: 'preview', section: 'preview',
    question: "Here's a preview of your daily brief ✨",
    type: 'preview',
    editable_fields: ['delivery_time', 'tone']
  },
  {
    idx: 4, key: 'complete', section: 'done',
    type: 'complete'
  }
];

// BRANCH_QUESTIONS and TOPIC_TO_BRANCH moved to lib/profile_fields.js (as BRANCH_FIELDS).
// They are no longer injected during wizard dispatch.

// ─── Social Profile Interest Inference ──────────────────────────────────────
const INTEREST_MAP = {
  'Sports':           ['nba','nfl','mlb','nhl','soccer','basketball','football','baseball','hockey','tennis','golf','espn','sports','athlete','game','playoffs','championship'],
  'Finance & Markets':['invest','stock','market','finance','portfolio','trading','equity','vc','venture','startup','fintech','crypto','bitcoin','nasdaq'],
  'Technology':       ['software','engineer','developer','tech','ai','machine learning','startup','saas','product','code','programming','silicon','founder','cto','ceo'],
  'Politics':         ['policy','government','democrat','republican','congress','senate','vote','election','political','legislation'],
  'Local News':       ['nj','new jersey','essex','newark','montclair','maplewood','south orange','hoboken','jersey'],
  'Health & Fitness': ['fitness','workout','running','marathon','yoga','wellness','health','nutrition','gym','crossfit'],
  'Books & Reading':  ['book','reading','author','novel','literature','nonfiction','kindle','library','bookclub'],
  'College Sports':   ['ncaa','college football','college basketball','march madness','cfb','cbb','rivalry','bowl game','recruiting','espn college'],
  'Career Tips':      ['hiring','job search','linkedin','resume','interview','promoted','new role','career','recruiter','layoff','open to work'],
};

function fetchPublicPage(url, redirectCount = 0) {
  const TIMEOUT_MS = 6000;
  if (redirectCount > 4) return Promise.resolve('');

  const fetchPromise = new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return resolve('');
      const mod = parsed.protocol === 'https:' ? https : require('http');
      const req = mod.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Spokesbox/1.0)' },
        timeout: TIMEOUT_MS
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const loc = res.headers['location'];
          res.resume(); // consume response to free socket
          if (loc) return fetchPublicPage(loc, redirectCount + 1).then(resolve).catch(() => resolve(''));
          return resolve('');
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; if (data.length > 200000) req.destroy(); });
        res.on('end', () => resolve(data));
        res.on('error', () => resolve(''));
      });
      req.on('error', () => resolve(''));
      req.on('timeout', () => { req.destroy(); resolve(''); });
    } catch (e) { resolve(''); }
  });

  const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(''), TIMEOUT_MS + 500));
  return Promise.race([fetchPromise, timeoutPromise]);
}

function extractTextFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .slice(0, 20000);
}

// Engagement signal patterns — things people comment/like/share about
// Covers Facebook groups/likes/pages, Instagram captions, LinkedIn posts, Reddit activity
const ENGAGEMENT_SIGNALS = {
  'College Sports':  ['march madness','college football','cfb','cbb','ncaa','rivalry','bowl game','alumni','my team','we won','beat ','boomer sooner','roll tide','go blue','hook em','go dawgs','let\'s go '],
  'Career Tips':     ['new job','promoted','open to work','hiring','looking for','excited to announce','joined','started at','recruiter','interview','accepting connections','my next chapter'],
  'Finance':         ['bought','selling','portfolio','my stocks','invested','crypto','btc','eth','dividend','roi','returns','the market','earnings','short','long position'],
  'Technology':      ['built this','shipped','launched','my app','product hunt','open source','side project','just released','github','deployed','v1.0'],
  'Health & Fitness':['personal record','miles today','workout','ran a','lifted','meal prep','clean eating','30 days','steps today','gym','5k','half marathon'],
  'Travel':          ['just landed','flying to','road trip','checked in','airport','hotel','travel tip','bucket list','passport','new country','day trip'],
  'Food & Recipes':  ['made this','recipe','cooked','restaurant','tasted','delicious','homemade','baked','trying this','food porn','what i ate'],
  'Parenting':       ['my kid','my daughter','my son','proud parent','school','bedtime','toddler','first day','report card','soccer practice','proud of my'],
  'Pets':            ['my dog','my cat','puppy','paw','vet','fetch','meow','woof','adopted','rescue dog','fur baby','good boy','good girl'],
  'Entertainment':   ['watching','just finished','binge','season finale','new episode','can\'t stop watching','10/10','recommend','theater','movie night'],
  'Politics':        ['voted','my rep','congress','senate','the president','policy','ballot','election','campaign','agree with','disagree with'],
  'Local Events':    ['this weekend','local event','community','neighborhood','downtown','farmer\'s market','live music','free event','happening near'],
  // Facebook-specific: group membership and page likes signal strong interests
  'Sports':          ['game day','let\'s go','touchdown','goal!','playoff','bracket','fantasy team','my pick','watch party'],
  'Books & Reading': ['just finished reading','book club','currently reading','on my nightstand','page-turner','highly recommend','book review'],
  'Humor/Jokes':     ['dying 😂','lmao','this is me','can\'t stop laughing','mood','literally me','same','dead 💀'],
};

// ── College team name extraction ──────────────────────────────────────────────
const COLLEGE_TEAMS = [
  'Alabama','Clemson','Georgia','Ohio State','Michigan','Texas','Oklahoma','Notre Dame',
  'USC','UCLA','Florida','Florida State','LSU','Penn State','Oregon','Tennessee',
  'Auburn','Miami','Nebraska','Colorado','Iowa','Wisconsin','Duke','North Carolina',
  'Kentucky','Kansas','Arizona','Gonzaga','Syracuse','Villanova','UConn','Purdue',
  'Indiana','Illinois','Minnesota','Texas A&M','Arkansas','Ole Miss','Mississippi State',
  'TCU','Baylor','West Virginia','Virginia Tech','Virginia','NC State','Wake Forest',
  'Pitt','Boston College','Stanford','Cal','Washington','Utah','BYU','Cincinnati',
  'Louisville','Memphis','Houston','Tulsa','SMU','Rice','Army','Navy','Air Force',
  'UNLV','San Diego State','Boise State','Fresno State','Colorado State','Wyoming',
];
// Suffixes that often appear with college names in social posts
const COLLEGE_SUFFIXES = ['football','basketball','hoops','nation','fans','alumni','athletics','longhorns','bulldogs','wolverines','buckeyes','sooners','cowboys','wildcats','tigers','gators','tar heels','blue devils','jayhawks'];

// ── Career/industry extraction from LinkedIn headlines & job titles ────────────
const CAREER_PATTERNS = [
  // Pattern: look for job-title-like phrases near common LinkedIn structures
  /(?:i am|i'm|currently|former|ex-|senior|lead|head of|director of|vp of|manager of|engineer at|works? (?:at|in|for)|experience in|background in)\s+([\w\s&,]{3,40})/gi,
  // LinkedIn headline pattern: "Title at Company"
  /([\w\s]{2,30})\s+at\s+[A-Z][\w\s]{1,30}/g,
  // "10 years in X" or "worked in X"
  /(?:years? in|worked in|career in|industry:|field:)\s+([\w\s&]{3,30})/gi,
];

async function inferInterestsFromUrls(urls) {
  const inferred = new Set();
  const signals = [];
  const engagementHits = {};
  const extracted = {    // specific entities extracted from profiles
    college: null,
    career: null,
    sports_teams: [],
  };

  for (const url of urls) {
    if (!url || typeof url !== 'string' || !url.trim()) continue;
    const html = await fetchPublicPage(url.trim());
    const text = extractTextFromHtml(html);
    if (!text) continue;
    const isLinkedIn = url.includes('linkedin.com');
    const isFacebook = url.includes('facebook.com');

    // ── Standard interest detection from profile bio/content ─────────────────
    for (const [topic, keywords] of Object.entries(INTEREST_MAP)) {
      for (const kw of keywords) {
        if (text.includes(kw.toLowerCase())) {
          if (!inferred.has(topic)) {
            inferred.add(topic);
            signals.push({ keyword: kw, source: 'profile', topic });
          }
          break;
        }
      }
    }

    // ── Engagement signal detection — things they post/like/comment about ─────
    for (const [topic, patterns] of Object.entries(ENGAGEMENT_SIGNALS)) {
      let hits = 0;
      for (const pattern of patterns) {
        if (text.includes(pattern.toLowerCase())) hits++;
      }
      if (hits >= 2) {
        engagementHits[topic] = (engagementHits[topic] || 0) + hits;
      }
    }

    // ── College team extraction ───────────────────────────────────────────────
    if (!extracted.college) {
      const ltext = text.toLowerCase();
      for (const team of COLLEGE_TEAMS) {
        const tl = team.toLowerCase();
        // Check for team name + a college suffix or standalone with context
        const hasSuffix = COLLEGE_SUFFIXES.some(s => ltext.includes(tl + ' ' + s) || ltext.includes(s + ' ' + tl));
        const hasAlumni = ltext.includes(tl) && (ltext.includes('alumni') || ltext.includes('alum') || ltext.includes('class of') || ltext.includes('grad'));
        const hasFandom = ltext.includes('go ' + tl) || ltext.includes(tl + ' fan') || ltext.includes('#' + tl.replace(' ',''));
        if (hasSuffix || hasAlumni || hasFandom) {
          extracted.college = team;
          if (!inferred.has('College Sports')) {
            inferred.add('College Sports');
            signals.push({ keyword: team, source: 'college', topic: 'College Sports' });
          }
          break;
        }
      }
    }

    // ── Career/industry extraction from LinkedIn ──────────────────────────────
    if (isLinkedIn && !extracted.career) {
      for (const pattern of CAREER_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(text);
        if (match && match[1]) {
          const candidate = match[1].trim().replace(/\s+/g, ' ');
          // Filter noise — must be at least 3 chars and not a stop phrase
          const stopWords = ['the','and','with','for','not','but','all','any','can','our','your','their','this','that','from','have','been','will','also','more','some','them','than','into'];
          const words = candidate.toLowerCase().split(' ');
          if (candidate.length >= 3 && !stopWords.includes(words[0])) {
            extracted.career = candidate;
            if (!inferred.has('Career Tips')) {
              inferred.add('Career Tips');
              signals.push({ keyword: candidate, source: 'career', topic: 'Career Tips' });
            }
            break;
          }
        }
      }
    }

    // ── Facebook: extract liked pages / groups as topic signals ──────────────
    if (isFacebook) {
      // Facebook pages/groups often appear as headers or nav items
      const fbSections = text.match(/(?:likes?|follows?|member of|joined)\s+["']?([\w\s&]{3,40})["']?/gi) || [];
      for (const section of fbSections) {
        const cleaned = section.replace(/^(?:likes?|follows?|member of|joined)\s+/i,'').replace(/["']/g,'').trim();
        // Check against all interest signals
        for (const [topic, keywords] of Object.entries(INTEREST_MAP)) {
          for (const kw of keywords) {
            if (cleaned.toLowerCase().includes(kw)) {
              if (!inferred.has(topic)) {
                inferred.add(topic);
                signals.push({ keyword: cleaned, source: 'facebook_page', topic });
              }
              break;
            }
          }
        }
        // College team check on Facebook page names
        if (!extracted.college) {
          for (const team of COLLEGE_TEAMS) {
            if (cleaned.toLowerCase().includes(team.toLowerCase())) {
              extracted.college = team;
              if (!inferred.has('College Sports')) {
                inferred.add('College Sports');
                signals.push({ keyword: cleaned, source: 'facebook_page', topic: 'College Sports' });
              }
              break;
            }
          }
        }
      }
    }
  }

  // Add engagement-inferred topics (require 2+ hits to avoid noise)
  for (const [topic, hits] of Object.entries(engagementHits)) {
    if (!inferred.has(topic)) {
      inferred.add(topic);
      signals.push({ keyword: `${hits} post signals`, source: 'engagement', topic });
    }
  }

  // Build display-friendly signal labels
  const signalLabels = signals.map(s => {
    if (s.source === 'college')       return `🎓 ${s.keyword} fan detected`;
    if (s.source === 'career')        return `💼 ${s.keyword}`;
    if (s.source === 'facebook_page') return `👍 Page: ${s.keyword}`;
    if (s.source === 'engagement')    return `${s.topic} (from your posts)`;
    return s.keyword;
  });

  return {
    inferred: Array.from(inferred),
    signals: signalLabels,
    extracted  // college name, career field — used to skip/pre-fill branch questions
  };
}

// ─── Newsletter Preview Generator ─────────────────────────────────────────────
function escHtmlServer(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Per-topic section content for the preview newsletter */
const TOPIC_SECTION_GENERATORS = {
  'Sports': (answers, signals = {}) => {
    // Signals branch: personalize if sports_teams available
    try {
      const teams = signals.entities && Array.isArray(signals.entities.sports_teams) ? signals.entities.sports_teams : [];
      const college = signals.entities && signals.entities.college ? signals.entities.college : null;
      if (teams.length > 0 || college) {
        const teamName = teams.length > 0 ? escHtmlServer(teams[0]) : 'Warriors';
        const trackLine = answers.sports_detail
          ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Tracking: ${escHtmlServer(answers.sports_detail)}</div>`
          : '';
        return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">🏆</span><span class="section-title">Sports Highlights</span></div>
      <div class="item">
        <div class="item-headline">${teamName} snap 3-game skid with dominant performance</div>
        <div class="item-summary">Their star player drops 38 points in a dominant home win. The 3-point shooting was the decisive factor in a game that wasn't as close as the final score suggests.</div>
        <div class="item-meta">12 min ago · ESPN</div>
      </div>
      <div class="item">
        <div class="item-headline">NFL Draft: Cowboys trade up to land top receiver prospect</div>
        <div class="item-summary">Dallas moved up to #7 overall, adding an explosive playmaker to what should be a revamped offense next season. Team officials called it "the move we've been planning all year."</div>
        <div class="item-meta">2h ago · NFL.com</div>
      </div>
      ${trackLine}
    </div>`;
      }
    } catch (_) { /* fall through to static */ }
    return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">🏆</span><span class="section-title">Sports Highlights</span></div>
      <div class="item">
        <div class="item-headline">Warriors snap 3-game skid with dominant performance</div>
        <div class="item-summary">Stephen Curry drops 38 points as Golden State cruises past the Clippers 118–97. His 3-point shooting (7/12) was the decisive factor in a game that wasn't as close as the final score suggests.</div>
        <div class="item-meta">12 min ago · ESPN</div>
      </div>
      <div class="item">
        <div class="item-headline">NFL Draft: Cowboys trade up to land top receiver prospect</div>
        <div class="item-summary">Dallas moved up to #7 overall, adding an explosive playmaker to what should be a revamped offense next season. Team officials called it "the move we've been planning all year."</div>
        <div class="item-meta">2h ago · NFL.com</div>
      </div>
      ${answers.sports_detail ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Tracking: ${escHtmlServer(answers.sports_detail)}</div>` : ''}
    </div>`;
  },

  'Finance': (answers, signals = {}) => {
    // Signals branch: personalize if finance-related industry
    try {
      const industry = (signals.entities && signals.entities.industry) ? signals.entities.industry.toLowerCase() : '';
      const financeKeywords = ['finance', 'invest', 'trading', 'banking', 'fintech', 'vc'];
      if (industry && financeKeywords.some(k => industry.includes(k))) {
        const trackLine = answers.finance_detail
          ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Tracking: ${escHtmlServer(answers.finance_detail)}</div>`
          : `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Tracking: market trends relevant to your sector</div>`;
        return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">📈</span><span class="section-title">Market Movers</span></div>
      <div class="item">
        <div class="item-headline">S&amp;P 500 closes at record high as tech earnings impress</div>
        <div class="item-summary">The index gained 1.4% Friday after blowout earnings from major tech names. Analysts are watching whether momentum continues into next week's Fed meeting.</div>
        <div class="item-meta">Market Close · Bloomberg</div>
      </div>
      <div class="item">
        <div class="item-headline">Bitcoin surges past $95K — what analysts are saying</div>
        <div class="item-summary">Crypto markets are rallying amid renewed institutional interest. Several ETF issuers reported record inflows this week, with Bitcoin now up 22% YTD.</div>
        <div class="item-meta">3h ago · CoinDesk</div>
      </div>
      ${trackLine}
    </div>`;
      }
    } catch (_) { /* fall through to static */ }
    return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">📈</span><span class="section-title">Market Movers</span></div>
      <div class="item">
        <div class="item-headline">S&amp;P 500 closes at record high as tech earnings impress</div>
        <div class="item-summary">The index gained 1.4% Friday after blowout earnings from major tech names. Analysts are watching whether momentum continues into next week's Fed meeting.</div>
        <div class="item-meta">Market Close · Bloomberg</div>
      </div>
      <div class="item">
        <div class="item-headline">Bitcoin surges past $95K — what analysts are saying</div>
        <div class="item-summary">Crypto markets are rallying amid renewed institutional interest. Several ETF issuers reported record inflows this week, with Bitcoin now up 22% YTD.</div>
        <div class="item-meta">3h ago · CoinDesk</div>
      </div>
      ${answers.finance_detail ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Tracking: ${escHtmlServer(answers.finance_detail)}</div>` : ''}
    </div>`;
  },

  'Technology': (answers, signals = {}) => {
    // Signals branch: personalize if tech-related industry
    try {
      const industry = (signals.entities && signals.entities.industry) ? signals.entities.industry.toLowerCase() : '';
      const techKeywords = ['software', 'tech', 'engineering', 'product', 'data', 'ai', 'developer'];
      if (industry && techKeywords.some(k => industry.includes(k))) {
        const introLine = `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">💡 Curated for your interest in the tech industry</div>`;
        return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">💻</span><span class="section-title">Tech Briefing</span></div>
      ${introLine}
      <div class="item">
        <div class="item-headline">OpenAI announces GPT-5 with major reasoning leap and lower prices</div>
        <div class="item-summary">The new model scores in the top 1% on competitive programming benchmarks. Pricing drops 60% from the previous generation, opening the door for smaller teams.</div>
        <div class="item-meta">6h ago · The Verge</div>
      </div>
      <div class="item">
        <div class="item-headline">Apple Vision Pro 2 reportedly ships lighter and cheaper in Q4</div>
        <div class="item-summary">Supply chain sources point to a thinner design and a $2,499 price point — a significant drop from the original's $3,499 launch price. Pre-orders expected this summer.</div>
        <div class="item-meta">Yesterday · 9to5Mac</div>
      </div>
      ${answers.tech_focus ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Focus: ${escHtmlServer(answers.tech_focus)}</div>` : ''}
    </div>`;
      }
    } catch (_) { /* fall through to static */ }
    return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">💻</span><span class="section-title">Tech Briefing</span></div>
      <div class="item">
        <div class="item-headline">OpenAI announces GPT-5 with major reasoning leap and lower prices</div>
        <div class="item-summary">The new model scores in the top 1% on competitive programming benchmarks. Pricing drops 60% from the previous generation, opening the door for smaller teams.</div>
        <div class="item-meta">6h ago · The Verge</div>
      </div>
      <div class="item">
        <div class="item-headline">Apple Vision Pro 2 reportedly ships lighter and cheaper in Q4</div>
        <div class="item-summary">Supply chain sources point to a thinner design and a $2,499 price point — a significant drop from the original's $3,499 launch price. Pre-orders expected this summer.</div>
        <div class="item-meta">Yesterday · 9to5Mac</div>
      </div>
      ${answers.tech_focus ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Focus: ${escHtmlServer(answers.tech_focus)}</div>` : ''}
    </div>`;
  },

  'Local News': (answers, signals = {}) => {
    // Signals branch: personalize headline if city is available
    try {
      const city = signals.entities && signals.entities.location && signals.entities.location.city
        ? signals.entities.location.city : null;
      if (city) {
        return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">📰</span><span class="section-title">Local Update</span></div>
      <div class="item">
        <div class="item-headline">${escHtmlServer(city)} city updates: Council approves downtown revitalization plan</div>
        <div class="item-summary">The package targets the arts district with new mixed-use development and public transit improvements expected by late 2027.</div>
        <div class="item-meta">1h ago · Local News</div>
      </div>
      <div class="item">
        <div class="item-headline">New restaurant row opens in ${escHtmlServer(city)} this weekend</div>
        <div class="item-summary">Five new dining concepts open Saturday as part of the corridor's redevelopment. Early buzz is strong — especially the wood-fired taco spot.</div>
        <div class="item-meta">Today · Local Eats</div>
      </div>
    </div>`;
      }
    } catch (_) { /* fall through to static */ }
    return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">📰</span><span class="section-title">Local Update</span></div>
      <div class="item">
        <div class="item-headline">City Council approves $42M downtown revitalization plan</div>
        <div class="item-summary">Approved 6-1, the package targets the arts district with new mixed-use development and public transit improvements expected by late 2027.</div>
        <div class="item-meta">1h ago · Local News</div>
      </div>
      <div class="item">
        <div class="item-headline">New restaurant row opens along Main St. this weekend</div>
        <div class="item-summary">Five new dining concepts open Saturday as part of the corridor's redevelopment. Early buzz is strong — especially the wood-fired taco spot at #22.</div>
        <div class="item-meta">Today · Local Eats</div>
      </div>
    </div>`;
  },

  'Weather': (answers) => `
    <div class="section">
      <div class="section-header"><span class="section-emoji">⛅</span><span class="section-title">Your Weather</span></div>
      <div class="weather-box">
        <div>
          <div class="weather-temp">72°F</div>
          <div class="weather-desc">Partly Cloudy</div>
          <div class="weather-loc">${answers._city ? escHtmlServer(answers._city + ', ' + answers._state) : 'Your area'}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px;opacity:0.9;">High 76° / Low 61°</div>
          <div style="font-size:13px;opacity:0.9;margin-top:4px;">Wind: 8 mph SE</div>
          <div style="font-size:13px;opacity:0.9;margin-top:4px;">Humidity: 58%</div>
        </div>
      </div>
      <div style="font-size:13px;color:#6b7280;margin-top:8px;">Perfect day to be outside! Clouds clear up around noon. No rain until Wednesday.</div>
    </div>`,

  'Health Tips': (answers) => `
    <div class="section">
      <div class="section-header"><span class="section-emoji">💪</span><span class="section-title">Health &amp; Wellness</span></div>
      <div class="item">
        <div class="item-headline">The 5-minute evening habit that improves sleep quality</div>
        <div class="item-summary">New research confirms that brief gratitude journaling before bed reduces cortisol and improves sleep onset by an average of 14 minutes.</div>
        <div class="item-meta">Health.com</div>
      </div>
      <div class="item">
        <div class="item-headline">Why walking after meals beats hitting the gym</div>
        <div class="item-summary">Studies show a 10-minute post-meal walk reduces blood sugar spikes 30% more effectively than a 30-minute workout at other times of day.</div>
        <div class="item-meta">Nutrition Today</div>
      </div>
      ${answers.health_focus ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Focus: ${escHtmlServer(answers.health_focus)}</div>` : ''}
    </div>`,

  'Fitness': (answers) => `
    <div class="section">
      <div class="section-header"><span class="section-emoji">🏃</span><span class="section-title">Fitness</span></div>
      <div class="item">
        <div class="item-headline">The 3-2-1 workout method trainers swear by</div>
        <div class="item-summary">3 strength days, 2 cardio sessions, 1 mobility day per week — the framework pro athletes use for longevity without burnout.</div>
        <div class="item-meta">Men's Health</div>
      </div>
      <div class="item">
        <div class="item-headline">Best morning routines under 20 minutes</div>
        <div class="item-summary">Cold shower, 7-minute bodyweight circuit, protein within 30 minutes of waking — the trifecta backed by sleep scientists and performance coaches alike.</div>
        <div class="item-meta">Outside Magazine</div>
      </div>
      ${answers.health_focus ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Focus: ${escHtmlServer(answers.health_focus)}</div>` : ''}
    </div>`,

  'Music': (answers) => {
    const genres = answers.music_detail
      ? (Array.isArray(answers.music_detail) ? answers.music_detail.slice(0,3).join(' / ') : answers.music_detail)
      : null;
    return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">🎵</span><span class="section-title">Music${genres ? ' — ' + escHtmlServer(genres) : ''}</span></div>
      <div class="item">
        <div class="item-headline">New albums dropping this week</div>
        <div class="item-summary">${genres ? escHtmlServer(genres) + ' fans: the week’s most anticipated releases, tour announcements, and the stories behind the tracks making noise right now.' : 'This week’s most anticipated releases, tour announcements, and the stories behind the tracks making noise right now.'}</div>
        <div class="item-meta">Rolling Stone</div>
      </div>
      <div class="item">
        <div class="item-headline">🎶 You might also like…</div>
        <div class="item-summary">Based on your taste, we’ve found an artist you haven’t heard yet but probably should. Personalized discovery, daily.</div>
        <div class="item-meta">Spokesbox Picks</div>
      </div>
      ${answers.music_detail ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Genres: ${escHtmlServer(genres)}</div>` : ''}
    </div>`;
  },

  'Movies & TV': (answers) => {
    const genres = answers.movies_tv_detail
      ? (Array.isArray(answers.movies_tv_detail) ? answers.movies_tv_detail.slice(0,3).join(' / ') : answers.movies_tv_detail)
      : null;
    return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">🎬</span><span class="section-title">Movies &amp; TV${genres ? ' — ' + escHtmlServer(genres) : ''}</span></div>
      <div class="item">
        <div class="item-headline">This week’s must-watch</div>
        <div class="item-summary">${genres ? escHtmlServer(genres) + ' picks: new releases, streaming drops, critic scores, and what’s actually worth your time this week.' : 'New releases, streaming drops, critic scores, and what’s actually worth your time this week.'}</div>
        <div class="item-meta">Rotten Tomatoes / Variety</div>
      </div>
      <div class="item">
        <div class="item-headline">🎬 What to watch next…</div>
        <div class="item-summary">Based on your genre preferences, here’s a title you may have missed that matches your taste perfectly.</div>
        <div class="item-meta">Spokesbox Picks</div>
      </div>
      ${answers.movies_tv_detail ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Genres: ${escHtmlServer(genres)}</div>` : ''}
    </div>`;
  },

  'Entertainment': () => `
    <div class="section">
      <div class="section-header"><span class="section-emoji">🎬</span><span class="section-title">Entertainment</span></div>
      <div class="item">
        <div class="item-headline">"The Last Frame" breaks streaming records in opening weekend</div>
        <div class="item-summary">The psychological thriller racked up 48M views in 3 days — the biggest non-franchise debut in platform history. Critics and audiences both agree: it's must-watch TV.</div>
        <div class="item-meta">Variety</div>
      </div>
      <div class="item">
        <div class="item-headline">Taylor Swift adds 8 more dates to Eras Tour</div>
        <div class="item-summary">After selling out arenas in hours, the extended run broke TicketMaster's queue record again. Tickets go live Tuesday at 10am local time.</div>
        <div class="item-meta">Rolling Stone</div>
      </div>
    </div>`,

  'Politics': () => `
    <div class="section">
      <div class="section-header"><span class="section-emoji">🏛️</span><span class="section-title">Politics</span></div>
      <div class="item">
        <div class="item-headline">Senate passes bipartisan infrastructure bill 58–41</div>
        <div class="item-summary">The $220B package allocates funds for broadband expansion, bridge repairs, and clean energy grid upgrades. It heads to the House where passage is expected but timing uncertain.</div>
        <div class="item-meta">Reuters</div>
      </div>
      <div class="item">
        <div class="item-headline">Poll: Voter satisfaction with local government hits 10-year high</div>
        <div class="item-summary">A new Gallup survey shows 63% of Americans rate their local government positively — driven largely by infrastructure and public safety improvements.</div>
        <div class="item-meta">Gallup</div>
      </div>
    </div>`,

  'Food & Recipes': () => `
    <div class="section">
      <div class="section-header"><span class="section-emoji">🍳</span><span class="section-title">Food &amp; Recipes</span></div>
      <div class="item">
        <div class="item-headline">The 15-minute dinner taking over TikTok</div>
        <div class="item-summary">Crispy smashed potatoes with whipped feta and hot honey. Three ingredients, one pan, zero effort. Millions of home cooks are calling it the perfect weeknight meal.</div>
        <div class="item-meta">Bon Appétit</div>
      </div>
      <div class="item">
        <div class="item-headline">Best breakfast burritos in America — ranked by food writers</div>
        <div class="item-summary">200+ burritos tasted across 40 cities. The winner? A family-run spot in Albuquerque open since 1987. Recipe included in today's full issue.</div>
        <div class="item-meta">Eater</div>
      </div>
    </div>`,

  'Books & Reading': (answers) => `
    <div class="section">
      <div class="section-header"><span class="section-emoji">📚</span><span class="section-title">Books &amp; Reading</span></div>
      <div class="item">
        <div class="item-headline">This week's #1: "The Cartographer of Lost Places" by Elena Vasquez</div>
        <div class="item-summary">A sweeping historical novel spanning three continents and four generations. Publishers Weekly calls it "the rare book that makes you feel more human."</div>
        <div class="item-meta">NYT Bestseller List</div>
      </div>
      <div class="item">
        <div class="item-headline">Amazon's editor picks for May: 10 books you won't put down</div>
        <div class="item-summary">From a debut thriller set in 1940s Havana to a breezy essay collection about food and identity — something for every kind of reader.</div>
        <div class="item-meta">Amazon Books</div>
      </div>
      ${answers.book_genres ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Your genres: ${escHtmlServer(answers.book_genres)}</div>` : ''}
    </div>`,

  'Humor/Jokes': () => `
    <div class="section">
      <div class="section-header"><span class="section-emoji">😄</span><span class="section-title">Daily Laughs</span></div>
      <div class="item">
        <div class="item-headline">Today's joke 🎭</div>
        <div class="item-summary" style="font-style:italic;">"I told my doctor I broke my arm in two places. He told me to stop going to those places."</div>
      </div>
      <div class="item">
        <div class="item-headline">Fun fact of the day 🧠</div>
        <div class="item-summary">Honey never spoils — archaeologists have found 3,000-year-old honey in Egyptian tombs that was still perfectly edible.</div>
      </div>
    </div>`,

  'College Sports': (answers) => {
    const team = answers.college_sports ? escHtmlServer(answers.college_sports) : 'Your Team';
    return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">🎓</span><span class="section-title">${team} — College Sports</span></div>
      <div class="item">
        <div class="item-headline">${team} holds on late to win 78–71</div>
        <div class="item-summary">A dominant second half and 22 points from the sophomore guard sealed it. The win pushes them to 3rd in the conference with 4 games left in the regular season.</div>
        <div class="item-meta">Last night · ESPN College</div>
      </div>
      <div class="item">
        <div class="item-headline">5-star recruit commits — biggest signing in 6 years</div>
        <div class="item-summary">The No. 12 overall prospect in the class chose ${team} over two blue-blood programs, citing the coaching staff and early playing time opportunity.</div>
        <div class="item-meta">Yesterday · 247Sports</div>
      </div>
      <div class="item">
        <div class="item-headline">Rankings update: ${team} moves up 4 spots to #18</div>
        <div class="item-summary">Back-to-back wins against ranked opponents earned the jump. AP poll voters cited improved defense and bench depth as key factors.</div>
        <div class="item-meta">This week · AP Poll</div>
      </div>
    </div>`;
  },

  'Career Tips': (answers) => {
    const role = answers.career_focus ? escHtmlServer(answers.career_focus) : null;
    const roleLabel = role ? `in ${role}` : 'in your field';
    const roleTag = role ? `<div class="item-meta" style="font-style:italic;color:#9ca3af;margin-top:8px;">📌 Tracking opportunities ${roleLabel}</div>` : '';
    return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">💼</span><span class="section-title">Career &amp; Opportunities</span></div>
      <div class="item">
        <div class="item-headline">Why the best companies are hiring now — even in a slow market</div>
        <div class="item-summary">Counter-cyclical hiring is surging ${roleLabel}. Companies that hire during soft periods consistently outperform those that wait — and the talent pool is unusually strong.</div>
        <div class="item-meta">Harvard Business Review</div>
      </div>
      <div class="item">
        <div class="item-headline">LinkedIn reports: These 5 skills tripled in demand this quarter</div>
        <div class="item-summary">AI fluency, systems thinking, and cross-functional communication top the list — even for non-technical roles. Employers say they're harder to find than technical skills.</div>
        <div class="item-meta">LinkedIn Workforce Report</div>
      </div>
      <div class="item">
        <div class="item-headline">📊 Featured opportunities ${roleLabel} this week</div>
        <div class="item-summary">Curated roles matching your background — remote-friendly, at companies hiring actively right now. Updated daily from job boards, not aggregators.</div>
        <div class="item-meta">Spokesbox Jobs</div>
      </div>
      ${roleTag}
    </div>`;
  },

  'Local Services Directory': (answers) => {
    const city = answers._city || 'Springfield';
    const state = answers._state || 'IL';
    const zip = answers.zip_code || '62701';
    const location = `${city}, ${state} ${zip}`;
    return `
    <div class="section">
      <div class="section-header"><span class="section-emoji">🏠</span><span class="section-title">Local Services &amp; Emergency Resources</span></div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:16px;">📍 Near ${escHtmlServer(location)} — highly rated, no referral marketplaces</div>

      <!-- Emergency -->
      <div style="margin-bottom:18px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#dc2626;margin-bottom:10px;border-bottom:1px solid #fee2e2;padding-bottom:4px;">🚨 Emergency</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#1a2744;">🏥 Memorial Hospital ER</div>
            <div style="font-size:12px;color:#4a5568;margin-top:2px;">123 Hospital Dr — Open 24/7</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">⭐⭐⭐⭐⭐ 4.8 (1,243 reviews)</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:13px;font-weight:700;color:#dc2626;">(217) 555-0100</div>
            <div style="font-size:11px;color:#9ca3af;">ER Direct Line</div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#1a2744;">🚒 Non-Emergency Police</div>
            <div style="font-size:12px;color:#4a5568;margin-top:2px;">Springfield Police Dept</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:13px;font-weight:700;color:#1a2744;">(217) 555-0911</div>
          </div>
        </div>
      </div>

      <!-- Home Repair -->
      <div style="margin-bottom:18px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#0369a1;margin-bottom:10px;border-bottom:1px solid #dbeafe;padding-bottom:4px;">🔧 Home Repair &amp; Maintenance</div>

        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#1a2744;">🚰 Rivers Edge Plumbing</div>
            <div style="font-size:12px;color:#4a5568;margin-top:2px;">Licensed &amp; insured • Same-day service</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">⭐⭐⭐⭐⭐ 4.9 (387 reviews) • Google</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:13px;font-weight:700;color:#0369a1;">(217) 555-0234</div>
            <div style="font-size:11px;color:#9ca3af;">24/7 Emergency</div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#1a2744;">⚡ Bright Side Electric</div>
            <div style="font-size:12px;color:#4a5568;margin-top:2px;">Family owned since 1988 • Free estimates</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">⭐⭐⭐⭐⭐ 4.8 (512 reviews) • Google</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:13px;font-weight:700;color:#0369a1;">(217) 555-0378</div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#1a2744;">❄️ Capitol Heating &amp; Cooling</div>
            <div style="font-size:12px;color:#4a5568;margin-top:2px;">HVAC • Maintenance plans available</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">⭐⭐⭐⭐½ 4.7 (298 reviews) • Google</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:13px;font-weight:700;color:#0369a1;">(217) 555-0415</div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#1a2744;">🔨 Mike&apos;s Home Services</div>
            <div style="font-size:12px;color:#4a5568;margin-top:2px;">Handyman • Small jobs welcome</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">⭐⭐⭐⭐⭐ 4.9 (204 reviews) • Google</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:13px;font-weight:700;color:#0369a1;">(217) 555-0561</div>
          </div>
        </div>
      </div>

      <!-- Outdoor -->
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#059669;margin-bottom:10px;border-bottom:1px solid #d1fae5;padding-bottom:4px;">🌿 Outdoor &amp; Lawn</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#1a2744;">🌱 Green Thumb Lawn Care</div>
            <div style="font-size:12px;color:#4a5568;margin-top:2px;">Weekly mowing • Seasonal cleanup</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">⭐⭐⭐⭐½ 4.6 (176 reviews) • Google</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:13px;font-weight:700;color:#059669;">(217) 555-0692</div>
          </div>
        </div>
      </div>

      <div style="margin-top:14px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;font-style:italic;">📍 Listings sourced from Google. Min. rating 4.5⭐. No Angi, Thumbtack, or referral fees — direct numbers only.</div>
    </div>`;
  },
};

function generateTopicSection(topic, answers, signals = {}) {
  const fn = TOPIC_SECTION_GENERATORS[topic];
  if (fn) return fn(answers, signals);
  // Generic fallback for unlisted topics
  return `<div class="section">
    <div class="section-header"><span class="section-emoji">📌</span><span class="section-title">${escHtmlServer(topic)}</span></div>
    <div class="item"><div class="item-summary">Your personalized <strong>${escHtmlServer(topic)}</strong> content will appear here every day.</div></div>
  </div>`;
}

// Safe industry label allowlist — never expose raw employer/title/school
const SAFE_INDUSTRY_LABELS = {
  tech: 'technology', software: 'technology', engineering: 'technology',
  product: 'product', data: 'data & analytics', ai: 'AI & machine learning',
  finance: 'finance', invest: 'finance & investing', trading: 'finance & investing',
  banking: 'finance & investing', fintech: 'fintech',
  marketing: 'marketing', design: 'design', healthcare: 'healthcare',
  science: 'science', education: 'education',
};

/**
 * Generates a beautiful mock newsletter HTML based on user answers.
 * Used for the preview step and /api/wizard/preview endpoint.
 * @param {object} answers - Session answers object
 * @param {string|null} suggestions - Optional user suggestions for revision (noted in preview)
 * @param {string|null} subscriberEmail - Email for footer links
 * @param {object} signals - Enrichment signals from loadSignals()
 */
function generateNewsletterPreview(answers, suggestions = null, subscriberEmail = null, signals = {}) {
  const name = (answers.name || '').trim() || null; // null = no name known yet
  const parsedTopics = answers.topics
    ? (Array.isArray(answers.topics) ? answers.topics : answers.topics.split(',').map(t => t.trim()).filter(Boolean))
    : [];
  // Fall back to sensible defaults if no valid topics were saved
  const rawTopics = parsedTopics.length > 0 ? parsedTopics : ['Local News', 'Weather', 'Health Tips', 'Entertainment'];

  // Show up to 4 sections in the preview
  const selectedTopics = rawTopics.slice(0, 4);

  // Live preview date
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    timeZone: 'America/New_York'
  });

  // Tone-based greeting
  const tone = answers.tone || 'Warm & friendly';
  let greeting;
  const hi = name ? name : null;
  if (tone.includes('Upbeat'))      greeting = hi ? `Hey ${hi}! ☀️ Here's your daily dose:`        : `Hey! ☀️ Here's your daily dose:`;
  else if (tone.includes('Informative')) greeting = hi ? `Good morning, ${hi}. Here's your briefing:` : `Good morning. Here's your briefing:`;
  else                               greeting = hi ? `Good morning, ${hi}! ☀️ Here's what's happening today:` : `Good morning! ☀️ Here's what's happening today:`;

  // Count how many topics fired the signals branch
  let signalHits = 0;
  const sections = selectedTopics.map(t => {
    const html = generateTopicSection(t, answers, signals);
    // Check if signals branch fired: source is not 'none' and this topic has a signals-capable generator
    if (signals && signals.source && signals.source !== 'none') {
      const signaledTopics = ['Sports', 'Finance', 'Technology', 'Local News'];
      if (signaledTopics.includes(t)) signalHits++;
    }
    return html;
  }).join('');

  // Task 7: "Tuned for you" banner (brightdata source only, city+category, no PII)
  let personalizationBanner = '';
  if (signals && signals.source === 'brightdata') {
    const city = signals.entities && signals.entities.location && signals.entities.location.city
      ? signals.entities.location.city : null;
    const rawIndustry = (signals.entities && signals.entities.industry) ? signals.entities.industry.toLowerCase() : '';
    const safeLabel = rawIndustry
      ? (Object.entries(SAFE_INDUSTRY_LABELS).find(([k]) => rawIndustry.includes(k)) || [null, null])[1]
      : null;
    if (city || safeLabel) {
      const parts = [];
      if (city) parts.push(escHtmlServer(city));
      const connector = city && safeLabel ? ' and your interest in ' : (safeLabel ? 'your interest in ' : '');
      if (safeLabel) parts.push('your interest in ' + escHtmlServer(safeLabel));
      const bannerText = city && safeLabel
        ? `Here's a brief shaped by ${escHtmlServer(city)} and your interest in ${escHtmlServer(safeLabel)}.`
        : city
          ? `Here's a brief shaped by ${escHtmlServer(city)}.`
          : `Here's a brief shaped by your interest in ${escHtmlServer(safeLabel)}.`;
      personalizationBanner = `<div class="personalization-banner" style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#166534;">
  ✨ Tuned for you: ${bannerText}
</div>`;
    }
  }

  const suggestionNote = suggestions
    ? `<div style="background:#fff8e1;border:2px solid #FFD166;border-radius:10px;padding:14px 18px;margin-bottom:24px;font-size:13px;color:#795900;">
        <strong>✏️ Your feedback applied:</strong> "${escHtmlServer(suggestions.slice(0, 200))}"
      </div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f0f4f8; color: #1A2744; }
  .wrapper { max-width: 580px; margin: 0 auto; background: white; }
  .header { background: #1A2744; padding: 28px 36px; }
  .header-logo { color: #00B4D8; font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
  .header-date { color: #718096; font-size: 12px; margin-top: 6px; }
  .greeting-bar { background: #00B4D8; padding: 14px 36px; color: white; font-size: 15px; font-weight: 600; line-height: 1.4; }
  .body { padding: 28px 36px; }
  .section { margin-bottom: 28px; border-bottom: 1px solid #e5e7eb; padding-bottom: 24px; }
  .section:last-child { border-bottom: none; margin-bottom: 0; }
  .section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .section-emoji { font-size: 18px; }
  .section-title { font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #1A2744; }
  .item { margin-bottom: 14px; }
  .item:last-child { margin-bottom: 0; }
  .item-headline { font-size: 14px; font-weight: 600; color: #1A2744; line-height: 1.4; margin-bottom: 4px; }
  .item-summary { font-size: 13px; color: #4a5568; line-height: 1.6; }
  .item-meta { font-size: 11px; color: #9ca3af; margin-top: 4px; }
  .weather-box { background: linear-gradient(135deg, #00B4D8, #0096b7); color: white; border-radius: 10px; padding: 18px 22px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
  .weather-temp { font-size: 32px; font-weight: 700; }
  .weather-desc { font-size: 13px; opacity: 0.9; margin-top: 2px; }
  .weather-loc { font-size: 11px; opacity: 0.7; margin-top: 2px; }
  .footer { background: #1A2744; padding: 20px 36px; text-align: center; }
  .footer p { color: #4a5568; font-size: 11px; margin: 3px 0; }
  .footer a { color: #00B4D8; text-decoration: none; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header" style="text-align:center;">
    <img src="https://spokesbox.com/spokesbox-logo.png" alt="Spokesbox" style="height:48px;width:auto;display:block;margin:0 auto 8px;">
    <div class="header-date">${dateStr}</div>
  </div>
  <div class="greeting-bar">${escHtmlServer(greeting)}</div>
  <div class="body">
    ${personalizationBanner}
    ${suggestionNote}
    ${sections}
  </div>
  <div class="footer">
    ${subscriberEmail ? (() => {
      const tok = generateToken(subscriberEmail);
      const enc = encodeURIComponent(subscriberEmail);
      return `<p>© 2026 Spokesbox · <a href="https://spokesbox.com/unsubscribe?token=${tok}&email=${enc}">Unsubscribe</a> · <a href="https://spokesbox.com/profile?email=${enc}&token=${tok}">📝 Review & update your brief</a></p>`;
    })() : '<p>© 2026 Spokesbox · <a href="#">Unsubscribe</a> · <a href="#">Update preferences</a></p>'}
    <p style="margin-top:6px;color:#4a5568;font-size:10px;font-style:italic;">This is a preview — your real newsletter will be personalized daily.</p>
  </div>
</div>
</body>
</html>`;

  // Task 10: Structured log line (no entity values, only score+source+counts)
  const personalizationScore = selectedTopics.length > 0 ? Math.round((signalHits / selectedTopics.length) * 100) : 0;
  console.log(JSON.stringify({
    event: 'preview.rendered',
    session: answers._session_id || 'unknown',
    signals_source: (signals && signals.source) || 'none',
    personalization_score: personalizationScore,
    topic_count: selectedTopics.length
  }));

  return html;
}

// ─── Mock Section Builder (for preview templates) ──────────────────────────────
const MOCK_SECTION_DATA = {
  'Local News': { emoji: '🏙️', items: [
    { headline: 'South Orange approves $2.4M downtown park renovation', summary: 'The project will add green space, seating, and a new playground on Valley St. Construction starts next month.', meta: 'South Orange Patch' },
    { headline: 'NJ Transit announces weekend service changes on Morris & Essex lines', summary: 'Bus substitutions in effect through June for track maintenance. Full schedule at njtransit.com.', meta: 'NJ Transit' }
  ]},
  'Weather': { emoji: '⛅', items: [
    { headline: 'Today: Partly cloudy, high of 72°F', summary: 'A beautiful late-April day with mild winds out of the southwest. Overnight low around 54°F.', meta: 'National Weather Service' },
    { headline: 'Weekend outlook: Showers Saturday, sunny Sunday', summary: 'Expect 0.4" of rain Saturday afternoon. Sunday clears up perfectly for outdoor plans.', meta: 'Weather.com' }
  ]},
  'Health Tips': { emoji: '💪', items: [
    { headline: 'Study: 10 minutes of daily walking cuts heart disease risk by 18%', summary: 'Harvard researchers tracked 72,000 adults over five years. Even small amounts of movement showed significant cardiovascular benefits.', meta: 'NEJM' },
    { headline: 'Sleep scientists recommend this one habit before bed', summary: 'Cutting screen time 30 minutes before sleep increased deep sleep by an average of 22 minutes per night in a new Stanford study.', meta: 'Sleep Foundation' }
  ]},
  'Sports': { emoji: '🏆', items: [
    { headline: 'Yankees hold off Red Sox 5-3 in extras', summary: 'Aaron Judge walked it off in the 11th with a two-run shot. His 12th homer of the season puts him on pace for 58.', meta: 'ESPN' },
    { headline: 'Knicks advance to Eastern Conference Finals', summary: 'Jalen Brunson drops 41 in Game 6 to seal the series. New York faces Boston starting Thursday.', meta: 'NBA' }
  ]},
  'Finance': { emoji: '📈', items: [
    { headline: 'S&P 500 closes at record high on strong earnings reports', summary: 'Tech and energy sectors led gains as Q1 earnings beat expectations. Fed minutes due Wednesday could shift momentum.', meta: 'WSJ Markets' },
    { headline: 'Mortgage rates dip to 6.7% — lowest since September', summary: 'A slight pullback in 10-year Treasury yields gave homebuyers a brief window of relief. Experts say it may not last.', meta: 'Bankrate' }
  ]},
  'Technology': { emoji: '💻', items: [
    { headline: 'Apple announces M4 chip for MacBook lineup, ships next month', summary: 'The new silicon promises 40% performance gains over M3 in machine learning tasks. Starting price unchanged at $1,299.', meta: 'The Verge' },
    { headline: 'OpenAI releases new reasoning model beating GPT-4 on benchmarks', summary: 'The unnamed model shows dramatic improvements in math, coding, and logical inference — with a smaller footprint.', meta: 'TechCrunch' }
  ]},
  'Entertainment': { emoji: '🎬', items: [
    { headline: 'Netflix drops surprise trailer for "The Cartographer" — premieres May 15', summary: 'Based on the bestselling novel, this 8-episode limited series already has critics calling it the best drama of 2026.', meta: 'Variety' },
    { headline: 'Taylor Swift announces stadium tour extension through December', summary: 'Eight new North American dates added by popular demand. Presale begins Thursday at 10am ET.', meta: 'Billboard' }
  ]},
  'Politics': { emoji: '🏛️', items: [
    { headline: 'Senate passes infrastructure spending bill 58-42', summary: 'The $600B package funds bridges, broadband, and clean energy grid upgrades. Now heads to the House where passage is uncertain.', meta: 'Reuters' },
    { headline: 'Governor signs new housing density law, preempting local zoning', summary: 'NJ becomes the 7th state to allow accessory dwelling units statewide. Housing advocates call it a landmark shift.', meta: 'NJ.com' }
  ]},
  'Food & Recipes': { emoji: '🍳', items: [
    { headline: 'The 15-minute dinner taking over TikTok', summary: 'Crispy smashed potatoes with whipped feta and hot honey. Three ingredients, one pan, zero effort.', meta: 'Bon Appétit' },
    { headline: 'Best breakfast burritos in America — ranked by food writers', summary: '200+ burritos tested across 40 cities. The winner is a family-run spot in Albuquerque open since 1987.', meta: 'Eater' }
  ]},
  'Travel': { emoji: '✈️', items: [
    { headline: 'The 10 most underrated cities to visit in 2026', summary: 'From Tbilisi to Medellín — travel writers share the destinations that surprised them most this year.', meta: 'Condé Nast Traveler' },
    { headline: 'Budget airline wars: flights from NYC to Europe for under $300', summary: 'A new round of competition between carriers is driving transatlantic fares to 5-year lows this fall.', meta: 'The Points Guy' }
  ]},
  'Fitness': { emoji: '🏃', items: [
    { headline: 'The 20-minute workout that outperforms an hour at the gym', summary: 'High-intensity interval training with four simple bodyweight exercises. No equipment, just consistency.', meta: 'Men\'s Health' },
    { headline: 'Why your warm-up matters more than your workout', summary: 'New research shows 10 minutes of dynamic stretching cuts injury risk by 31% and improves peak performance.', meta: 'Runner\'s World' }
  ]},
  'Books & Reading': { emoji: '📚', items: [
    { headline: 'This week\'s #1: "The Cartographer of Lost Places"', summary: 'A sweeping historical novel spanning three continents. Publishers Weekly calls it "the rare book that makes you feel more human."', meta: 'NYT Bestseller List' },
    { headline: 'Amazon\'s editor picks for May: 10 books you won\'t put down', summary: 'From a debut thriller set in 1940s Havana to a breezy essay collection about food and identity.', meta: 'Amazon Books' }
  ]},
  'Humor/Jokes': { emoji: '😄', items: [
    { headline: 'Today\'s joke 🎭', summary: '"I told my doctor I broke my arm in two places. He told me to stop going to those places."', meta: '' },
    { headline: 'Fun fact of the day 🧠', summary: 'Honey never spoils — archaeologists have found 3,000-year-old honey in Egyptian tombs that was still perfectly edible.', meta: '' }
  ]},
  'Pets': { emoji: '🐾', items: [
    { headline: 'Vets reveal the one food you\'re giving your dog that\'s secretly bad for them', summary: 'Grapes top the list — even a small amount can cause acute kidney failure in dogs of any size or breed.', meta: 'AVMA' },
    { headline: 'Cat enrichment ideas that actually work, according to animal behaviorists', summary: 'Puzzle feeders, window perches, and 15 minutes of directed play beat expensive cat trees every time.', meta: 'Cat Behavior Associates' }
  ]},
  'Parenting': { emoji: '👨‍👩‍👧', items: [
    { headline: 'Screen time and sleep: new guidelines from the American Academy of Pediatrics', summary: 'Updated recommendations for ages 2-12 focus on content quality over strict time limits. What parents need to know.', meta: 'AAP' },
    { headline: 'The summer activity that actually cuts back-to-school anxiety', summary: 'Unstructured outdoor play — not academic prep — is the single biggest predictor of first-day confidence, per new research.', meta: 'Child Development Quarterly' }
  ]},
  'Career Tips': { emoji: '💼', items: [
    { headline: 'The LinkedIn move that gets recruiters to reach out first', summary: 'Adding a specific "Open to Work" banner targeting exact job titles triples inbound recruiter messages, per LinkedIn data.', meta: 'LinkedIn News' },
    { headline: 'Why negotiating salary still pays off — even in a tough market', summary: 'Workers who negotiate first offers earn 7-14% more over their career. Scripts and timing tips inside.', meta: 'Harvard Business Review' }
  ]},
  'History': { emoji: '📜', items: [
    { headline: 'On this day in 1945: UN Charter signed in San Francisco', summary: '50 nations gathered to establish the framework for international cooperation and collective security still in use today.', meta: 'History.com' },
    { headline: 'The forgotten inventor who gave us modern air conditioning', summary: 'Willis Carrier\'s 1902 "Apparatus for Treating Air" transformed not just comfort, but productivity, health, and urban migration patterns forever.', meta: 'Smithsonian Magazine' }
  ]},
  'Local Events': { emoji: '📅', items: [
    { headline: 'South Orange Farmers Market kicks off May 4th season', summary: 'Over 30 vendors, live music, and the return of the beloved Roamside Cafe food truck every Saturday 9am–1pm.', meta: 'Village of South Orange' },
    { headline: 'Upcoming community events this week', summary: 'Library book sale (Fri 4-7pm), Rec center open gym (Sat 10am), Newcomers welcome mixer (Sun 3pm at The Woodland).', meta: 'Community Board' }
  ]},
};

function buildMockSections(topics) {
  const selected = Array.isArray(topics) ? topics.slice(0, 4) : [];
  return selected.map(topic => {
    const data = MOCK_SECTION_DATA[topic] || {
      emoji: '📌',
      items: [
        { headline: `Your ${topic} update`, summary: `Personalized ${topic} content and news tailored for you will appear here every morning.`, meta: 'Spokesbox' }
      ]
    };
    return { topic, emoji: data.emoji, title: topic.toUpperCase(), items: data.items };
  });
}

// ─── Newsletter Template: renderNewsletter router ────────────────────────────
async function renderNewsletter({ subscriber, topics, sections, date }) {
  const style = subscriber.template_style || 'modern';
  const email = subscriber.email;
  const token = crypto.createHmac('sha256', 'spokesbox-secret-2026').update(email).digest('hex');
  const profileUrl = `https://spokesbox.com/profile?email=${encodeURIComponent(email)}&token=${token}`;
  const resolvedSections = sections || buildMockSections(topics);
  const resolvedDate = date || new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    timeZone: 'America/New_York'
  });
  const data = {
    name: subscriber.name || 'Friend',
    topics,
    tone: subscriber.tone,
    sections: resolvedSections,
    date: resolvedDate,
    email,
    profileUrl
  };
  switch (style) {
    case 'newspaper': return generateNewspaperTemplate(data);
    case 'magazine':  return generateMagazineTemplate(data);
    case 'comic':     return generateComicTemplate(data);
    case 'minimal':   return generateMinimalTemplate(data);
    default:          return await generateNewsletterPreview(
      { name: data.name, topics: topics.map(t => (typeof t === 'object' ? t.topic : t)), tone: data.tone },
      null, email
    );
  }
}

// ─── Template 2: Newspaper ────────────────────────────────────────────────────
function generateNewspaperTemplate({ name, sections, date, email, profileUrl }) {
  const now = new Date();
  const edition = Math.ceil((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const unsubUrl = `https://spokesbox.com/unsubscribe?token=${crypto.createHmac('sha256','spokesbox-secret-2026').update(email).digest('hex')}&email=${encodeURIComponent(email)}`;
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }).toUpperCase();
  const fullDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });

  const DATELINE = 'SOUTH ORANGE, N.J.';

  const renderLeadStory = (sec) => {
    if (!sec || !sec.items || !sec.items.length) return '';
    const lead = sec.items[0];
    const rest = sec.items.slice(1);
    return `
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:10px 24px 14px;border-bottom:2px solid #000;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#333;margin-bottom:8px;">${escHtmlServer(sec.title.toUpperCase())}</div>
          <div style="font-family:'Times New Roman',Times,Georgia,serif;font-size:26px;font-weight:700;color:#000;line-height:1.15;margin-bottom:8px;">${escHtmlServer(lead.headline)}</div>
          <div style="font-family:'Times New Roman',Times,Georgia,serif;font-size:15px;font-style:italic;color:#333;line-height:1.5;margin-bottom:10px;border-bottom:1px solid #ccc;padding-bottom:10px;">${escHtmlServer(lead.summary)}</div>
          <div style="font-family:'Times New Roman',Times,Georgia,serif;font-size:13px;color:#000;line-height:1.7;"><span style="font-variant:small-caps;font-weight:700;">${DATELINE} —</span> ${escHtmlServer(lead.summary)} ${rest.map(r => escHtmlServer(r.summary)).join(' ')}</div>
          <div style="font-family:Arial,sans-serif;font-size:10px;color:#777;margin-top:6px;font-style:italic;">By Staff Reporter &nbsp;|&nbsp; ${escHtmlServer(date)}</div>
        </td></tr>
      </table>`;
  };

  const renderColumn = (secs) => secs.map(sec => {
    if (!sec || !sec.items) return '';
    return `<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #ccc;">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#fff;background:#000;padding:3px 6px;display:inline-block;margin-bottom:8px;">${escHtmlServer(sec.title.toUpperCase())}</div>
      ${sec.items.map((item, i) => `
        <div style="margin-bottom:${i < sec.items.length - 1 ? '10px' : '0'};">
          <div style="font-family:'Times New Roman',Times,Georgia,serif;font-size:15px;font-weight:700;color:#000;line-height:1.25;margin-bottom:3px;">${escHtmlServer(item.headline)}</div>
          <div style="font-family:'Times New Roman',Times,Georgia,serif;font-size:12px;color:#222;line-height:1.6;">${escHtmlServer(item.summary)}</div>
          ${item.meta ? `<div style="font-family:Arial,sans-serif;font-size:10px;color:#888;margin-top:3px;font-style:italic;">— ${escHtmlServer(item.meta)}</div>` : ''}
        </div>`).join('<div style="height:1px;background:#e0e0e0;margin:8px 0;"></div>')}
    </div>`;
  }).join('');

  const leadSection = sections[0];
  const cols = sections.slice(1);
  const leftCols = cols.filter((_, i) => i % 2 === 0);
  const rightCols = cols.filter((_, i) => i % 2 === 1);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>* { box-sizing: border-box; } body { margin: 0; padding: 0; background: #e8e4dc; }</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8e4dc;">
<tr><td align="center" style="padding:20px 12px;">
<table width="620" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f5;border:1px solid #bbb;font-family:'Times New Roman',Times,Georgia,serif;">

  <!-- VERY TOP RULE -->
  <tr><td style="padding:0;"><table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="height:4px;background:#000;"></td>
  </tr></table></td></tr>

  <!-- FLAGS ROW: Edition info | Date | Price (above masthead) -->
  <tr><td style="padding:5px 16px;border-bottom:1px solid #999;border-top:1px solid #999;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr valign="middle">
      <td style="font-family:Arial,sans-serif;font-size:9px;color:#555;">Vol. 1, No. ${edition} &nbsp;&middot;&nbsp; Est. 2026</td>
      <td align="center" style="font-family:Arial,sans-serif;font-size:9px;color:#555;">${fullDate}</td>
      <td align="right" style="font-family:Arial,sans-serif;font-size:9px;font-weight:700;color:#000;">FREE</td>
    </tr></table>
  </td></tr>

  <!-- MASTHEAD: white band with logo -->
  <tr><td style="background:#ffffff;padding:20px 24px 12px;text-align:center;border-bottom:3px solid #2bbcd4;">
    <img src="https://spokesbox.com/spokesbox-logo.png" alt="Spokesbox" style="height:90px;width:auto;display:block;margin:0 auto;">
  </td></tr>

  <!-- South Orange, NJ edition note -->
  <tr><td style="background:#f0f0f0;padding:5px 16px;border-bottom:1px solid #999;text-align:center;">
    <span style="font-family:Arial,sans-serif;font-size:9px;color:#555;letter-spacing:1px;text-transform:uppercase;">South Orange, NJ &nbsp;&middot;&nbsp; ${dayName} Edition</span>
  </td></tr>

  <!-- DOUBLE RULE -->
  <tr><td style="padding:0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="height:3px;background:#000;"></td></tr>
      <tr><td style="height:2px;background:#faf9f5;"></td></tr>
      <tr><td style="height:1px;background:#000;"></td></tr>
    </table>
  </td></tr>

  <!-- SECTION NAV -->
  <tr><td style="padding:0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${['LOCAL','MARKETS','SPORTS','TECH','LIFESTYLE','WEATHER'].map((tab, i) =>
        `<td align="center" style="font-family:Arial,sans-serif;font-size:9px;font-weight:700;color:#fff;background:#000;padding:5px 4px;letter-spacing:1px;${i > 0 ? 'border-left:1px solid #444;' : ''}">${tab}</td>`
      ).join('')}
    </tr></table>
  </td></tr>

  <!-- THIN RULE -->
  <tr><td style="height:1px;background:#000;padding:0;"></td></tr>

  <!-- PERSONAL EDITION NOTE -->
  <tr><td style="padding:8px 16px 6px;border-bottom:1px solid #000;background:#faf9f5;">
    <p style="font-family:'Times New Roman',Times,Georgia,serif;font-size:12px;color:#333;font-style:italic;margin:0;text-align:center;">Personal Edition prepared for <strong>${escHtmlServer(name)}</strong> &nbsp;&middot;&nbsp; ${escHtmlServer(date)}</p>
  </td></tr>

  <!-- LEAD STORY -->
  <tr><td style="padding:0;">${renderLeadStory(leadSection)}</td></tr>

  <!-- TWO-COLUMN BODY -->
  <tr><td style="padding:14px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr valign="top">
      <td width="47%" style="padding-right:10px;">${renderColumn(leftCols)}</td>
      <td width="6%" style="border-left:1px solid #999;">&nbsp;</td>
      <td width="47%" style="padding-left:10px;">${renderColumn(rightCols)}</td>
    </tr></table>
  </td></tr>

  <!-- BOTTOM RULE -->
  <tr><td style="padding:0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="height:1px;background:#000;"></td></tr>
      <tr><td style="height:2px;background:#faf9f5;"></td></tr>
      <tr><td style="height:3px;background:#000;"></td></tr>
    </table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:10px 16px;text-align:center;background:#faf9f5;">
    <p style="font-family:Arial,sans-serif;font-size:10px;color:#666;margin:0;">
      &copy; 2026 Spokesbox &middot; Your personal daily edition &middot;
      <a href="${unsubUrl}" style="color:#666;text-decoration:underline;">Unsubscribe</a> &middot;
      <a href="${profileUrl}" style="color:#666;text-decoration:underline;">Update your brief</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}


// ─── Template 3: Magazine ─────────────────────────────────────────────────────
function generateMagazineTemplate({ name, sections, date, email, profileUrl }) {
  const now = new Date();
  const dayOfYear = Math.ceil((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/New_York' });
  const unsubUrl = `https://spokesbox.com/unsubscribe?token=${crypto.createHmac('sha256','spokesbox-secret-2026').update(email).digest('hex')}&email=${encodeURIComponent(email)}`;

  const accentColors = ['#00b4d8','#ffd166','#06d6a0','#ef476f','#118ab2'];

  const renderSection = (sec, i) => {
    const accent = accentColors[i % accentColors.length];
    const [lead, ...rest] = sec.items;
    return `<tr><td style="padding:0 0 28px 0;">
  <!-- Section header bar -->
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="background:#1a1a2e;border-left:5px solid ${accent};padding:10px 18px;">
      <span style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#fff;">${sec.emoji} ${escHtmlServer(sec.title)}</span>
    </td>
  </tr></table>
  <!-- Lead story -->
  ${lead ? `<div style="padding:16px 20px 12px;">
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:20px;font-weight:800;color:#1a1a2e;line-height:1.3;margin-bottom:8px;">${escHtmlServer(lead.headline)}</div>
    <div style="border-left:4px solid ${accent};padding-left:16px;font-style:italic;font-size:15px;color:#4a5568;line-height:1.7;margin-bottom:8px;">${escHtmlServer(lead.summary)}</div>
    ${lead.meta ? `<div style="font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;">${escHtmlServer(lead.meta)}</div>` : ''}
  </div>` : ''}
  <!-- Remaining items -->
  ${rest.map(item => `<div style="padding:0 20px 14px;">
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:14px;font-weight:700;color:#1a1a2e;line-height:1.4;margin-bottom:4px;">${escHtmlServer(item.headline)}</div>
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#4a5568;line-height:1.6;">${escHtmlServer(item.summary)}</div>
    ${item.meta ? `<div style="font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;margin-top:3px;">${escHtmlServer(item.meta)}</div>` : ''}
  </div>`).join('')}
</td></tr>`;
  };

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#e8ecf0;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8ecf0;">
<tr><td align="center" style="padding:24px 12px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#fff;">

<!-- HEADER -->
<tr><td style="background:#1a2744;padding:18px 28px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr valign="middle">
    <td><img src="https://spokesbox.com/spokesbox-logo.png" alt="Spokesbox" style="height:56px;width:auto;display:block;"></td>
    <td align="right" style="font-family:Arial,sans-serif;font-size:12px;color:rgba(255,255,255,0.65);">Volume 1 &middot; Issue ${dayOfYear} &middot; ${escHtmlServer(monthYear)}</td>
  </tr></table>
</td></tr>
<tr><td style="background:#ffd166;height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>

<!-- GREETING -->
<tr><td style="padding:18px 24px 8px;">
  <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#374151;margin:0;">Good morning, <strong>${escHtmlServer(name)}</strong>. Your personalized edition for <em>${escHtmlServer(date)}</em>.</p>
</td></tr>

<!-- SECTIONS -->
${sections.map((sec, i) => renderSection(sec, i)).join('<tr><td style="height:1px;background:#e5e7eb;font-size:0;"></td></tr>')}

<!-- FOOTER -->
<tr><td style="background:#ffd166;height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#1a2744;padding:16px 24px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr valign="middle">
    <td><img src="https://spokesbox.com/spokesbox-logo.png" alt="Spokesbox" style="height:32px;width:auto;display:block;"></td>
    <td align="right" style="font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.6);">
      <a href="${unsubUrl}" style="color:rgba(255,255,255,0.6);">Unsubscribe</a> &middot;
      <a href="${profileUrl}" style="color:rgba(255,255,255,0.6);">Update brief</a>
    </td>
  </tr></table>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ─── Template 4: Comic ────────────────────────────────────────────────────────
function generateComicTemplate({ name, sections, date, email, profileUrl }) {
  const unsubUrl = `https://spokesbox.com/unsubscribe?token=${crypto.createHmac('sha256','spokesbox-secret-2026').update(email).digest('hex')}&email=${encodeURIComponent(email)}`;
  const actionWords = ['BREAKING!', 'MEANWHILE!', 'KAPOW!', 'HOLY SCOOP!', 'ZAP!'];

  const renderPanel = (sec, i) => {
    const rotation = i % 2 === 0 ? '-1deg' : '1deg';
    const action = actionWords[i % actionWords.length];
    return `<tr><td style="padding:8px 16px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="border:3px solid #000;transform:rotate(${rotation});">
    <!-- Panel header -->
    <tr><td style="background:#FF0000;padding:8px 14px;">
      <span style="font-family:Impact,'Arial Black',sans-serif;font-size:14px;font-weight:700;color:#FFD700;text-transform:uppercase;letter-spacing:2px;">${sec.emoji} ${escHtmlServer(sec.title)}</span>
    </td></tr>
    <!-- Panel content -->
    ${sec.items.map((item, j) => `<tr><td style="background:${j % 2 === 0 ? '#fff' : '#fffde7'};padding:12px 14px;border-top:${j > 0 ? '2px solid #000' : 'none'};">
      <div style="font-family:Impact,'Arial Black',sans-serif;font-size:12px;color:#FF0000;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${j === 0 ? action : actionWords[(i + j + 1) % actionWords.length]}</div>
      <div style="font-family:'Arial Black',Arial,sans-serif;font-size:14px;font-weight:900;color:#000;line-height:1.3;margin-bottom:6px;">${escHtmlServer(item.headline)}</div>
      <div style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#111;line-height:1.5;">${escHtmlServer(item.summary)}</div>
      ${item.meta ? `<div style="margin-top:6px;"><span style="background:#FFD700;color:#000;padding:2px 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;">${escHtmlServer(item.meta)}</span></div>` : ''}
    </td></tr>`).join('')}
  </table>
</td></tr>
<tr><td style="padding:4px 16px;text-align:center;font-size:22px;">${['💥','✨','⚡','🔥','💫'][i % 5]}</td></tr>`;
  };

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#FFD700;font-family:Impact,'Arial Black',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFD700;">
<tr><td align="center" style="padding:16px 12px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#FFD700;border:5px solid #000;">

<!-- HEADER -->
<tr><td style="padding:20px 24px;text-align:center;border-bottom:4px solid #000;">
  <div style="font-family:Impact,'Arial Black',sans-serif;font-size:42px;font-weight:900;color:#FF0000;text-shadow:3px 3px 0 #000;letter-spacing:2px;line-height:1;">POW! 📬</div>
  <div style="margin:10px auto;display:inline-block;background:#1a2744;padding:8px 16px;border-radius:6px;border:2px solid #000;">
    <div style="display:inline-block;background:#1a2744;padding:8px 20px;border-radius:8px;border:2px solid #000;">
      <img src="https://spokesbox.com/spokesbox-logo.png" alt="Spokesbox" style="height:48px;width:auto;display:block;margin:0 auto;">
    </div>
  </div>
  <div style="font-family:Impact,'Arial Black',sans-serif;font-size:20px;font-weight:900;color:#FF0000;text-transform:uppercase;letter-spacing:3px;margin-top:10px;border:3px solid #FF0000;display:inline-block;padding:4px 16px;">TODAY'S EDITION!</div>
  <div style="font-family:Arial,sans-serif;font-size:12px;color:#111;margin-top:8px;">${escHtmlServer(date)} &middot; Hello, ${escHtmlServer(name)}!</div>
</td></tr>

<!-- PANELS -->
${sections.map((sec, i) => renderPanel(sec, i)).join('')}

<!-- FOOTER -->
<tr><td style="background:#000;padding:14px 24px;text-align:center;">
  <div style="font-family:Impact,'Arial Black',sans-serif;font-size:14px;color:#FFD700;letter-spacing:1px;margin-bottom:8px;">TO BE CONTINUED IN TOMORROW'S EDITION!</div>
  <div style="font-family:Arial,sans-serif;font-size:11px;">
    <a href="${unsubUrl}" style="color:#FFD700;">Unsubscribe</a>
    <span style="color:#FFD700;"> &middot; </span>
    <a href="${profileUrl}" style="color:#FFD700;">Update your brief</a>
  </div>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ─── Template 5: Minimal ──────────────────────────────────────────────────────
function generateMinimalTemplate({ name, sections, date, email, profileUrl }) {
  const unsubUrl = `https://spokesbox.com/unsubscribe?token=${crypto.createHmac('sha256','spokesbox-secret-2026').update(email).digest('hex')}&email=${encodeURIComponent(email)}`;

  const renderSection = (sec, i) => `
<tr><td style="padding:${i > 0 ? '24px' : '16px'} 36px 20px;${i > 0 ? 'border-top:1px solid #e5e7eb;' : ''}">
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;border-top:1px solid #d1d5db;padding-top:12px;margin-bottom:14px;">${sec.emoji} ${escHtmlServer(sec.title)}</div>
  ${sec.items.map((item, j) => `<div style="margin-bottom:${j < sec.items.length - 1 ? '16px' : '0'};">
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:700;color:#111827;line-height:1.4;margin-bottom:5px;">${escHtmlServer(item.headline)}</div>
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">${escHtmlServer(item.summary)}</div>
    ${item.meta ? `<div style="font-family:Arial,sans-serif;font-size:12px;color:#9ca3af;margin-top:3px;">&#8212; ${escHtmlServer(item.meta)}</div>` : ''}
  </div>`).join('')}
</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f9fafb;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;">
<tr><td align="center" style="padding:24px 12px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#fff;">

<!-- HEADER -->
<tr><td style="background:#1a2744;padding:14px 36px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr valign="middle">
    <td><img src="https://spokesbox.com/spokesbox-logo.png" alt="Spokesbox" style="height:40px;width:auto;display:block;"></td>
    <td align="right" style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:rgba(255,255,255,0.5);">${escHtmlServer(date)}</td>
  </tr></table>
</td></tr>

<!-- GREETING -->
<tr><td style="padding:20px 36px 4px;">
  <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#374151;line-height:1.8;margin:0;">Hi ${escHtmlServer(name)} &#8212;</p>
</td></tr>

<!-- SECTIONS -->
${sections.map((sec, i) => renderSection(sec, i)).join('')}

<!-- FOOTER -->
<tr><td style="border-top:1px solid #e5e7eb;padding:16px 36px;">
  <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#9ca3af;margin:0;">
    Spokesbox &middot;
    <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe</a> &middot;
    <a href="${profileUrl}" style="color:#9ca3af;">Update your brief</a>
  </p>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateToken(email) {
  return crypto.createHmac('sha256', 'spokesbox-secret-2026').update(email).digest('hex');
}

async function lookupZip(zip) {
  return new Promise((resolve) => {
    const req = https.get(
      `https://api.zippopotam.us/us/${zip}`,
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.places && json.places[0]) {
              resolve({
                city: json.places[0]['place name'],
                state: json.places[0]['state abbreviation']
              });
            } else {
              resolve({ city: null, state: null });
            }
          } catch {
            resolve({ city: null, state: null });
          }
        });
      }
    );
    req.on('error', () => resolve({ city: null, state: null }));
    req.setTimeout(3000, () => { req.destroy(); resolve({ city: null, state: null }); });
  });
}

async function sendWelcomeEmail(subscriber) {
  const encodedEmail = encodeURIComponent(subscriber.email);
  const unsubToken = generateToken(subscriber.email);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: #1a1a2e; padding: 40px 48px; text-align: center; }
    .header h1 { color: #00b4d8; margin: 0; font-size: 28px; letter-spacing: -0.5px; }
    .header p { color: #aaa; margin: 8px 0 0; font-size: 14px; }
    .body { padding: 48px; }
    .greeting { font-size: 22px; font-weight: 700; color: #1a1a2e; margin-bottom: 16px; }
    .body p { font-size: 16px; color: #444; line-height: 1.7; margin-bottom: 16px; }
    .cta-btn { display: inline-block; background: #ffd166; color: #1a1a2e; font-weight: 700; font-size: 16px; padding: 16px 36px; border-radius: 50px; text-decoration: none; margin: 24px 0; }
    .steps { background: #f8f9ff; border-radius: 12px; padding: 24px 32px; margin: 24px 0; }
    .step { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
    .step:last-child { margin-bottom: 0; }
    .step-icon { font-size: 24px; min-width: 32px; }
    .step-text { font-size: 15px; color: #555; line-height: 1.5; }
    .step-text strong { color: #1a1a2e; }
    .footer-section { border-top: 1px solid #eee; padding: 32px 48px; text-align: center; }
    .footer-section p { font-size: 13px; color: #999; margin: 4px 0; }
    .footer-section a { color: #00b4d8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>📬 Spokesbox</h1>
      <p>Your personalized daily newsletter</p>
    </div>
    <div class="body">
      <div class="greeting">Welcome${subscriber.name ? ', ' + subscriber.name : ''}! 🎉</div>
      <p>You're in! Your personalized newsletter is ready to go.</p>
      <div class="steps">
        <div class="step">
          <div class="step-icon">⏰</div>
          <div class="step-text"><strong>First newsletter arrives tomorrow morning.</strong> We're building your personalized edition right now.</div>
        </div>
        <div class="step">
          <div class="step-icon">✍️</div>
          <div class="step-text"><strong>Tell us what you love.</strong> Complete your 2-minute preferences wizard so we can personalize your newsletter perfectly.</div>
        </div>
        <div class="step">
          <div class="step-icon">💬</div>
          <div class="step-text"><strong>Reply to any email to make changes.</strong> Don't like something? Just reply and say so — we'll fix it.</div>
        </div>
      </div>
      <div style="text-align: center;">
        <a href="https://spokesbox.com/wizard?email=${encodedEmail}" class="cta-btn">Complete My Preferences →</a>
      </div>
      <p style="font-size: 14px; color: #888; text-align: center;">Takes about 2 minutes. Totally worth it.</p>
    </div>
    <div class="footer-section">
      <p>© 2026 Spokesbox. Made with ☀️</p>
      <p>
        <a href="https://spokesbox.com/unsubscribe?token=${unsubToken}&email=${encodedEmail}">Unsubscribe</a>
        &nbsp;·&nbsp;
        <a href="https://spokesbox.com/profile?email=${encodedEmail}&token=${unsubToken}">📝 Review &amp; update your newsletter</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  await sgMail.send({
    to: subscriber.email,
    from: { email: 'jared@jaredgreen.com', name: 'Spokesbox' },
    replyTo: 'sherlock.claw@gmail.com',
    subject: 'Welcome to Spokesbox 🎉 Your first newsletter arrives tomorrow',
    html
  });
}

/**
 * Applies all wizard answers to the subscriber record in the DB.
 * Called both from /wizard/complete and automatically when reaching the payment step.
 */

// ─── applyOnboardingDefaults: fill gaps for new short-flow users ──────────────
/**
 * Fills missing preference fields with sensible defaults so daily newsletter
 * works correctly for users who completed the new 4-screen wizard flow.
 */
function applyOnboardingDefaults(answers) {
  if (!answers.newsletter_length) answers.newsletter_length = 'Medium (5 min)';
  if (!answers.tone)              answers.tone              = 'Warm & friendly';
  if (!answers.delivery_time)     answers.delivery_time     = '7am';
  if (!answers.include_joke)      answers.include_joke      = 'Yes, give me both!';
  if (answers.watchlist   === undefined) answers.watchlist   = '';
  if (answers.exclude     === undefined) answers.exclude     = '';
  return answers;
}

// ─── validateSessionIndex: migration safety for in-progress sessions ──────────
/**
 * Advances a session's main_idx to the nearest valid MAIN_QUESTIONS index.
 * Prevents old sessions (created before the v2 wizard refactor) from pointing
 * to a now-nonexistent question slot.
 */
function validateSessionIndex(state) {
  const validIdxs = MAIN_QUESTIONS.map(q => q.idx);
  if (!validIdxs.includes(state.main_idx)) {
    const nearest = validIdxs.find(i => i >= state.main_idx) || validIdxs[validIdxs.length - 2];
    console.log(`[wizard] Session main_idx ${state.main_idx} invalid after refactor — advancing to ${nearest}`);
    state.main_idx = nearest;
  }
  return state;
}

function applyAnswersToSubscriber(email, answers) {
  if (!email) return;

  // Ensure subscriber row exists (wizard-direct flow may not have a pre-existing record)
  db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);

  // Parse tone
  let tone = 'warm';
  if (answers.tone) {
    if (answers.tone.includes('Informative')) tone = 'informative';
    else if (answers.tone.includes('Upbeat')) tone = 'upbeat';
  }

  // Parse newsletter_length
  let length = 'medium';
  if (answers.newsletter_length) {
    if (answers.newsletter_length.includes('Short')) length = 'short';
    else if (answers.newsletter_length.includes('Long')) length = 'long';
  }

  // Parse delivery_time (e.g. "7am" → "07:00")
  let deliveryTime = '07:00';
  if (answers.delivery_time) {
    let t = answers.delivery_time.toLowerCase().trim();
    if (t === 'noon') {
      deliveryTime = '12:00';
    } else {
      t = t.replace('am', '').replace('pm', '').trim();
      const hour = parseInt(t);
      if (!isNaN(hour)) deliveryTime = `${String(hour).padStart(2, '0')}:00`;
    }
  }

  // Build preferences JSON (extended preferences stored as JSON blob)
  const preferences = {
    watchlist: answers.watchlist || '',
    include_joke: answers.include_joke || '',
    exclude: answers.exclude || ''
  };

  db.prepare(`
    UPDATE subscribers SET
      name               = COALESCE(@name, name),
      zip_code           = COALESCE(@zip_code, zip_code),
      city               = COALESCE(@city, city),
      state              = COALESCE(@state, state),
      age_range          = @age_range,
      gender_identity    = @gender_identity,
      cultural_background= @cultural_background,
      tone               = @tone,
      newsletter_length  = @newsletter_length,
      delivery_time      = @delivery_time,
      sports_detail      = @sports_detail,
      finance_detail     = @finance_detail,
      book_genres        = @book_genres,
      tech_focus         = @tech_focus,
      health_focus       = @health_focus,
      college_sports     = COALESCE(@college_sports, college_sports),
      career_focus       = COALESCE(@career_focus, career_focus),
      music_detail       = @music_detail,
      movies_tv_detail   = @movies_tv_detail,
      local_showtimes    = @local_showtimes,
      preferences        = @preferences,
      wizard_complete    = 1,
      updated_at         = datetime('now')
    WHERE email = @email
  `).run({
    name:                answers.name             || null,
    zip_code:            answers.zip_code         || null,
    city:                answers._city            || null,
    state:               answers._state           || null,
    age_range:           answers.age_range        || null,
    gender_identity:     answers.gender_identity  || null,
    cultural_background: answers.cultural_background || null,
    tone,
    newsletter_length:   length,
    delivery_time:       deliveryTime,
    sports_detail:       answers.sports_detail    || null,
    finance_detail:      answers.finance_detail   || null,
    book_genres:         answers.book_genres      || null,
    tech_focus:          answers.tech_focus       || null,
    health_focus:        answers.health_focus     || null,
    college_sports:      answers.college_sports   || null,
    career_focus:        answers.career_focus     || null,
    music_detail:        answers.music_detail      || null,
    movies_tv_detail:    answers.movies_tv_detail  || null,
    local_showtimes:     answers.local_showtimes === 'Yes, include showtimes!' ? 1 : 0,
    preferences:         JSON.stringify(preferences),
    email,
  });

  // Parse and save individual social profile URLs from the social_profiles answer
  if (answers.social_profiles) {
    let urls = [];
    try { urls = JSON.parse(answers.social_profiles); } catch (e) {
      urls = String(answers.social_profiles).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    }
    const socials = { linkedin: null, facebook: null, instagram: null, twitter: null, reddit: null };
    for (const url of urls) {
      if (!url) continue;
      if (url.includes('linkedin.com'))  socials.linkedin  = url;
      else if (url.includes('facebook.com')) socials.facebook  = url;
      else if (url.includes('instagram.com')) socials.instagram = url;
      else if (url.includes('x.com') || url.includes('twitter.com')) socials.twitter = url;
      else if (url.startsWith('u/') || url.includes('reddit.com')) socials.reddit = url;
    }
    db.prepare(`UPDATE subscribers SET
      social_linkedin  = COALESCE(?, social_linkedin),
      social_facebook  = COALESCE(?, social_facebook),
      social_instagram = COALESCE(?, social_instagram),
      social_twitter   = COALESCE(?, social_twitter),
      social_reddit    = COALESCE(?, social_reddit)
      WHERE email = ?`
    ).run(socials.linkedin, socials.facebook, socials.instagram, socials.twitter, socials.reddit, email);
  }

  // Save topics to the topics table
  const subscriber = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);
  if (subscriber && answers.topics) {
    const topicList = Array.isArray(answers.topics)
      ? answers.topics
      : answers.topics.split(',').map(t => t.trim()).filter(Boolean);

    db.prepare('DELETE FROM topics WHERE subscriber_id = ?').run(subscriber.id);

    const insertTopic = db.prepare(
      'INSERT INTO topics (subscriber_id, topic, enabled, priority) VALUES (?, ?, 1, 5)'
    );
    for (const topic of topicList) {
      if (topic) insertTopic.run(subscriber.id, topic);
    }
  }
}

// ─── Enrich Subscriber From Answers (fills gaps not covered by applyAnswersToSubscriber) ──────────
function enrichSubscriberFromAnswers(email, answers) {
  if (!email) return;

  // Ensure subscriber row exists
  db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);

  // Fill city/state from direct fields (answers.city / answers.state)
  // applyAnswersToSubscriber uses answers._city / answers._state; this fills the non-underscore variants
  const city  = answers.city  || answers._city  || null;
  const state = answers.state || answers._state || null;
  const zip   = answers.zip_code || null;

  if (city || state || zip) {
    db.prepare(`UPDATE subscribers SET
      city     = COALESCE(?, city),
      state    = COALESCE(?, state),
      zip_code = COALESCE(?, zip_code)
      WHERE email = ?`
    ).run(city, state, zip, email);
  }

  // Save individual social URL fields (complementary to parsing social_profiles blob)
  const linkedin  = answers.social_linkedin  || null;
  const twitter   = answers.social_twitter   || null;
  const instagram = answers.social_instagram || null;
  const facebook  = answers.social_facebook  || null;
  if (linkedin || twitter || instagram || facebook) {
    db.prepare(`UPDATE subscribers SET
      social_linkedin  = COALESCE(?, social_linkedin),
      social_twitter   = COALESCE(?, social_twitter),
      social_instagram = COALESCE(?, social_instagram),
      social_facebook  = COALESCE(?, social_facebook)
      WHERE email = ?`
    ).run(linkedin, twitter, instagram, facebook, email);
  }

  // Ensure detail fields are saved (fills gaps if applyAnswersToSubscriber missed them)
  const detailFields = {
    sports_detail:    answers.sports_detail    || null,
    college_sports:   answers.college_sports   || null,
    career_focus:     answers.career_focus     || null,
    finance_detail:   answers.finance_detail   || null,
    tech_focus:       answers.tech_focus       || null,
    health_focus:     answers.health_focus     || null,
    music_detail:     answers.music_detail     || null,
    movies_tv_detail: answers.movies_tv_detail || null,
  };
  const localShowtimes = answers.local_showtimes === 'Yes, include showtimes!' ? 1 : 0;
  if (Object.values(detailFields).some(v => v !== null) || answers.local_showtimes != null) {
    db.prepare(`UPDATE subscribers SET
      sports_detail    = COALESCE(?, sports_detail),
      college_sports   = COALESCE(?, college_sports),
      career_focus     = COALESCE(?, career_focus),
      finance_detail   = COALESCE(?, finance_detail),
      tech_focus       = COALESCE(?, tech_focus),
      health_focus     = COALESCE(?, health_focus),
      music_detail     = COALESCE(?, music_detail),
      movies_tv_detail = COALESCE(?, movies_tv_detail),
      local_showtimes  = ?
      WHERE email = ?`
    ).run(
      detailFields.sports_detail, detailFields.college_sports, detailFields.career_focus,
      detailFields.finance_detail, detailFields.tech_focus, detailFields.health_focus,
      detailFields.music_detail, detailFields.movies_tv_detail, localShowtimes,
      email
    );
  }

  // Ensure topics are populated (INSERT OR IGNORE — non-destructive complement to applyAnswersToSubscriber)
  if (answers.topics) {
    const subscriber = db.prepare('SELECT id FROM subscribers WHERE email = ?').get(email);
    if (subscriber) {
      const topicList = Array.isArray(answers.topics)
        ? answers.topics
        : String(answers.topics).split(',').map(t => t.trim()).filter(Boolean);
      const insertTopic = db.prepare(
        'INSERT OR IGNORE INTO topics (subscriber_id, topic, enabled, priority) VALUES (?, ?, 1, 5)'
      );
      for (const topic of topicList) {
        if (topic) insertTopic.run(subscriber.id, topic);
      }
    }
  }
}

// ─── Welcome Email Builder ────────────────────────────────────────────────────
function buildWelcomeEmail(name, deliveryTime, email) {
  const unsubToken = crypto.createHmac('sha256', 'spokesbox-secret-2026').update(email).digest('hex');
  const unsubUrl = `https://spokesbox.com/unsubscribe?token=${unsubToken}&email=${encodeURIComponent(email)}`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Georgia,serif;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
  <div style="background:#1a2744;padding:28px 32px;text-align:center;">
    <div style="color:#fff;font-size:28px;font-weight:bold;letter-spacing:2px;">&#128236; SPOKESBOX</div>
    <div style="color:#a0aec0;font-size:12px;margin-top:4px;">Your personalized daily brief</div>
  </div>
  <div style="padding:36px 32px;">
    <p style="font-size:22px;color:#1a2744;margin:0 0 16px;">Hey ${name}! &#127881;</p>
    <p style="font-size:16px;color:#4a5568;line-height:1.7;margin:0 0 16px;">You're all set. Your first personalized brief arrives at <strong>${deliveryTime}</strong>.</p>
    <p style="font-size:16px;color:#4a5568;line-height:1.7;margin:0;">We'll see you then.</p>
  </div>
  <div style="background:#f7fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;">
    <p style="font-size:11px;color:#a0aec0;margin:0;">You're receiving this because you signed up at spokesbox.com</p>
    <p style="font-size:11px;color:#a0aec0;margin:6px 0 0;"><a href="${unsubUrl}" style="color:#667eea;">Unsubscribe</a></p>
  </div>
</div>
</body>
</html>`;
}


// ─── Onboarding Completion Email Builder ──────────────────────────────────────
function buildOnboardingEmail({ name, email, deliveryTime, topics, city, state: usState }) {
  const unsubToken = crypto.createHmac('sha256', 'spokesbox-secret-2026').update(email).digest('hex');
  const unsubUrl   = `https://spokesbox.com/unsubscribe?token=${unsubToken}&email=${encodeURIComponent(email)}`;
  const profileUrl = 'https://spokesbox.com/profile';

  let ftStr = '7:00 AM';
  try {
    const [hh, mm] = (deliveryTime || '07:00').split(':').map(Number);
    const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    ftStr = `${h12}:${String(mm || 0).padStart(2,'0')} ${hh >= 12 ? 'PM' : 'AM'}`;
  } catch (_) {}

  const topicList   = Array.isArray(topics) ? topics : (topics || '').split(',').map(t => t.trim()).filter(Boolean);
  const topicBadges = topicList.length
    ? topicList.map(t =>
        `<span style="display:inline-block;background:#e8f4fd;color:#1a2744;border-radius:20px;` +
        `padding:4px 12px;font-size:12px;font-weight:600;margin:3px 3px 0 0;">${escHtmlServer(t)}</span>`
      ).join('')
    : '<span style="color:#6b7280;font-size:14px;">Personalized to you</span>';

  const tomorrow    = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const locationStr = (city && usState) ? ` · ${city}, ${usState}` : (city ? ` · ${city}` : '');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;">
  <tr><td align="center" style="padding:32px 16px;">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
    <tr><td style="background:#1a2744;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
      <div style="color:#ffd166;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Spokesbox</div>
      <h1 style="color:#ffffff;font-size:24px;font-weight:800;margin:0;">You&#x27;ve completed your onboarding! 🎉</h1>
      <p style="color:#a0aec0;font-size:14px;margin:8px 0 0;">Your personalized daily brief is ready to go</p>
    </td></tr>
    <tr><td style="height:3px;background:linear-gradient(90deg,#ffd166,#00B4D8,#ffd166);"></td></tr>
    <tr><td style="background:#ffffff;padding:36px 32px;">
      <p style="font-size:18px;color:#1a2744;font-weight:700;margin:0 0 8px;">Hey ${escHtmlServer(name)}! 👋</p>
      <p style="font-size:15px;color:#4a5568;line-height:1.7;margin:0 0 24px;">Your onboarding is complete — we&#x27;ve built your newsletter based on your answers. Your first issue is on its way.</p>
      <div style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:16px;border-right:1px solid #e2e8f0;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#718096;font-weight:600;margin-bottom:4px;">First Issue</div>
            <div style="font-size:15px;font-weight:700;color:#1a2744;">${tomorrowStr}</div>
          </td>
          <td style="padding-left:20px;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#718096;font-weight:600;margin-bottom:4px;">Delivery Time</div>
            <div style="font-size:15px;font-weight:700;color:#1a2744;">${ftStr}${locationStr}</div>
          </td>
        </tr></table>
      </div>
      <p style="font-size:12px;font-weight:700;color:#1a2744;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Your Topics</p>
      <div style="margin-bottom:28px;">${topicBadges}</div>
      <div style="text-align:center;margin-bottom:8px;">
        <a href="${profileUrl}" style="display:inline-block;background:#1a2744;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;">View My Newsletter →</a>
      </div>
      <p style="text-align:center;font-size:13px;color:#718096;margin:12px 0 0;">Reply to any newsletter to update your preferences anytime.</p>
    </td></tr>
    <tr><td style="background:#f7fafc;border-radius:0 0 12px 12px;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="font-size:11px;color:#a0aec0;margin:0;">You signed up at spokesbox.com</p>
      <p style="font-size:11px;color:#a0aec0;margin:6px 0 0;"><a href="${unsubUrl}" style="color:#667eea;">Unsubscribe</a></p>
    </td></tr>
  </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Middleware ────────────────────────────────────────────────────────────────
app.set('trust proxy', 1); // behind Cloudflare
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrcAttr: null, // remove 'none' default — allows onclick/onload attrs (safe since unsafe-inline is already set for scripts)
    },
  },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: { maxAge: 15552000, includeSubDomains: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// CORS allowlist
const ALLOWED_ORIGINS = new Set([
  'https://spokesbox.com',
  'https://www.spokesbox.com',
  process.env.NODE_ENV !== 'production' ? 'http://localhost:3002' : null,
].filter(Boolean));
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOWED_ORIGINS.has(origin)) ? cb(null, true) : cb(new Error('CORS blocked')),
  credentials: true,
}));

// Rate limiters
const globalLimit   = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
const subscribeLimit = rateLimit({ windowMs: 60_000, max: 5,  standardHeaders: true, legacyHeaders: false });
const answerLimit    = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const feedbackLimit  = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
app.use('/api', globalLimit);
app.use('/subscribe', subscribeLimit);
app.use('/wizard/answer', answerLimit);
app.use('/feedback', feedbackLimit);
app.use('/moderate', feedbackLimit);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Beta gate — runs before static file serving so .html files are protected ─
app.use(betaGateMiddleware);

// ── noindex / nofollow in beta mode ──────────────────────────────────────────
if (BETA_MODE || SITE_PASSWORD) {
  app.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────

// ── Beta Login — GET (form) ───────────────────────────────────────────────────
app.get('/beta-login', (req, res) => {
  const next = req.query.next || '/';
  const err  = req.query.error === '1';
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Spokesbox — Private Beta</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0f111a;font-family:'DM Sans',Arial,sans-serif;padding:24px}
  .card{background:#1a1d2e;border:1px solid rgba(255,255,255,0.08);border-radius:20px;
    padding:44px 40px;max-width:420px;width:100%;text-align:center}
  .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;margin-bottom:6px}
  .sub{font-size:13px;color:#6b7280;margin-bottom:32px}
  .badge{display:inline-block;background:rgba(139,92,246,0.15);color:#a78bfa;
    font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;
    border-radius:50px;padding:4px 14px;margin-bottom:28px}
  label{display:block;font-size:13px;font-weight:600;color:#9ca3af;
    text-align:left;margin-bottom:8px;letter-spacing:0.03em}
  input[type=password]{width:100%;background:#0f111a;border:1px solid rgba(255,255,255,0.12);
    border-radius:10px;padding:12px 16px;font-size:15px;color:#fff;outline:none;
    transition:border 0.2s}
  input[type=password]:focus{border-color:#8b5cf6}
  .error{background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.25);
    border-radius:8px;padding:10px 14px;font-size:13px;margin-top:16px;text-align:left}
  button{width:100%;background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;
    font-size:15px;font-weight:700;border:none;border-radius:12px;padding:13px;
    margin-top:20px;cursor:pointer;transition:opacity 0.2s}
  button:hover{opacity:0.9}
  .notice{font-size:11px;color:#4b5563;margin-top:20px;line-height:1.6}
</style>
</head>
<body>
<div class="card">
  <div class="logo">Spokesbox</div>
  <div class="sub">Personalized daily newsletters</div>
  <div class="badge">🔬 Private Beta</div>
  <form method="POST" action="/beta-login">
    <input type="hidden" name="next" value="${next}">
    <label for="pw">Beta access code</label>
    <input type="password" id="pw" name="password" placeholder="Enter access code" autofocus autocomplete="current-password">
    ${err ? '<div class="error">Incorrect access code. Please try again.</div>' : ''}
    <button type="submit">Enter Beta →</button>
  </form>
  <p class="notice">
    This is a private beta. By entering, you agree that your publicly available social profiles
    may be analyzed to generate personalized newsletter topic suggestions.
  </p>
</div>
</body>
</html>`);
});

// ── Beta Login — POST (validate + set session cookie) ────────────────────────
const betaLoginLimit = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
app.post('/beta-login', betaLoginLimit, (req, res) => {
  const { password, next = '/' } = req.body;
  const safeNext = next.startsWith('/') ? next : '/';

  if (!SITE_PASSWORD) {
    // Gate disabled — just redirect
    return res.redirect(302, safeNext);
  }

  // Timing-safe comparison
  let valid = false;
  try {
    const a = Buffer.from(password  || '', 'utf8');
    const b = Buffer.from(SITE_PASSWORD, 'utf8');
    valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { valid = false; }

  if (!valid) {
    return res.redirect(302, `/beta-login?next=${encodeURIComponent(safeNext)}&error=1`);
  }

  // Issue session token
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + BETA_SESSION_TTL_MS;
  betaSessions.set(token, { expiresAt });

  const isSecure = process.env.NODE_ENV === 'production';
  const cookieFlags = [
    `sb_beta=${token}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Strict`,
    `Max-Age=${Math.floor(BETA_SESSION_TTL_MS / 1000)}`,
    isSecure ? 'Secure' : '',
  ].filter(Boolean).join('; ');

  res.setHeader('Set-Cookie', cookieFlags);
  return res.redirect(302, safeNext);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'spokesbox', timestamp: new Date().toISOString() });
});

// Static pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/wizard', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'wizard.html'));
});
app.get('/brand', (req, res) => res.sendFile(path.join(__dirname, 'public', 'brand.html')));
app.get('/campaigns', (req, res) => res.sendFile(path.join(__dirname, 'public', 'campaigns.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/newsletter-preview', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'newsletter-preview.html'));
});

// ─── Profile Endpoints ────────────────────────────────────────────────────────

// GET /api/profile — fetch subscriber data (token-gated)
app.get('/api/profile', (req, res) => {
  const { email, token } = req.query;
  if (!email || !token) return res.status(400).json({ error: 'email and token required' });

  const expected = generateToken(decodeURIComponent(email));
  if (token !== expected) return res.status(403).json({ error: 'Invalid token' });

  const subscriber = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(decodeURIComponent(email));
  if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });

  const topicRows = db.prepare('SELECT topic FROM topics WHERE subscriber_id = ? AND enabled = 1').all(subscriber.id);
  const topics = topicRows.map(r => r.topic);

  res.json({
    name: subscriber.name,
    email: subscriber.email,
    topics,
    tone: subscriber.tone || 'warm',
    newsletter_length: subscriber.newsletter_length || 'medium',
    delivery_time: subscriber.delivery_time || '07:00',
    social_linkedin: subscriber.social_linkedin || '',
    social_instagram: subscriber.social_instagram || '',
    social_twitter: subscriber.social_twitter || '',
    social_reddit: subscriber.social_reddit || '',
    social_facebook: subscriber.social_facebook || '',
    template_style: subscriber.template_style || 'modern',
    // Demographics
    age_range: subscriber.age_range || '',
    gender_identity: subscriber.gender_identity || '',
    cultural_background: subscriber.cultural_background || '',
    // Personalization
    watchlist: subscriber.watchlist || '',
    include_joke: subscriber.include_joke || '',
    exclude: subscriber.exclude || '',
    // Deep interests (branch fields)
    sports_detail: subscriber.sports_detail || '',
    finance_detail: subscriber.finance_detail || '',
    book_genres: subscriber.book_genres || '',
    tech_focus: subscriber.tech_focus || '',
    health_focus: subscriber.health_focus || '',
    career_focus: subscriber.career_focus || '',
    music_detail: subscriber.music_detail || '',
    movies_tv_detail: subscriber.movies_tv_detail || '',
    local_showtimes: subscriber.local_showtimes || '',
    college_sports: subscriber.college_sports || ''
  });
});

// POST /api/profile/save — save one field at a time
app.post('/api/profile/save', (req, res) => {
  const { email, token, field, value } = req.body;
  if (!email || !token || !field) return res.status(400).json({ error: 'email, token, and field required' });

  const expected = generateToken(email);
  if (token !== expected) return res.status(403).json({ error: 'Invalid token' });

  const subscriber = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);
  if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });

  const ALLOWED_FIELDS = ['tone', 'newsletter_length', 'delivery_time',
    'social_linkedin', 'social_instagram', 'social_twitter', 'social_reddit', 'social_facebook', 'template_style',
    'age_range', 'gender_identity', 'cultural_background',
    'watchlist', 'include_joke', 'exclude',
    'sports_detail', 'finance_detail', 'book_genres', 'tech_focus', 'health_focus',
    'career_focus', 'music_detail', 'movies_tv_detail', 'local_showtimes', 'college_sports'];

  try {
    if (field === 'topics') {
      // Replace topics table entries
      const topicList = Array.isArray(value) ? value : [];
      db.prepare('DELETE FROM topics WHERE subscriber_id = ?').run(subscriber.id);
      const insertTopic = db.prepare('INSERT INTO topics (subscriber_id, topic, enabled, priority) VALUES (?, ?, 1, 5)');
      for (const topic of topicList) {
        if (topic && typeof topic === 'string') insertTopic.run(subscriber.id, topic);
      }
      db.prepare("UPDATE subscribers SET updated_at = datetime('now') WHERE id = ?").run(subscriber.id);
      return res.json({ success: true });
    }

    if (!ALLOWED_FIELDS.includes(field)) {
      return res.status(400).json({ error: `Field '${field}' not allowed` });
    }

    db.prepare(`UPDATE subscribers SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(value || null, subscriber.id);

    res.json({ success: true });
  } catch (err) {
    console.error('Profile save error:', err);
    res.status(500).json({ error: 'Failed to save' });
  }
});

// GET /api/profile/preview — return newsletter preview HTML for current subscriber settings
app.get('/api/profile/preview', async (req, res) => {
  const { email, token } = req.query;
  if (!email || !token) return res.status(400).send('<p>Missing params</p>');

  const expected = generateToken(decodeURIComponent(email));
  if (token !== expected) return res.status(403).send('<p>Invalid token</p>');

  const subscriber = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(decodeURIComponent(email));
  if (!subscriber) return res.status(404).send('<p>Subscriber not found</p>');

  const topicRows = db.prepare('SELECT topic FROM topics WHERE subscriber_id = ? AND enabled = 1').all(subscriber.id);
  const topics = topicRows.map(r => r.topic);

  const sections = buildMockSections(topics);
  // Allow ?style= override for preview purposes
  const styleOverride = req.query.style;
  const previewSubscriber = styleOverride ? { ...subscriber, template_style: styleOverride } : subscriber;
  const html = await renderNewsletter({ subscriber: previewSubscriber, topics, sections });
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// DELETE /api/profile/social-data — Task 8: erase all social enrichment data for a user
app.delete('/api/profile/social-data', async (req, res) => {
  // Accept beta cookie OR HMAC unsubscribe token (same as existing unsubscribe)
  const bodyEmail = (req.body && req.body.email) || req.query.email;
  const queryToken = req.query.token;

  let authed = false;
  let targetEmail = null;

  if (isBetaSession(req)) {
    // Beta cookie auth — email must be in body or query
    if (!bodyEmail) return res.status(400).json({ error: 'email required' });
    authed = true;
    targetEmail = bodyEmail.toLowerCase().trim();
  } else if (bodyEmail && queryToken) {
    // HMAC token auth (same as unsubscribe)
    const expected = generateToken(bodyEmail.toLowerCase().trim());
    if (queryToken === expected) {
      authed = true;
      targetEmail = bodyEmail.toLowerCase().trim();
    }
  }

  if (!authed) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Find subscriber
    const subscriber = db.prepare('SELECT id FROM subscribers WHERE email = ?').get(targetEmail);
    if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });

    // Find all wizard_sessions for this email
    const sessions = db.prepare('SELECT session_id FROM wizard_sessions WHERE email = ?').all(targetEmail);
    const sessionIds = sessions.map(s => s.session_id);

    let rollupsDeleted = 0;
    let sourcesDeleted = 0;

    if (sessionIds.length > 0) {
      const placeholders = sessionIds.map(() => '?').join(',');
      const delRollups = db.prepare(`DELETE FROM social_insight_rollups WHERE session_id IN (${placeholders})`).run(...sessionIds);
      const delSources = db.prepare(`DELETE FROM social_profile_sources WHERE session_id IN (${placeholders})`).run(...sessionIds);
      rollupsDeleted = delRollups.changes;
      sourcesDeleted = delSources.changes;
    }

    // Clear social profile URLs from subscriber record
    db.prepare(`UPDATE subscribers SET
      social_linkedin = NULL, social_instagram = NULL, social_twitter = NULL,
      social_reddit = NULL, social_facebook = NULL
      WHERE email = ?`).run(targetEmail);

    return res.json({
      ok: true,
      sessions_cleared: sessionIds.length,
      rollups_deleted: rollupsDeleted,
      sources_deleted: sourcesDeleted
    });
  } catch (err) {
    console.error('social-data delete error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// POST /api/profile/analyze — infer interests from social profile URLs
app.post('/api/profile/analyze', async (req, res) => {
  const { email, token, urls } = req.body;
  if (!email || !token || !Array.isArray(urls)) {
    return res.status(400).json({ error: 'email, token, and urls[] required' });
  }

  const expected = generateToken(email);
  if (token !== expected) return res.status(403).json({ error: 'Invalid token' });

  try {
    const { inferred, signals } = await inferInterestsFromUrls(urls);
    res.json({ inferred, signals });
  } catch (err) {
    console.error('Profile analyze error:', err);
    res.status(500).json({ error: 'Failed to analyze' });
  }
});

// ─── Subscribe ─────────────────────────────────────────────────────────────────
const { z } = require('zod');

const SubscribeSchema = z.object({
  email:    z.string().email().max(254),
  name:     z.string().max(100).optional(),
  zip_code: z.string().max(10).optional(),
});

// Standard wizard answer — answer field contains the response value
const AnswerSchema = z.object({
  session_id: z.string().uuid(),
  answer: z.union([
    z.string().max(500),
    z.array(z.string().max(80)).max(20),
    z.number(),
    z.boolean(),
    // Object answers for zip_code_with_social (and other combined types except email_and_name)
    z.record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])),
  ]),
});

// Flat email_and_name submission — email/name at top level, no nested answer object.
// This is the ONLY accepted shape for the email_and_name step.
const EmailAndNameSchema = z.object({
  session_id: z.string().uuid(),
  email: z.string().min(1).max(254),
  name:  z.string().max(100).optional().default(''),
});

app.post('/subscribe', async (req, res) => {
  const parsed = SubscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
  const { email, name, zip_code } = parsed.data;

  // Moderation check on name field
  if (name && containsHateSpeech(name)) {
    return res.status(400).json({ error: 'Your response contains content that is not permitted.' });
  }

  try {
    const existing = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);
    let subscriber;

    if (existing) {
      subscriber = existing;
    } else {
      const result = db.prepare(
        'INSERT INTO subscribers (email, name, zip_code) VALUES (?, ?, ?)'
      ).run(email, name || null, zip_code || null);
      subscriber = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(result.lastInsertRowid);
    }

    try {
      await sendWelcomeEmail(subscriber);
    } catch (emailErr) {
      console.error('Welcome email failed:', emailErr.message);
    }

    res.json({
      success: true,
      message: 'Welcome to Spokesbox! Check your inbox.',
      wizard_url: `/wizard?email=${encodeURIComponent(email)}`
    });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── Wizard: Start Session ─────────────────────────────────────────────────────
app.post('/wizard/start', (req, res) => {
  const { email, name } = req.body;

  const session_id = crypto.randomUUID();

  // Initial state machine state (v2: 4 visible steps, no branches)
  const initialState = {
    main_idx:     0,  // index into MAIN_QUESTIONS (current question)
    in_branch:    false,
    branch_queue: [],
    vs:           1,  // virtual step (step number of current question)
    vt:           4   // virtual total: 4 visible steps (email+name, zip+social, topics, preview)
  };

  // If first question is email_and_name, email is submitted via /wizard/answer.
  // Use provided email or a temp placeholder that will be updated on answer.
  const sessionEmail = email || `_pending_${session_id}@tmp.invalid`;
  const initialAnswers = { _ws: initialState };
  if (name) initialAnswers.name = name;

  try {
    db.prepare(
      'INSERT OR REPLACE INTO wizard_sessions (session_id, email, step, answers) VALUES (?, ?, 1, ?)'
    ).run(session_id, sessionEmail, JSON.stringify(initialAnswers));

    const firstQ = MAIN_QUESTIONS[0];
    const resp = {
      session_id,
      step:    1,
      total:   4,
      section: firstQ.section,
      question: firstQ.question,
      type:    firstQ.type,
      key:     firstQ.key,
      optional: firstQ.optional || false,
    };
    // Include type-specific fields
    if (firstQ.type === 'email_and_name') {
      resp.placeholder_email = firstQ.placeholder_email;
      resp.placeholder_name  = firstQ.placeholder_name;
    } else {
      resp.options     = firstQ.options || null;
      resp.placeholder = firstQ.placeholder || null;
      resp.sublabel    = firstQ.sublabel || null;
    }
    res.json(resp);
  } catch (err) {
    console.error('Wizard start error:', err);
    res.status(500).json({ error: 'Failed to start wizard' });
  }
});

// ─── Wizard: Infer Interests from Social Profiles ───────────────────────────
app.post('/wizard/infer-interests', async (req, res) => {
  if (!SOCIAL_ENRICHMENT_ENABLED) {
    return res.status(503).json({ error: 'social_enrichment_disabled', message: 'Social enrichment is not enabled on this server.' });
  }
  const { session_id, urls } = req.body;
  if (!session_id || !Array.isArray(urls)) {
    return res.status(400).json({ error: 'session_id and urls[] required' });
  }
  try {
    const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { inferred, signals } = await inferInterestsFromUrls(urls);

    const answers = JSON.parse(session.answers || '{}');
    answers._inferred_topics = inferred;
    answers._social_signals  = signals;
    db.prepare('UPDATE wizard_sessions SET answers = ? WHERE session_id = ?')
      .run(JSON.stringify(answers), session_id);

    res.json({ inferred, signals });
  } catch (err) {
    console.error('Infer interests error:', err);
    res.status(500).json({ error: 'Failed to infer interests' });
  }
});

// ─── Wizard: Save Answer & Return Next Question ───────────────────────────────
/**
 * State machine logic (v2 — 4-screen flow, no branches):
 * - answers._ws tracks position (main_idx, vs, vt)
 * - email_and_name: accepts {email, name} object, updates session email
 * - zip_code_with_social: accepts {zip_code, social_url} object
 * - topics: just advance (no branch injection)
 * - preview: returns editable_fields for delivery_time and tone chips
 * - complete/terminal: calls applyOnboardingDefaults then done:true
 */
app.post('/wizard/answer', async (req, res) => {
  // email_and_name submissions use flat {session_id, email, name} — no nested answer.
  // All other steps use the standard {session_id, answer} shape.
  const isEmailAndName = !('answer' in req.body) && 'email' in req.body;
  let session_id, answer;
  if (isEmailAndName) {
    const parsed = EmailAndNameSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    session_id = parsed.data.session_id;
    answer     = undefined; // email_and_name reads directly from req.body in its handler
  } else {
    const parsed = AnswerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    session_id = parsed.data.session_id;
    answer     = parsed.data.answer;
  }

  // ── Hate speech / content moderation check ──
  const answerText = Array.isArray(answer) ? answer.join(' ')
    : (answer && typeof answer === 'object') ? Object.values(answer).filter(Boolean).join(' ')
    : String(answer);
  if (containsHateSpeech(answerText)) {
    console.warn(`[MODERATION] Hate speech detected in wizard answer for session ${session_id}`);
    return res.status(400).json({ error: 'Your response contains content that is not permitted. Please revise and try again.' });
  }

  try {
    const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const answers = JSON.parse(session.answers || '{}');
    const state = answers._ws || {
      main_idx: 0, in_branch: false, branch_queue: [], vs: 1, vt: 4
    };

    // ── Migration safety: advance stale sessions to nearest valid idx ─────────
    validateSessionIndex(state);

    // ── Determine current question ────────────────────────────────────────────
    const currentQ = MAIN_QUESTIONS[state.main_idx];

    if (!currentQ) {
      return res.status(400).json({ error: 'No active question — wizard may be complete' });
    }

    // ── email_and_name: read email/name from TOP LEVEL (not nested under answer) ────
    // Canonical shape: { session_id, email, name } — enforced by EmailAndNameSchema.
    // answer is empty/undefined for this step type; reject if something unexpected arrived.
    if (currentQ.type === 'email_and_name') {
      const emailVal = String(req.body.email || '').trim();
      const nameVal  = String(req.body.name  || '').trim();
      // HTML5 standard email pattern — permissive by design, avoids false rejects on
      // punycode TLDs, plus-addressing, mixed-case local parts, hyphenated domains etc.
      const emailRx = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
      if (!emailVal || !emailRx.test(emailVal)) {
        return res.status(400).json({ error: 'A valid email address is required.' });
      }

      db.prepare('UPDATE wizard_sessions SET email = ? WHERE session_id = ?').run(emailVal, session_id);
      answers.email = emailVal;
      if (nameVal) answers.name = nameVal;

      // Ensure subscriber row exists
      db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(emailVal);
      if (nameVal) db.prepare('UPDATE subscribers SET name = COALESCE(name, ?) WHERE email = ?').run(nameVal, emailVal);

    } else if (currentQ.type === 'zip_code_with_social') {
      // ── zip_code_with_social: extract zip + optional social URL ───────────────
      const zipVal    = (answer && typeof answer === 'object') ? String(answer.zip_code   || '').trim() : String(answer).trim();
      const socialUrl = (answer && typeof answer === 'object') ? String(answer.social_url || '').trim() : '';

      answers.zip_code = zipVal;

      if (zipVal) {
        const location = await lookupZip(zipVal);
        if (location.city) {
          answers._city  = location.city;
          answers._state = location.state;
        }
      }

      if (socialUrl) {
        answers.social_profiles = socialUrl;
        answers._enrichment_initiated = true;
        try {
          saveSocialLinks(session_id, [socialUrl]);
          enqueueJob('job_social_enrich', { session_id });
          console.log(`[social] Saved social URL + queued enrichment for ${session_id}`);
        } catch (saveErr) {
          console.error('Social URL save error:', saveErr.message);
        }
        if (SOCIAL_ENRICHMENT_ENABLED) {
          setImmediate(async () => {
            try {
              const { inferred, signals, extracted } = await inferInterestsFromUrls([socialUrl]);
              const sess = db.prepare('SELECT answers FROM wizard_sessions WHERE session_id = ?').get(session_id);
              if (sess) {
                const ans = JSON.parse(sess.answers || '{}');
                ans._inferred_topics = Array.from(inferred);
                ans._social_signals  = signals;
                if (extracted.college) ans.college_sports = extracted.college;
                if (extracted.career)  ans.career_focus   = extracted.career;
                db.prepare('UPDATE wizard_sessions SET answers = ? WHERE session_id = ?')
                  .run(JSON.stringify(ans), session_id);
              }
            } catch (inferErr) {
              console.error('Legacy social inference error:', inferErr.message);
            }
          });
        }
      }

    } else if (!['preview', 'complete'].includes(currentQ.type)) {
      // ── Standard answer save ──────────────────────────────────────────────────
      answers[currentQ.key] = answer;
    }

    // ── Advance state ─────────────────────────────────────────────────────────
    state.main_idx++;
    state.vs++;

    // ── Determine next question ───────────────────────────────────────────────
    const nextQ = MAIN_QUESTIONS[state.main_idx];

    // ── Terminal state: done ──────────────────────────────────────────────────
    if (!nextQ || nextQ.type === 'complete') {
      applyOnboardingDefaults(answers);
      answers._ws = state;
      db.prepare('UPDATE wizard_sessions SET answers = ?, step = ? WHERE session_id = ?')
        .run(JSON.stringify(answers), state.vs, session_id);
      const finalEmail = session.email && !session.email.startsWith('_pending_') ? session.email : (answers.email || null);
      if (finalEmail) {
        try { applyAnswersToSubscriber(finalEmail, answers); } catch (e) {
          console.error('[wizard done] applyAnswers error:', e.message);
        }
        try { enrichSubscriberFromAnswers(finalEmail, answers); } catch (e) {
          console.error('[wizard done] enrich error:', e.message);
        }
      }
      return res.json({ done: true });
    }

    // ── Preview step: generate newsletter sample ──────────────────────────────
    if (nextQ.type === 'preview') {
      applyOnboardingDefaults(answers);
      answers._session_id = session_id;
      const previewSignals = loadSignals(session_id, db, answers);

      if (previewSignals.pending && answers._enrichment_initiated) {
        answers._ws = state;
        db.prepare('UPDATE wizard_sessions SET answers = ?, step = ? WHERE session_id = ?')
          .run(JSON.stringify(answers), state.vs, session_id);
        return res.json({
          type: 'preview_loading',
          poll_url: '/api/wizard/preview-status?session_id=' + session_id,
          estimated_wait_seconds: 8
        });
      }

      if (previewSignals.source === 'none' && answers._inferred_topics) {
        previewSignals.source = 'inferred_fallback';
      }

      const previewHtml = await generateNewsletterPreview(answers, null, null, previewSignals);
      answers._preview_html       = previewHtml;
      answers._preview_iterations = 0;
      answers._ws                 = state;
      db.prepare('UPDATE wizard_sessions SET answers = ?, step = ? WHERE session_id = ?')
        .run(JSON.stringify(answers), state.vs, session_id);

      return res.json({
        step:           state.vs,
        total:          state.vt,
        section:        nextQ.section,
        question:       nextQ.question,
        type:           'preview',
        preview_html:   previewHtml,
        signals_source: previewSignals.source,
        optional:       false,
        editable_fields: {
          delivery_time: answers.delivery_time || '7am',
          tone:          answers.tone          || 'Warm & friendly'
        }
      });
    }

    // ── Standard next question ────────────────────────────────────────────────
    answers._ws = state;
    db.prepare('UPDATE wizard_sessions SET answers = ?, step = ? WHERE session_id = ?')
      .run(JSON.stringify(answers), state.vs, session_id);

    const resp = {
      step:        state.vs,
      total:       state.vt,
      section:     nextQ.section,
      question:    nextQ.question,
      type:        nextQ.type,
      options:     nextQ.options     || null,
      placeholder: nextQ.placeholder || null,
      sub:         nextQ.sub         || null,
      sublabel:    nextQ.sublabel    || null,
      optional:    nextQ.optional    || false,
      key:         nextQ.key,
    };
    if (nextQ.min_selections) resp.min_selections = nextQ.min_selections;
    if (nextQ.display)         resp.display = nextQ.display;
    if (nextQ.groups)          resp.groups  = nextQ.groups;
    if (nextQ.type === 'zip_code_with_social') resp.social_placeholder = nextQ.social_placeholder;
    if (nextQ.key === 'topics' && answers._inferred_topics && answers._inferred_topics.length > 0) {
      resp.preselected = answers._inferred_topics;
    }

    res.json(resp);

  } catch (err) {
    console.error('Wizard answer error:', err);
    res.status(500).json({ error: 'Failed to process answer' });
  }
});

// ─── Wizard: Complete (explicit save) ─────────────────────────────────────────
// LEGACY — wizard.html now calls /api/onboarding-complete. Kept for backward compatibility.
app.post('/wizard/complete', async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Respond immediately — never block on save or send
  res.json({ success: true, message: 'Preferences saved! Your first newsletter is on its way.' });

  // Save preferences (best-effort — don't let this kill the send)
  const answers = JSON.parse(session.answers || '{}');
  try {
    applyAnswersToSubscriber(session.email, answers);
  } catch (saveErr) {
    console.error('applyAnswersToSubscriber error:', saveErr.message, saveErr.stack);
  }

  // Enrich subscriber with any fields not already handled by applyAnswersToSubscriber
  try {
    enrichSubscriberFromAnswers(session.email, answers);
  } catch (enrichErr) {
    console.error('enrichSubscriberFromAnswers error:', enrichErr.message, enrichErr.stack);
  }

  // Send welcome email (clean, no mock content)
  try {
    const name = answers.name || 'friend';
    const deliveryTime = answers.delivery_time || '7am';
    const welcomeHtml = buildWelcomeEmail(name, deliveryTime, session.email);
    await sgMail.send({
      to: session.email,
      from: { email: 'jared@jaredgreen.com', name: 'Spokesbox' },
      replyTo: 'sherlock.claw@gmail.com',
      subject: `Welcome to Spokesbox! 🎉`,
      html: welcomeHtml
    });
    console.log(`✅ Welcome email sent to ${session.email}`);
  } catch (sendErr) {
    console.error('Welcome email send failed:', sendErr.message, sendErr.response?.body);
  }

});


// ─── Onboarding Complete (idempotent — replaces /wizard/complete for new flow) ─
app.post('/api/onboarding-complete', async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const answers = JSON.parse(session.answers || '{}');

  // Save preferences first (idempotent — safe to call multiple times)
  try { applyAnswersToSubscriber(session.email, answers); } catch (e) {
    console.error('[onboarding-complete] applyAnswers error:', e.message);
  }
  try { enrichSubscriberFromAnswers(session.email, answers); } catch (e) {
    console.error('[onboarding-complete] enrich error:', e.message);
  }

  // Idempotency check — only send the email once per subscriber
  const sub = db.prepare('SELECT onboarding_email_sent FROM subscribers WHERE email = ?').get(session.email);
  const alreadySent = sub && sub.onboarding_email_sent === 1;

  if (!alreadySent) {
    // Mark sent BEFORE sending to prevent duplicate sends on retry
    db.prepare(`UPDATE subscribers SET
      onboarding_email_sent   = 1,
      onboarding_completed_at = datetime('now'),
      wizard_complete         = 1
      WHERE email = ?`).run(session.email);

    // Gather personalization fields
    const name         = answers.name || 'there';
    const deliveryTime = answers.delivery_time || '07:00';
    const topics       = answers.topics || '';
    const city         = answers._city  || null;
    const usState      = answers._state || null;

    try {
      const html = buildOnboardingEmail({ name, email: session.email, deliveryTime, topics, city, state: usState });
      await sgMail.send({
        to:       session.email,
        from:     { email: 'jared@jaredgreen.com', name: 'Spokesbox' },
        replyTo:  'sherlock.claw@gmail.com',
        subject:  `You've completed your Spokesbox onboarding! 🎉`,
        html,
      });
      console.log(`[onboarding-complete] Email sent to ${session.email}`);
    } catch (sendErr) {
      console.error('[onboarding-complete] Email send failed:', sendErr.message, sendErr.response?.body);
      // Roll back the flag so a future retry can re-attempt the send
      db.prepare('UPDATE subscribers SET onboarding_email_sent = 0 WHERE email = ?').run(session.email);
    }
  } else {
    console.log(`[onboarding-complete] Already sent for ${session.email} — skipping`);
  }

  res.json({
    success:      true,
    already_sent: alreadySent,
    message:      alreadySent ? 'Already onboarded.' : 'Onboarding complete. Email sent.',
  });

});


// ─── Sam Onboarding — email-first brief generation ───────────────────────────
// Called from the "Meet Sam" screen in the Wizard, right after email capture.
// onboarding_text is what the subscriber typed in their own words.
// Brief generation is fire-and-forget — never blocks the Wizard response.
app.post('/api/sam-onboarding', async (req, res) => {
  const { session_id, onboarding_text } = req.body || {};

  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const sub = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(session.email);
  if (!sub) return res.status(404).json({ error: 'Subscriber not found — complete email step first' });

  const text = typeof onboarding_text === 'string' ? onboarding_text.trim() : '';
  if (!text) return res.status(400).json({ error: 'onboarding_text is required' });
  if (text.length < 30) return res.status(400).json({ error: 'onboarding_text must be at least 30 characters' });
  if (text.length > 5000) return res.status(400).json({ error: 'onboarding_text must be ≤5000 characters' });

  // Respond immediately — do not block the Wizard on Claude latency
  res.json({ success: true, message: 'Sam is reviewing your intro.' });

  // Fire-and-forget: brief generation happens after response is sent
  setImmediate(async () => {
    try {
      await generateBriefFromOnboarding({ subscriberId: sub.id, onboardingText: text, db });
      console.log(`[sam-onboarding] Brief generated for subscriber ${sub.id}`);
    } catch (err) {
      console.error(`[sam-onboarding] Brief generation failed for subscriber ${sub.id} (non-fatal):`, err.message);
    }
  });
});

// ─── Sam Follow-Up Questions ──────────────────────────────────────────────────
// Returns 2–4 domain-specific questions based on the subscriber's initial text.
// Blocking (wizard waits); times out after 8 s client-side.
// Always returns 200 — { questions: [] } on LLM failure so client never breaks.
app.post('/api/sam-onboarding/followup', async (req, res) => {
  const { session_id, onboarding_text } = req.body || {};

  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  if (!onboarding_text || typeof onboarding_text !== 'string') {
    return res.status(400).json({ error: 'onboarding_text required' });
  }

  const text = onboarding_text.trim();
  if (text.length < 10) return res.status(400).json({ error: 'onboarding_text too short' });
  if (text.length > 6000) return res.status(400).json({ error: 'onboarding_text too long' });

  const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const questions = await generateFollowupQuestions(text);
    return res.json({ questions });
  } catch (err) {
    console.warn('[sam-onboarding/followup] LLM failed — returning empty questions:', err.message);
    return res.json({ questions: [] });
  }
});

// ─── Sample Newsletter — post-onboarding preview (auth via session_id) ────────
app.post('/api/sample-newsletter', async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const answers    = JSON.parse(session.answers || '{}');
  const subscriber = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(session.email);
  if (!subscriber)  return res.status(404).json({ error: 'Subscriber not found' });

  // Canonical active topics from DB
  const topicRows = db.prepare('SELECT topic FROM topics WHERE subscriber_id = ? AND enabled = 1').all(subscriber.id);
  let activeTopics = [...new Set(topicRows.map(r => r.topic).filter(Boolean))]; // dedupe

  // If DB is empty, bootstrap from wizard answers and persist to DB so it becomes canonical
  if (activeTopics.length === 0 && answers.topics) {
    const fromAnswers = Array.isArray(answers.topics)
      ? answers.topics
      : answers.topics.split(',').map(t => t.trim()).filter(Boolean);
    if (fromAnswers.length > 0) {
      db.prepare('DELETE FROM topics WHERE subscriber_id = ?').run(subscriber.id);
      const ins = db.prepare('INSERT OR IGNORE INTO topics (subscriber_id, topic, enabled, priority) VALUES (?,?,1,5)');
      fromAnswers.forEach(t => { if (t) ins.run(subscriber.id, t); });
      activeTopics = fromAnswers;
    }
  }

  // Social rollup merge — only when enrichment is enabled AND confidence is above threshold.
  // Explicit wizard topics always take priority.
  // When enrichment is disabled, socialRollup and socialSuggestions are always null/empty.
  let socialRollup     = null;
  let socialSuggestions = [];

  if (SOCIAL_ENRICHMENT_ENABLED) {
    const rollup = db.prepare('SELECT * FROM social_insight_rollups WHERE session_id = ?').get(session_id);
    if (rollup) {
      socialRollup = {
        top_topics:              JSON.parse(rollup.top_topics_json         || '[]'),
        subtopics:               JSON.parse(rollup.subtopics_json          || '[]'),
        locations:               JSON.parse(rollup.locations_json          || '[]'),
        tone_preference:         rollup.tone_preference                    || '',
        sports_teams:            JSON.parse(rollup.sports_teams_json       || '[]'),
        finance_interest_level:  rollup.finance_interest_level             || 'low',
        politics_interest_level: rollup.politics_interest_level            || 'low',
        newsletter_modules:      JSON.parse(rollup.newsletter_modules_json || '[]'),
        confidence:              rollup.confidence                         || 0,
        evidence:                JSON.parse(rollup.evidence_json           || '[]'),
      };
    }
    // Filter social suggestions by confidence threshold — low-confidence inferred
    // topics are dropped here and never reach the UI.
    const MIN_CONF = parseFloat(process.env.SOCIAL_MIN_CONFIDENCE || '0.70');
    socialSuggestions = (socialRollup && socialRollup.confidence >= MIN_CONF)
      ? socialRollup.top_topics.filter(t => t && !activeTopics.includes(t))
      : [];
  }

  // Legacy inferred topics (from HTML scraper in-process path) — only surface when enrichment is on.
  const legacyInferred = SOCIAL_ENRICHMENT_ENABLED && Array.isArray(answers._inferred_topics)
    ? answers._inferred_topics
    : [];

  // Name: prefer wizard answer, fall back to subscriber DB record
  const displayName = answers.name || subscriber.name || null;

  // Merged preview topics: explicit first, then social suggestions (up to 4 total)
  const mergedTopics = [...new Set([...activeTopics, ...socialSuggestions])].slice(0, 6);

  // Generate sample newsletter
  const previewAnswers = { ...answers, name: displayName, topics: mergedTopics.join(',') };
  const previewHtml    = await generateNewsletterPreview(previewAnswers);

  // Is enrichment still running?
  const pendingEnrichment = db.prepare(
    "SELECT COUNT(*) as n FROM social_profile_sources WHERE session_id=? AND status IN ('queued','processing')"
  ).get(session_id)?.n || 0;

  res.json({
    email:              session.email,
    token:              generateToken(session.email),
    activeTopics,
    socialSuggestions,
    legacyInferred,
    socialRollup,
    mergedTopics,
    previewHtml,
    enrichmentPending:  pendingEnrichment > 0,
    status:             'ready',
  });
});

// ─── Sample Newsletter — remove a topic and regenerate preview ────────────────
app.post('/api/sample-newsletter/remove-topic', async (req, res) => {
  const { session_id, topic } = req.body;
  if (!session_id || !topic) return res.status(400).json({ error: 'session_id and topic required' });

  const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const answers    = JSON.parse(session.answers || '{}');
  const subscriber = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(session.email);
  if (!subscriber)  return res.status(404).json({ error: 'Subscriber not found' });

  // Remove topic from DB (canonical state — persists permanently)
  db.prepare('DELETE FROM topics WHERE subscriber_id = ? AND topic = ?').run(subscriber.id, topic);
  db.prepare("UPDATE subscribers SET updated_at = datetime('now') WHERE id = ?").run(subscriber.id);

  // Nullify answers.topics in the wizard session so it can never resurrect a
  // DB-deleted topic via the fallback path in /api/sample-newsletter
  answers.topics = null;
  db.prepare('UPDATE wizard_sessions SET answers = ? WHERE session_id = ?')
    .run(JSON.stringify(answers), session_id);

  // Fetch remaining topics (DB is now the only source of truth)
  const remaining = db.prepare('SELECT topic FROM topics WHERE subscriber_id = ? AND enabled = 1').all(subscriber.id).map(r => r.topic);

  // Regenerate sample with updated topics
  const previewAnswers = { ...answers, topics: remaining.join(',') };
  const previewHtml    = await generateNewsletterPreview(previewAnswers);

  res.json({ activeTopics: remaining, previewHtml, status: 'ready' });
});

// ─── Wizard: Resume Session ─────────────────────────────────────────────────────────────
app.post('/wizard/resume', (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const answers = JSON.parse(session.answers || '{}');
  const state = answers._ws || { main_idx: 0, in_branch: false, branch_queue: [], vs: 1, vt: 4 };

  // Migration safety: advance stale sessions to nearest valid idx
  validateSessionIndex(state);

  const currentQ = MAIN_QUESTIONS[state.main_idx] || MAIN_QUESTIONS[0];
  if (!currentQ || currentQ.type === 'complete') {
    return res.status(400).json({ error: 'Session appears complete' });
  }

  const resp = {
    session_id,
    step:        state.vs    || 1,
    total:       state.vt    || 4,
    section:     currentQ.section,
    question:    currentQ.question,
    type:        currentQ.type,
    options:     currentQ.options     || null,
    placeholder: currentQ.placeholder || null,
    sublabel:    currentQ.sublabel    || null,
    sub:         currentQ.sub         || null,
    optional:    currentQ.optional    || false,
    key:         currentQ.key
  };
  if (currentQ.type === 'email_and_name') {
    resp.placeholder_email = currentQ.placeholder_email;
    resp.placeholder_name  = currentQ.placeholder_name;
  }
  if (currentQ.type === 'zip_code_with_social') {
    resp.social_placeholder = currentQ.social_placeholder;
  }
  res.json(resp);
});

// ─── Wizard: Regenerate Preview ────────────────────────────────────────────────
/**
 * POST /api/wizard/preview
 * Accepts optional user suggestions and returns an updated preview HTML.
 * Limited to 2 regenerations to avoid abuse.
 */
// ─── GET /api/wizard/preview-status — Task 5 ─────────────────────────────────
app.get('/api/wizard/preview-status', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  try {
    const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const answers = JSON.parse(session.answers || '{}');
    answers._session_id = session_id;

    // Check for pending enrichment
    const pendingRow = db.prepare(
      "SELECT COUNT(*) as n FROM social_profile_sources WHERE session_id=? AND status IN ('queued','processing')"
    ).get(session_id);
    const isPending = pendingRow && pendingRow.n > 0;

    if (isPending) {
      return res.json({ status: 'pending' });
    }

    // No pending — render preview (with or without rollup)
    const signals = loadSignals(session_id, db, answers);
    if (signals.source === 'none' && answers._inferred_topics) {
      signals.source = 'inferred_fallback';
    }
    const previewHtml = await generateNewsletterPreview(answers, null, null, signals);

    return res.json({ status: 'ready', preview_html: previewHtml, signals_source: signals.source });
  } catch (err) {
    console.error('preview-status error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/wizard/preview', async (req, res) => {
  const { session_id, suggestions } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  try {
    const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const answers = JSON.parse(session.answers || '{}');
    const iterations = answers._preview_iterations || 0;

    if (iterations >= 2) {
      return res.json({
        preview_html: answers._preview_html,
        max_reached: true,
        message: "You've reached the maximum number of preview updates. Continue to finish setup."
      });
    }

    answers._session_id = session_id;
    const previewSigs = loadSignals(session_id, db, answers);
    if (previewSigs.source === 'none' && answers._inferred_topics) previewSigs.source = 'inferred_fallback';
    const newHtml = await generateNewsletterPreview(answers, suggestions || null, null, previewSigs);
    answers._preview_html = newHtml;
    answers._preview_iterations = iterations + 1;

    db.prepare('UPDATE wizard_sessions SET answers = ? WHERE session_id = ?')
      .run(JSON.stringify(answers), session_id);

    res.json({
      preview_html:  newHtml,
      iterations:    iterations + 1,
      remaining:     2 - (iterations + 1)
    });
  } catch (err) {
    console.error('Preview regeneration error:', err);
    res.status(500).json({ error: 'Failed to regenerate preview' });
  }
});

// ─── Wizard: Update Preview Fields (live chip changes) ───────────────────────────
/**
 * POST /api/wizard/update-preview-fields
 * Updates delivery_time and/or tone, then re-renders the preview HTML.
 * Used by the editable chip UI on the preview step.
 */
app.post('/api/wizard/update-preview-fields', async (req, res) => {
  const { session_id, delivery_time, tone } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  try {
    const session = db.prepare('SELECT * FROM wizard_sessions WHERE session_id = ?').get(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const answers = JSON.parse(session.answers || '{}');

    if (delivery_time) answers.delivery_time = delivery_time;
    if (tone)          answers.tone          = tone;

    // Fill any remaining gaps
    applyOnboardingDefaults(answers);

    answers._session_id = session_id;
    const signals = loadSignals(session_id, db, answers);
    if (signals.source === 'none' && answers._inferred_topics) signals.source = 'inferred_fallback';

    const previewHtml = await generateNewsletterPreview(answers, null, null, signals);
    answers._preview_html = previewHtml;

    db.prepare('UPDATE wizard_sessions SET answers = ? WHERE session_id = ?')
      .run(JSON.stringify(answers), session_id);

    res.json({
      preview_html: previewHtml,
      editable_fields: {
        delivery_time: answers.delivery_time,
        tone:          answers.tone
      }
    });
  } catch (err) {
    console.error('update-preview-fields error:', err);
    res.status(500).json({ error: 'Failed to update preview fields' });
  }
});

// ─── Feedback ──────────────────────────────────────────────────────────────────
app.post('/feedback', async (req, res) => {
  const { email, message } = req.body;
  if (!email || !message) return res.status(400).json({ error: 'email and message required' });

  const mod = await checkContent(message);
  if (!mod.safe) {
    console.warn(`[MODERATION] Feedback blocked for ${email}: ${mod.reason}`);
    return res.status(400).json({ error: 'Your message contains content that violates our guidelines.' });
  }

  try {
    const subscriber = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);
    db.prepare('INSERT INTO feedback (subscriber_id, feedback_text) VALUES (?, ?)')
      .run(subscriber ? subscriber.id : null, message);
    res.json({ success: true });
  } catch (err) {
    console.error('Feedback error:', err);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// ─── Unsubscribe ───────────────────────────────────────────────────────────────
// ─── Promo Code Validation ────────────────────────────────────────────────────
app.post('/api/promo/validate', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ valid: false, error: 'Code required' });
  const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ? AND used = 0').get(code.toUpperCase().trim());
  if (!promo) return res.status(404).json({ valid: false, error: 'Invalid or already used code' });
  res.json({ valid: true, trial_days: promo.trial_days, discount_type: promo.discount_type, assigned_to: promo.assigned_to });
});

// ─── Promo Code Redemption ────────────────────────────────────────────────────
app.post('/api/promo/redeem', (req, res) => {
  const { code, email } = req.body;
  if (!code || !email) return res.status(400).json({ error: 'Code and email required' });
  const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ? AND used = 0').get(code.toUpperCase().trim());
  if (!promo) return res.status(404).json({ error: 'Invalid or already used code' });
  // Mark code as used
  db.prepare('UPDATE promo_codes SET used=1, used_by_email=?, used_at=datetime("now") WHERE id=?').run(email, promo.id);
  // Extend subscriber trial if they exist
  const sub = db.prepare('SELECT id FROM subscribers WHERE email=?').get(email);
  if (sub) {
    db.prepare(`UPDATE subscribers SET trial_active=1, trial_started_at=datetime('now'), trial_end=datetime('now','+${promo.trial_days} days'), updated_at=datetime('now') WHERE id=?`).run(sub.id);
  }
  res.json({ success: true, trial_days: promo.trial_days, message: `${promo.trial_days} days free access activated!` });
});

app.get('/unsubscribe', (req, res) => {
  const { token, email } = req.query;
  if (!token || !email) return res.status(400).sendFile(path.join(__dirname, 'public', 'unsubscribe-invalid.html'));

  const expected = generateToken(decodeURIComponent(email));
  if (token !== expected) return res.status(410).sendFile(path.join(__dirname, 'public', 'unsubscribe-invalid.html'));

  try {
    db.prepare("UPDATE subscribers SET status = 'cancelled', updated_at = datetime('now') WHERE email = ?")
      .run(decodeURIComponent(email));

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Unsubscribed — Spokesbox</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: Inter, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: white; border-radius: 16px; padding: 48px; max-width: 480px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    h1 { color: #1a1a2e; margin-bottom: 16px; }
    p { color: #666; line-height: 1.6; }
    a { color: #00b4d8; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:48px;margin-bottom:16px;">👋</div>
    <h1>You're unsubscribed.</h1>
    <p>Sorry to see you go. You won't receive any more Spokesbox newsletters.</p>
    <p style="margin-top:24px;font-size:14px;color:#aaa;">Changed your mind? <a href="/">Subscribe again</a></p>
  </div>
</body>
</html>`);
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.status(500).send('<h2>Something went wrong. Please try again.</h2>');
  }
});

// ─── Email Reply Processor (SendGrid Inbound Parse) ────────────────────────────
app.post('/inbound', express.urlencoded({ extended: true }), async (req, res) => {
  res.sendStatus(200);

  const fromEmail = (req.body.from || '').match(/<([^>]+)>/)?.[1] || req.body.from || '';
  const rawText  = (req.body.text || '').trim();
  if (!fromEmail || !rawText) return;

  const cleanText = rawText
    .split('\n')
    .filter(line => !line.startsWith('>') && !line.match(/^-{3,}/))
    .join('\n').trim().slice(0, 500);
  if (!cleanText) return;

  console.log(`[INBOUND] Reply from ${fromEmail}: ${cleanText.slice(0, 100)}`);

  const mod = await checkContent(cleanText);
  if (!mod.safe) {
    console.warn(`[MODERATION] Reply blocked from ${fromEmail}: ${mod.reason}`);
    return;
  }

  const subscriber = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(fromEmail.toLowerCase());
  if (!subscriber) { console.log(`[INBOUND] Unknown sender: ${fromEmail}`); return; }

  try {
    const prefs = JSON.parse(subscriber.preferences || '{}');
    const instructions = prefs.replyInstructions || [];
    instructions.push({ text: cleanText, ts: Date.now() });
    if (instructions.length > 20) instructions.shift();
    prefs.replyInstructions = instructions;

    db.prepare('UPDATE subscribers SET preferences = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?')
      .run(JSON.stringify(prefs), fromEmail.toLowerCase());

    console.log(`[INBOUND] Preference updated for ${fromEmail}`);
  } catch (err) {
    console.error('[INBOUND] Error:', err);
  }
});

// ─── Moderation Test Endpoint ──────────────────────────────────────────────────
app.post('/moderate', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  res.json(await checkContent(text));
});

// ─── Admin: User Briefs ───────────────────────────────────────────────────────
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'spokesbox-admin-2026';

function requireAdmin(req, res) {
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// GET /admin/brief/:subscriber_id — current brief + last 10 history entries
app.get('/admin/brief/:subscriber_id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const subscriberId = parseInt(req.params.subscriber_id, 10);
  if (!Number.isInteger(subscriberId) || subscriberId <= 0) {
    return res.status(400).json({ error: 'Invalid subscriber_id' });
  }
  const subscriber = db.prepare('SELECT id FROM subscribers WHERE id = ?').get(subscriberId);
  if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });

  const brief   = getBrief(db, subscriberId);
  const history = getBriefHistory(db, subscriberId, 10);
  res.json({ brief, history });
});

// PUT /admin/brief/:subscriber_id — save/update brief (editedBy='system')
app.put('/admin/brief/:subscriber_id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const subscriberId = parseInt(req.params.subscriber_id, 10);
  if (!Number.isInteger(subscriberId) || subscriberId <= 0) {
    return res.status(400).json({ error: 'Invalid subscriber_id' });
  }
  const subscriber = db.prepare('SELECT id FROM subscribers WHERE id = ?').get(subscriberId);
  if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });

  const { brief_text, edit_reason } = req.body || {};
  if (!brief_text || typeof brief_text !== 'string' || !brief_text.trim()) {
    return res.status(400).json({ error: 'brief_text is required' });
  }

  try {
    const saved = saveBrief(db, {
      subscriberId,
      briefText: brief_text.trim(),
      editedBy: 'system',
      editReason: edit_reason || null,
    });
    res.json({ ok: true, brief: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /admin/brief/:subscriber_id — soft delete
app.delete('/admin/brief/:subscriber_id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const subscriberId = parseInt(req.params.subscriber_id, 10);
  if (!Number.isInteger(subscriberId) || subscriberId <= 0) {
    return res.status(400).json({ error: 'Invalid subscriber_id' });
  }
  const subscriber = db.prepare('SELECT id FROM subscribers WHERE id = ?').get(subscriberId);
  if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });

  deleteBrief(db, subscriberId);
  res.json({ ok: true });
});

// POST /admin/brief/:subscriber_id/generate — LLM brief generation from onboarding text
app.post('/admin/brief/:subscriber_id/generate', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const subscriberId = parseInt(req.params.subscriber_id, 10);
  if (!Number.isInteger(subscriberId) || subscriberId <= 0) {
    return res.status(400).json({ error: 'Invalid subscriber_id' });
  }
  const subscriber = db.prepare('SELECT id FROM subscribers WHERE id = ?').get(subscriberId);
  if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });

  const { onboarding_text, clarifier_text } = req.body || {};
  if (!onboarding_text || typeof onboarding_text !== 'string') {
    return res.status(400).json({ error: 'onboarding_text is required' });
  }
  if (onboarding_text.trim().length < 30) {
    return res.status(400).json({ error: 'onboarding_text must be at least 30 characters' });
  }
  if (onboarding_text.length > 5000) {
    return res.status(400).json({ error: 'onboarding_text must be ≤5000 characters' });
  }

  try {
    const result = await generateBriefFromOnboarding({
      subscriberId,
      onboardingText: onboarding_text.trim(),
      clarifierText: clarifier_text || null,
      db,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/brief/:subscriber_id/update-from-reply — update brief from reader reply
app.post('/admin/brief/:subscriber_id/update-from-reply', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const subscriberId = parseInt(req.params.subscriber_id, 10);
  if (!Number.isInteger(subscriberId) || subscriberId <= 0) {
    return res.status(400).json({ error: 'Invalid subscriber_id' });
  }

  const { reply_text } = req.body || {};
  if (!reply_text || typeof reply_text !== 'string' || reply_text.trim().length < 1) {
    return res.status(400).json({ error: 'reply_text is required' });
  }
  if (reply_text.length > 5000) {
    return res.status(400).json({ error: 'reply_text must be ≤5000 characters' });
  }

  try {
    const result = await updateBriefFromReply({ subscriberId, replyText: reply_text.trim(), db });
    res.json({ ok: true, ...result });
  } catch (err) {
    // 404-class error: no existing brief
    if (err.message.includes('no existing brief')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/subscribers — list all subscribers with brief status
// Inspection surface for PR3: quickly confirm whether onboarding wired Sam brief generation.
app.get('/admin/subscribers', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = db.prepare(`
      SELECT
        s.id, s.email, s.name, s.status, s.wizard_complete,
        s.onboarding_completed_at, s.created_at,
        ub.brief_version,
        ub.last_edited_by   AS brief_edited_by,
        ub.last_edited_at   AS brief_edited_at,
        CASE WHEN ub.id IS NOT NULL THEN 1 ELSE 0 END AS has_brief
      FROM subscribers s
      LEFT JOIN user_briefs ub ON ub.subscriber_id = s.id
      ORDER BY s.id DESC
    `).all();
    res.json({ count: rows.length, subscribers: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Custom 404 handler ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404);
  if (req.accepts('html')) return res.sendFile(path.join(__dirname, 'public', '404.html'));
  if (req.accepts('json')) return res.json({ error: 'Not found', path: req.path });
  res.type('txt').send('Not found');
});

// ─── Start ─────────────────────────────────────────────────────────────────────

// ─── Job Queue Worker ────────────────────────────────────────────────────────
const JOB_HANDLERS = {
  job_social_enrich: require('./jobs/job_social_enrich'),
};

function enqueueJob(name, payload) {
  db.prepare("INSERT INTO job_queue (job_name, payload_json) VALUES (?,?)").run(name, JSON.stringify(payload));
}

async function processNextJob() {
  const job = db.prepare(
    "SELECT * FROM job_queue WHERE status='pending' AND run_after <= datetime('now') ORDER BY id ASC LIMIT 1"
  ).get();
  if (!job) return;
  db.prepare("UPDATE job_queue SET status='running', attempts=attempts+1 WHERE id=?").run(job.id);
  const handler = JOB_HANDLERS[job.job_name];
  if (!handler) {
    db.prepare("UPDATE job_queue SET status='failed', last_error=? WHERE id=?").run('No handler', job.id);
    return;
  }
  try {
    await handler.run({ ...JSON.parse(job.payload_json || '{}'), db });
    db.prepare("UPDATE job_queue SET status='done', completed_at=datetime('now') WHERE id=?").run(job.id);
  } catch (err) {
    console.error(`[job_queue] ${job.job_name} failed:`, err.message);
    const newStatus = job.attempts >= 3 ? 'failed' : 'pending';
    db.prepare("UPDATE job_queue SET status=?, last_error=?, run_after=datetime('now','+60 seconds') WHERE id=?")
      .run(newStatus, err.message, job.id);
  }
}
setInterval(() => { processNextJob().catch(e => console.error('[job_queue]', e.message)); }, 5000);

// ─── Social URL helpers ──────────────────────────────────────────────────────
const PLATFORM_PATTERNS = [
  { platform: 'linkedin',  pattern: /linkedin\.com/i },
  { platform: 'instagram', pattern: /instagram\.com/i },
  { platform: 'twitter',   pattern: /(twitter|x)\.com/i },
  { platform: 'facebook',  pattern: /facebook\.com/i },
  { platform: 'reddit',    pattern: /(reddit\.com|^\/u\/)/i },
];

function detectPlatform(url) {
  for (const { platform, pattern } of PLATFORM_PATTERNS) {
    if (pattern.test(url)) return platform;
  }
  return 'unknown';
}

function normalizeProfileUrl(url) {
  if (!url) return url;
  url = url.trim();
  if (!url.startsWith('http')) url = 'https://' + url;
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch (_) { return url; }
}

function saveSocialLinks(session_id, urls) {
  db.prepare("DELETE FROM social_profile_sources WHERE session_id=? AND status='queued'").run(session_id);
  const ins = db.prepare(
    "INSERT OR IGNORE INTO social_profile_sources (session_id, platform, source_url, normalized_url, status) VALUES (?,?,?,?,'queued')"
  );
  for (const url of urls) {
    if (!url || url.length < 10) continue;
    const normalized = normalizeProfileUrl(url);
    const platform   = detectPlatform(url);
    if (platform === 'unknown') continue;
    ins.run(session_id, platform, url, normalized);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Spokesbox running on http://localhost:${PORT}`);
});
