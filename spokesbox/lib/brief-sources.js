'use strict';
/**
 * brief-sources.js — Curated source allowlist for Brief Tuning (PR 1)
 *
 * Users may only select sources from this list.
 * Free-text source suggestions are stored separately as suggestions (not used
 * in generation until reviewed and added here).
 *
 * Structure:
 *   ALLOWED_SOURCES[bucket] = [{ id, name, domain, tags }]
 *
 * Rules:
 *   - Users select by `id`
 *   - Generation prompt references `name` + `domain`
 *   - `tags` allow cross-bucket lookup (e.g. "crypto" appears in Finance + Tech)
 *   - Adding a source requires code change here — not user input
 */

const ALLOWED_SOURCES = {

  Finance: [
    { id: 'bloomberg',      name: 'Bloomberg',               domain: 'bloomberg.com',        tags: ['markets', 'macro', 'crypto'] },
    { id: 'wsj',            name: 'Wall Street Journal',     domain: 'wsj.com',              tags: ['markets', 'macro', 'business'] },
    { id: 'ft',             name: 'Financial Times',         domain: 'ft.com',               tags: ['markets', 'macro', 'global'] },
    { id: 'axios_markets',  name: 'Axios Markets',           domain: 'axios.com',            tags: ['markets', 'briefing'] },
    { id: 'barrons',        name: "Barron's",                domain: 'barrons.com',          tags: ['markets', 'stocks', 'analysis'] },
    { id: 'seekingalpha',   name: 'Seeking Alpha',           domain: 'seekingalpha.com',     tags: ['stocks', 'analysis'] },
    { id: 'motley_fool',    name: 'The Motley Fool',         domain: 'fool.com',             tags: ['stocks', 'investing'] },
    { id: 'coindesk',       name: 'CoinDesk',                domain: 'coindesk.com',         tags: ['crypto', 'web3'] },
    { id: 'theblock',       name: 'The Block',               domain: 'theblock.co',          tags: ['crypto', 'defi'] },
    { id: 'yahoo_finance',  name: 'Yahoo Finance',           domain: 'finance.yahoo.com',    tags: ['markets', 'stocks', 'briefing'] },
  ],

  Sports: [
    { id: 'espn',           name: 'ESPN',                    domain: 'espn.com',             tags: ['nba', 'nfl', 'mlb', 'soccer', 'college'] },
    { id: 'the_athletic',   name: 'The Athletic',            domain: 'theathletic.com',      tags: ['nba', 'nfl', 'mlb', 'soccer', 'analysis'] },
    { id: 'cbs_sports',     name: 'CBS Sports',              domain: 'cbssports.com',        tags: ['nba', 'nfl', 'mlb', 'college'] },
    { id: 'si',             name: 'Sports Illustrated',      domain: 'si.com',               tags: ['nba', 'nfl', 'mlb', 'college'] },
    { id: 'bleacher_report',name: 'Bleacher Report',         domain: 'bleacherreport.com',   tags: ['nba', 'nfl', 'mlb', 'soccer'] },
    { id: 'nba_official',   name: 'NBA.com',                 domain: 'nba.com',              tags: ['nba'] },
    { id: 'goal',           name: 'Goal.com',                domain: 'goal.com',             tags: ['soccer', 'premier_league', 'mls'] },
    { id: 'the_ringer',     name: 'The Ringer',              domain: 'theringer.com',        tags: ['nba', 'nfl', 'analysis', 'culture'] },
    { id: 'athletic_duke',  name: 'The Athletic (Duke)',     domain: 'theathletic.com',      tags: ['college', 'duke'] },
    { id: 'on3',            name: 'On3',                     domain: 'on3.com',              tags: ['college', 'recruiting'] },
  ],

  Tech: [
    { id: 'techcrunch',     name: 'TechCrunch',              domain: 'techcrunch.com',       tags: ['startups', 'vc', 'ai'] },
    { id: 'the_verge',      name: 'The Verge',               domain: 'theverge.com',         tags: ['consumer_tech', 'ai', 'gadgets'] },
    { id: 'wired',          name: 'Wired',                   domain: 'wired.com',            tags: ['ai', 'science', 'culture'] },
    { id: 'ars_technica',   name: 'Ars Technica',            domain: 'arstechnica.com',      tags: ['deep_tech', 'science', 'ai'] },
    { id: 'tldr_tech',      name: 'TLDR Tech',               domain: 'tldr.tech',            tags: ['ai', 'startups', 'briefing'] },
    { id: 'axios_tech',     name: 'Axios Tech',              domain: 'axios.com',            tags: ['ai', 'startups', 'briefing'] },
    { id: 'mit_tech',       name: 'MIT Technology Review',   domain: 'technologyreview.com', tags: ['deep_tech', 'ai', 'science'] },
    { id: 'semafor_tech',   name: 'Semafor Tech',            domain: 'semafor.com',          tags: ['ai', 'policy', 'global'] },
  ],

  Local: [
    { id: 'nj_com',         name: 'NJ.com',                  domain: 'nj.com',               tags: ['new_jersey', 'local_news'] },
    { id: 'tap_into',       name: 'TAPinto (South Orange)',   domain: 'tapinto.net',          tags: ['south_orange', 'maplewood', 'local_news'] },
    { id: 'village_green',  name: 'Village Green NJ',        domain: 'villagegreennj.com',   tags: ['south_orange', 'maplewood', 'essex_county'] },
    { id: 'patch',          name: 'Patch (South Orange)',     domain: 'patch.com',            tags: ['south_orange', 'local_news'] },
    { id: 'star_ledger',    name: 'NJ Star-Ledger',          domain: 'nj.com',               tags: ['new_jersey', 'statewide'] },
  ],

  World: [
    { id: 'reuters',        name: 'Reuters',                 domain: 'reuters.com',          tags: ['world', 'wire', 'breaking'] },
    { id: 'ap',             name: 'AP News',                 domain: 'apnews.com',           tags: ['world', 'wire', 'breaking'] },
    { id: 'bbc',            name: 'BBC News',                domain: 'bbc.com',              tags: ['world', 'uk', 'analysis'] },
    { id: 'the_economist',  name: 'The Economist',           domain: 'economist.com',        tags: ['world', 'analysis', 'macro'] },
    { id: 'axios_world',    name: 'Axios World',             domain: 'axios.com',            tags: ['world', 'briefing'] },
    { id: 'semafor',        name: 'Semafor',                 domain: 'semafor.com',          tags: ['world', 'africa', 'analysis'] },
    { id: 'foreign_policy', name: 'Foreign Policy',          domain: 'foreignpolicy.com',    tags: ['geopolitics', 'analysis'] },
  ],

  Politics: [
    { id: 'axios_politics', name: 'Axios Politics',          domain: 'axios.com',            tags: ['politics', 'dc', 'briefing'] },
    { id: 'politico',       name: 'Politico',                domain: 'politico.com',         tags: ['politics', 'dc', 'congress'] },
    { id: 'the_hill',       name: 'The Hill',                domain: 'thehill.com',          tags: ['politics', 'dc', 'congress'] },
    { id: 'nyt_politics',   name: 'NYT Politics',            domain: 'nytimes.com',          tags: ['politics', 'dc'] },
    { id: 'wapo_politics',  name: 'Washington Post Politics',domain: 'washingtonpost.com',   tags: ['politics', 'dc', 'investigations'] },
  ],

  Lifestyle: [
    { id: 'nyt_cooking',    name: 'NYT Cooking',             domain: 'cooking.nytimes.com',  tags: ['food', 'recipes'] },
    { id: 'bon_appetit',    name: 'Bon Appétit',             domain: 'bonappetit.com',       tags: ['food', 'recipes', 'culture'] },
    { id: 'gq',             name: 'GQ',                      domain: 'gq.com',               tags: ['style', 'culture', 'men'] },
    { id: 'nyt_wirecutter', name: 'Wirecutter',              domain: 'nytimes.com/wirecutter', tags: ['gear', 'reviews'] },
    { id: 'outside_mag',    name: 'Outside Magazine',        domain: 'outsideonline.com',    tags: ['outdoors', 'fitness'] },
  ],

  Art: [
    { id: 'artsy',          name: 'Artsy',                   domain: 'artsy.net',            tags: ['art_market', 'galleries', 'auctions'] },
    { id: 'artnews',        name: 'ARTnews',                 domain: 'artnews.com',          tags: ['art_market', 'artists', 'exhibitions'] },
    { id: 'theartnewspaper',name: 'The Art Newspaper',       domain: 'theartnewspaper.com',  tags: ['art_market', 'auctions', 'museums'] },
    { id: 'christies_news', name: "Christie's News",         domain: 'christies.com',        tags: ['auctions', 'sales'] },
    { id: 'sothebys_news',  name: "Sotheby's News",          domain: 'sothebys.com',         tags: ['auctions', 'sales'] },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get all sources for a given bucket.
 * Returns [] for unknown buckets.
 */
function getSourcesForBucket(bucket) {
  return ALLOWED_SOURCES[bucket] || [];
}

/**
 * Validate that a source ID is allowed for a given bucket.
 */
function isSourceAllowed(bucket, sourceId) {
  const sources = getSourcesForBucket(bucket);
  return sources.some(s => s.id === sourceId);
}

/**
 * Validate an array of source IDs against a bucket.
 * Returns { valid: string[], invalid: string[] }
 */
function validateSources(bucket, sourceIds) {
  const allowed = getSourcesForBucket(bucket).map(s => s.id);
  const valid   = sourceIds.filter(id => allowed.includes(id));
  const invalid = sourceIds.filter(id => !allowed.includes(id));
  return { valid, invalid };
}

/**
 * Get all allowed bucket names.
 */
function getAllBuckets() {
  return Object.keys(ALLOWED_SOURCES);
}

/**
 * Store a free-text source suggestion (not used in generation).
 * Caller must pass db. Stored for future review only.
 */
function storeSuggestion(db, subscriberId, bucket, suggestedSource) {
  db.prepare(`
    INSERT INTO brief_source_suggestions
      (subscriber_id, bucket, suggested_source, created_at)
    VALUES (?, ?, ?, ?)
  `).run(subscriberId, bucket, String(suggestedSource).slice(0, 200), Date.now());
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  ALLOWED_SOURCES,
  getSourcesForBucket,
  isSourceAllowed,
  validateSources,
  getAllBuckets,
  storeSuggestion,
};
