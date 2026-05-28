#!/usr/bin/env node
/**
 * post-generate.js — Run AFTER successful newsletter send.
 * Reads generated content metadata and appends to history.
 * ONLY called after confirmed successful send (HTTP 202).
 *
 * Usage:
 *   node kids-news/post-generate.js --content '{"joke":"...","trivia":[...],...}'
 *   node kids-news/post-generate.js --file /tmp/kids-newsletter-meta.json
 *   cat meta.json | node kids-news/post-generate.js --stdin
 *
 * Expected metadata shape:
 * {
 *   "date": "2026-05-20",
 *   "stories": [{ "title": "...", "url": "...", "topic": "..." }],
 *   "jokes": ["Why did the soccer ball... Because it wanted a kick!"],
 *   "trivia": [{ "question": "...", "answer": "...", "category": "..." }],
 *   "riddles": ["footsteps what am I riddle"],
 *   "music": "Bruno Mars"
 * }
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const h    = require('./history');

function run(meta) {
  const history = h.load();

  let added = { stories: 0, jokes: 0, trivia: 0, music: 0, riddles: 0, israel_topics: 0, zoey_pop: 0, science_topics: 0 };

  // Stories / topics
  for (const s of (meta.stories || [])) {
    h.addStory(history, { url: s.url, topic: s.topic || s.title, title: s.title });
    added.stories++;
  }

  // Jokes
  for (const joke of (meta.jokes || [])) {
    if (joke && joke.length > 5) { h.addJoke(history, joke); added.jokes++; }
  }

  // Trivia
  for (const t of (meta.trivia || [])) {
    if (t.question) { h.addTrivia(history, t); added.trivia++; }
  }

  // Music artist
  if (meta.music) { h.addMusic(history, meta.music); added.music++; }

  // Riddles (brain teasers)
  for (const r of (meta.riddles || [])) {
    if (r && r.length > 5) { h.addRiddle(history, r); added.riddles++; }
  }

  // Israel topics
  for (const topic of (meta.israel_topics || [])) {
    if (topic && topic.length > 3) { h.addIsraelTopic(history, topic); added.israel_topics++; }
  }

  // Zoey pop artists
  for (const artist of (meta.zoey_pop || [])) {
    if (artist && artist.length > 1) { h.addZoeyPop(history, artist); added.zoey_pop++; }
  }

  // Science topics
  for (const topic of (meta.science_topics || [])) {
    if (topic && topic.length > 3) { h.addScienceTopic(history, topic); added.science_topics++; }
  }

  // Prune and save
  h.save(h.prune(history));

  console.log(`[kids-news/post-generate] History updated: ${JSON.stringify(added)}`);
  console.log(`[kids-news/post-generate] Total tracked: stories=${history.stories.length} jokes=${history.jokes.length} trivia=${history.trivia.length} music=${history.music.length} riddles=${history.riddles.length} israel_topics=${(history.israel_topics||[]).length} zoey_pop=${(history.zoey_pop||[]).length} science_topics=${(history.science_topics||[]).length}`);

  // Also update legacy kids-newsletter-tracker.json so old cron still works
  const oldTrackerPath = path.join(__dirname, '..', 'memory', 'kids-newsletter-tracker.json');
  try {
    let old = {};
    if (fs.existsSync(oldTrackerPath)) old = JSON.parse(fs.readFileSync(oldTrackerPath, 'utf8'));
    // Update recentMusicArtists
    if (meta.music) {
      const recent = old.recentMusicArtists || [];
      if (!recent.includes(meta.music)) recent.unshift(meta.music);
      old.recentMusicArtists = recent.slice(0, 30);
    }
    // Update recentRiddles
    for (const r of (meta.riddles || [])) {
      const recent = old.recentRiddles || [];
      if (!recent.includes(r)) recent.unshift(r);
      old.recentRiddles = recent.slice(0, 30);
    }
    // Update new fields in legacy tracker for compatibility
    if (meta.israel_topics && meta.israel_topics.length > 0) {
      const recentIT = old.recentIsraelTopics || [];
      for (const t of meta.israel_topics) { if (!recentIT.includes(t)) recentIT.unshift(t); }
      old.recentIsraelTopics = recentIT.slice(0, 20);
    }
    if (meta.zoey_pop && meta.zoey_pop.length > 0) {
      const recentZP = old.recentZoeyPop || [];
      for (const a of meta.zoey_pop) { if (!recentZP.includes(a)) recentZP.unshift(a); }
      old.recentZoeyPop = recentZP.slice(0, 20);
    }
    if (meta.science_topics && meta.science_topics.length > 0) {
      const recentST = old.recentScienceTopics || [];
      for (const t of meta.science_topics) { if (!recentST.includes(t)) recentST.unshift(t); }
      old.recentScienceTopics = recentST.slice(0, 20);
    }
    old.lastUpdated = h.todayISO();
    // Rebuild nextMusicPick
    const usedArtists = (old.recentMusicArtists || []).join(', ');
    old.nextMusicPick = `Do NOT use: ${usedArtists}`;
    fs.writeFileSync(oldTrackerPath, JSON.stringify(old, null, 2));
    console.log('[kids-news/post-generate] Legacy tracker also updated');
  } catch (e) {
    console.error('[kids-news/post-generate] Legacy tracker update failed:', e.message);
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--stdin')) {
  let buf = '';
  process.stdin.on('data', d => buf += d);
  process.stdin.on('end', () => {
    try { run(JSON.parse(buf)); } catch (e) { console.error('Parse error:', e.message); process.exit(1); }
  });
} else if (args.includes('--file')) {
  const f = args[args.indexOf('--file') + 1];
  run(JSON.parse(fs.readFileSync(f, 'utf8')));
} else if (args.includes('--content')) {
  const c = args[args.indexOf('--content') + 1];
  run(JSON.parse(c));
} else {
  console.error('Usage: node post-generate.js --content \'{...}\' | --file path | --stdin');
  process.exit(1);
}
