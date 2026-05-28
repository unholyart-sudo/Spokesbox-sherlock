'use strict';
/**
 * kids-news/history.js — Persistent deduplication history for Avi's Kids Newsletter
 *
 * Tracks: stories (topics), jokes, trivia
 * Enforces: 14-day topic cooldown, 30-day URL cooldown, 90-day joke/trivia cooldown
 * Storage: kids-news/history.json (plain JSON, always use write() not edit())
 * Retention: 120 days max per entry type
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const HISTORY_PATH = path.join(__dirname, 'history.json');

// ─── Dedup windows (days) ─────────────────────────────────────────────────────
const WINDOWS = {
  topic_same_url:     30,
  topic_same_entity:  14,
  joke:               90,
  trivia_question:    90,
  trivia_answer:      30,
  music_artist:       30,
  riddle_type:        21,
  israel_topic:       14,
  zoey_pop_artist:    21,
  science_topic:      14,
};
const RETENTION_DAYS = 120;

// ─── Normalisation ────────────────────────────────────────────────────────────

function normalise(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(the|a|an|is|was|are|were|to|of|and|or|in|on|at|for|by|with|has|have|had)\b/g, '')
    .replace(/\b(20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashStr(s) {
  return crypto.createHash('sha1').update(s || '').digest('hex').slice(0, 12);
}

function daysSince(dateISO) {
  const then = new Date(dateISO + 'T00:00:00Z');
  const now  = new Date();
  return Math.floor((now - then) / 86400000);
}

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// ─── Load / save ──────────────────────────────────────────────────────────────

function load() {
  const defaults = { stories: [], jokes: [], trivia: [], music: [], riddles: [], israel_topics: [], zoey_pop: [], science_topics: [] };
  if (!fs.existsSync(HISTORY_PATH)) {
    return { ...defaults };
  }
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    // Ensure new fields are present for forward compat
    return { ...defaults, ...data };
  } catch (e) {
    console.error('kids-news/history.js: load error:', e.message);
    return { ...defaults };
  }
}

function save(h) {
  // Always use full overwrite (never edit) — per MEMORY.md rule
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(h, null, 2));
}

// ─── Prune old entries ────────────────────────────────────────────────────────

function prune(h) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const keep = e => new Date(e.date + 'T00:00:00Z') >= cutoff;
  return {
    stories:       h.stories.filter(keep),
    jokes:         h.jokes.filter(keep),
    trivia:        h.trivia.filter(keep),
    music:         h.music.filter(keep),
    riddles:       h.riddles.filter(keep),
    israel_topics: (h.israel_topics || []).filter(keep),
    zoey_pop:      (h.zoey_pop || []).filter(keep),
    science_topics:(h.science_topics || []).filter(keep),
  };
}

// ─── Duplicate checks ─────────────────────────────────────────────────────────

function checkStory(h, { url, topic }) {
  const normTopic = normalise(topic);
  const topicHash = hashStr(normTopic);
  const urlHash   = hashStr(url || '');

  for (const s of h.stories) {
    // Exact URL match within 30 days
    if (url && s.url_hash === urlHash && daysSince(s.date) < WINDOWS.topic_same_url) {
      return { duplicate: true, reason: `Same URL used ${daysSince(s.date)}d ago`, window: WINDOWS.topic_same_url };
    }
    // Similar topic within 14 days
    if (s.topic_hash === topicHash && daysSince(s.date) < WINDOWS.topic_same_entity) {
      return { duplicate: true, reason: `Same topic used ${daysSince(s.date)}d ago`, window: WINDOWS.topic_same_entity };
    }
  }
  return { duplicate: false };
}

function checkJoke(h, jokeText) {
  const norm = normalise(jokeText);
  const hash = hashStr(norm);
  for (const j of h.jokes) {
    if (j.hash === hash && daysSince(j.date) < WINDOWS.joke) {
      return { duplicate: true, reason: `Same joke used ${daysSince(j.date)}d ago` };
    }
    // Near-duplicate: >70% word overlap
    if (daysSince(j.date) < WINDOWS.joke && wordOverlap(norm, j.normalized) > 0.7) {
      return { duplicate: true, reason: `Near-duplicate joke used ${daysSince(j.date)}d ago` };
    }
  }
  return { duplicate: false };
}

function checkTrivia(h, { question, answer }) {
  const normQ = normalise(question);
  const normA = normalise(answer || '');
  const hashQ = hashStr(normQ);
  const hashA = hashStr(normA);
  for (const t of h.trivia) {
    if (t.question_hash === hashQ && daysSince(t.date) < WINDOWS.trivia_question) {
      return { duplicate: true, reason: `Same trivia question used ${daysSince(t.date)}d ago` };
    }
    if (normA && t.answer_hash === hashA && daysSince(t.date) < WINDOWS.trivia_answer) {
      return { duplicate: true, reason: `Same trivia answer used ${daysSince(t.date)}d ago` };
    }
  }
  return { duplicate: false };
}

function checkMusic(h, artist) {
  const norm = normalise(artist);
  for (const m of h.music) {
    if (normalise(m.artist) === norm && daysSince(m.date) < WINDOWS.music_artist) {
      return { duplicate: true, reason: `${artist} featured ${daysSince(m.date)}d ago` };
    }
  }
  return { duplicate: false };
}

function checkRiddle(h, riddleDesc) {
  const norm = normalise(riddleDesc);
  const hash = hashStr(norm);
  for (const r of h.riddles) {
    if (r.hash === hash && daysSince(r.date) < WINDOWS.riddle_type) {
      return { duplicate: true, reason: `Same riddle used ${daysSince(r.date)}d ago` };
    }
    if (wordOverlap(norm, r.normalized) > 0.65 && daysSince(r.date) < WINDOWS.riddle_type) {
      return { duplicate: true, reason: `Similar riddle used ${daysSince(r.date)}d ago` };
    }
  }
  return { duplicate: false };
}

function wordOverlap(a, b) {
  const setA = new Set(a.split(' ').filter(w => w.length > 3));
  const setB = new Set(b.split(' ').filter(w => w.length > 3));
  if (setA.size === 0 || setB.size === 0) return 0;
  let common = 0;
  for (const w of setA) if (setB.has(w)) common++;
  return common / Math.max(setA.size, setB.size);
}

// ─── Add used entries ─────────────────────────────────────────────────────────

function addStory(h, { url, topic, title }) {
  h.stories.push({
    date:        todayISO(),
    title:       title || topic || '',
    topic_hash:  hashStr(normalise(topic || title || '')),
    url_hash:    hashStr(url || ''),
    url:         url || '',
    normalized:  normalise(topic || title || ''),
  });
}

function addJoke(h, jokeText) {
  const norm = normalise(jokeText);
  h.jokes.push({
    date:       todayISO(),
    text:       jokeText.slice(0, 300),
    normalized: norm,
    hash:       hashStr(norm),
  });
}

function addTrivia(h, { question, answer, category }) {
  const normQ = normalise(question);
  const normA = normalise(answer || '');
  h.trivia.push({
    date:          todayISO(),
    question:      question.slice(0, 300),
    answer:        (answer || '').slice(0, 200),
    category:      category || 'general',
    question_hash: hashStr(normQ),
    answer_hash:   hashStr(normA),
    normalized_q:  normQ,
  });
}

function addMusic(h, artist) {
  h.music.push({ date: todayISO(), artist });
}

function addRiddle(h, riddleDesc) {
  const norm = normalise(riddleDesc);
  h.riddles.push({
    date:       todayISO(),
    text:       riddleDesc.slice(0, 200),
    normalized: norm,
    hash:       hashStr(norm),
  });
}

// ─── Israel Topics ────────────────────────────────────────────────────────────

function checkIsraelTopic(h, topicDesc) {
  const norm = normalise(topicDesc);
  const hash = hashStr(norm);
  for (const t of (h.israel_topics || [])) {
    if (t.hash === hash && daysSince(t.date) < WINDOWS.israel_topic) {
      return { duplicate: true, reason: `Same Israel topic used ${daysSince(t.date)}d ago` };
    }
    if (wordOverlap(norm, t.normalized) > 0.6 && daysSince(t.date) < WINDOWS.israel_topic) {
      return { duplicate: true, reason: `Similar Israel topic used ${daysSince(t.date)}d ago` };
    }
  }
  return { duplicate: false };
}

function addIsraelTopic(h, topicDesc) {
  const norm = normalise(topicDesc);
  if (!h.israel_topics) h.israel_topics = [];
  h.israel_topics.push({
    date:       todayISO(),
    text:       topicDesc.slice(0, 200),
    normalized: norm,
    hash:       hashStr(norm),
  });
}

// ─── Zoey Pop ─────────────────────────────────────────────────────────────────

function checkZoeyPop(h, artistName) {
  const norm = normalise(artistName);
  for (const z of (h.zoey_pop || [])) {
    if (normalise(z.artist) === norm && daysSince(z.date) < WINDOWS.zoey_pop_artist) {
      return { duplicate: true, reason: `${artistName} featured for Zoey ${daysSince(z.date)}d ago` };
    }
  }
  return { duplicate: false };
}

function addZoeyPop(h, artistName) {
  if (!h.zoey_pop) h.zoey_pop = [];
  h.zoey_pop.push({ date: todayISO(), artist: artistName });
}

// ─── Science Topics ──────────────────────────────────────────────────────────

function checkScienceTopic(h, topicDesc) {
  const norm = normalise(topicDesc);
  const hash = hashStr(norm);
  for (const s of (h.science_topics || [])) {
    if (s.hash === hash && daysSince(s.date) < WINDOWS.science_topic) {
      return { duplicate: true, reason: `Same science topic used ${daysSince(s.date)}d ago` };
    }
    if (wordOverlap(norm, s.normalized) > 0.6 && daysSince(s.date) < WINDOWS.science_topic) {
      return { duplicate: true, reason: `Similar science topic used ${daysSince(s.date)}d ago` };
    }
  }
  return { duplicate: false };
}

function addScienceTopic(h, topicDesc) {
  const norm = normalise(topicDesc);
  if (!h.science_topics) h.science_topics = [];
  h.science_topics.push({
    date:       todayISO(),
    text:       topicDesc.slice(0, 200),
    normalized: norm,
    hash:       hashStr(norm),
  });
}

// ─── Build "avoid" prompt injection ──────────────────────────────────────────

function buildAvoidList(h) {
  const cutoff = d => daysSince(d) < RETENTION_DAYS;

  const recentTopics = h.stories
    .filter(s => cutoff(s.date))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 30)
    .map(s => `  - "${s.title || s.normalized}" (${s.date}${s.url ? ` — ${s.url}` : ''})`);

  const recentJokes = h.jokes
    .filter(j => daysSince(j.date) < WINDOWS.joke)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20)
    .map(j => `  - "${j.text.slice(0, 100)}" (${j.date})`);

  const recentTrivia = h.trivia
    .filter(t => daysSince(t.date) < WINDOWS.trivia_question)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20)
    .map(t => `  - Q: "${t.question.slice(0, 100)}" A: "${t.answer.slice(0, 60)}" (${t.date})`);

  const recentMusic = h.music
    .filter(m => daysSince(m.date) < WINDOWS.music_artist)
    .map(m => m.artist);

  const recentRiddles = h.riddles
    .filter(r => daysSince(r.date) < WINDOWS.riddle_type)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10)
    .map(r => `  - "${r.text.slice(0, 100)}" (${r.date})`);

  const recentIsraelTopics = (h.israel_topics || [])
    .filter(t => daysSince(t.date) < WINDOWS.israel_topic)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10)
    .map(t => `  - "${t.text.slice(0, 100)}" (${t.date})`);

  const recentZoeyPop = (h.zoey_pop || [])
    .filter(z => daysSince(z.date) < WINDOWS.zoey_pop_artist)
    .map(z => z.artist);

  const recentScienceTopics = (h.science_topics || [])
    .filter(s => daysSince(s.date) < WINDOWS.science_topic)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10)
    .map(s => `  - "${s.text.slice(0, 100)}" (${s.date})`);

  return {
    topics:         recentTopics,
    jokes:          recentJokes,
    trivia:         recentTrivia,
    music:          recentMusic,
    riddles:        recentRiddles,
    israel_topics:  recentIsraelTopics,
    zoey_pop:       recentZoeyPop,
    science_topics: recentScienceTopics,
  };
}

function buildPromptBlock(h) {
  const avoids = buildAvoidList(h);
  const lines  = ['## DEDUPLICATION — DO NOT REPEAT THE FOLLOWING\n'];

  if (avoids.topics.length > 0) {
    lines.push(`### Recent story topics (avoid for 14 days unless new development):\n${avoids.topics.join('\n')}\n`);
  }
  if (avoids.jokes.length > 0) {
    lines.push(`### Recent jokes (do NOT reuse within 90 days — no near-duplicates either):\n${avoids.jokes.join('\n')}\n`);
  }
  if (avoids.trivia.length > 0) {
    lines.push(`### Recent trivia questions (do NOT reuse within 90 days):\n${avoids.trivia.join('\n')}\n`);
  }
  if (avoids.riddles.length > 0) {
    lines.push(`### Recent riddles (do NOT reuse within 21 days):\n${avoids.riddles.join('\n')}\n`);
  }
  if (avoids.music.length > 0) {
    lines.push(`### Recent music artists (do NOT repeat within 30 days): ${avoids.music.join(', ')}\n`);
  }
  if (avoids.israel_topics.length > 0) {
    lines.push(`### Recent Israel topics (do NOT repeat within 14 days):\n${avoids.israel_topics.join('\n')}\n`);
  }
  if (avoids.zoey_pop.length > 0) {
    lines.push(`### Recent Zoey pop artists (do NOT repeat within 21 days): ${avoids.zoey_pop.join(', ')}\n`);
  }
  if (avoids.science_topics.length > 0) {
    lines.push(`### Recent science topics (do NOT repeat within 14 days):\n${avoids.science_topics.join('\n')}\n`);
  }
  lines.push('If covering an ongoing story, include it ONLY if there is a meaningful new development, and label it clearly as "📌 UPDATE:".');
  lines.push('Every joke and trivia question must be completely fresh from the above list.\n');

  return lines.join('\n');
}

// ─── Migrate from old kids-newsletter-tracker.json ───────────────────────────

function migrateFromOldTracker(trackerPath) {
  if (!fs.existsSync(trackerPath)) return null;
  try {
    const old = JSON.parse(fs.readFileSync(trackerPath, 'utf8'));
    const h   = load();

    // Migrate music artists (assume recent = last 30 days, older = 31+ days ago)
    if (old.recentMusicArtists?.length > 0) {
      old.recentMusicArtists.forEach((artist, i) => {
        const daysAgo = (old.recentMusicArtists.length - i - 1) * 2 + 1; // estimate spacing
        const d = new Date();
        d.setDate(d.getDate() - Math.min(daysAgo, 29));
        h.music.push({ date: d.toLocaleDateString('en-CA'), artist });
      });
    }

    // Migrate riddles
    if (old.recentRiddles?.length > 0) {
      old.recentRiddles.forEach((text, i) => {
        const daysAgo = (old.recentRiddles.length - i - 1) * 2 + 1;
        const d = new Date();
        d.setDate(d.getDate() - Math.min(daysAgo, 20));
        const norm = normalise(text);
        h.riddles.push({ date: d.toLocaleDateString('en-CA'), text, normalized: norm, hash: hashStr(norm) });
      });
    }

    save(prune(h));
    return h;
  } catch (e) {
    console.error('Migration error:', e.message);
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

module.exports = {
  load, save, prune,
  checkStory, checkJoke, checkTrivia, checkMusic, checkRiddle,
  checkIsraelTopic, checkZoeyPop, checkScienceTopic,
  addStory, addJoke, addTrivia, addMusic, addRiddle,
  addIsraelTopic, addZoeyPop, addScienceTopic,
  buildPromptBlock, buildAvoidList,
  migrateFromOldTracker,
  normalise, hashStr, todayISO, WINDOWS,
};
