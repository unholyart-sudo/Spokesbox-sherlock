#!/usr/bin/env node
/**
 * pre-generate.js — Run BEFORE newsletter generation.
 * Outputs the dedup "avoid" block to be injected into the LLM prompt.
 * Also migrates old tracker on first run.
 *
 * Usage:
 *   node kids-news/pre-generate.js               → prints prompt block
 *   node kids-news/pre-generate.js --json         → prints full avoid list as JSON
 *   node kids-news/pre-generate.js --summary      → human-readable summary
 */

'use strict';

const path = require('path');
const h    = require('./history');

const OLD_TRACKER = path.join(__dirname, '..', 'memory', 'kids-newsletter-tracker.json');

// Migrate old tracker on first run
const history = h.load();
if (history.music.length === 0) {
  const migrated = h.migrateFromOldTracker(OLD_TRACKER);
  if (migrated) {
    console.error('[kids-news] Migrated from old kids-newsletter-tracker.json');
  }
}

const freshHistory = h.load();
const pruned       = h.prune(freshHistory);
h.save(pruned); // prune stale entries on each load

const args = process.argv.slice(2);

if (args.includes('--json')) {
  const avoids = h.buildAvoidList(pruned);
  console.log(JSON.stringify(avoids, null, 2));
} else if (args.includes('--summary')) {
  const avoids = h.buildAvoidList(pruned);
  console.log(`\n📋 Kids Newsletter Dedup Summary`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`Stories tracked:  ${pruned.stories.length}`);
  console.log(`Jokes tracked:    ${pruned.jokes.length}`);
  console.log(`Trivia tracked:   ${pruned.trivia.length}`);
  console.log(`Music tracked:    ${pruned.music.length}`);
  console.log(`Riddles tracked:  ${pruned.riddles.length}`);
  console.log(`\nRecent topics to avoid (${avoids.topics.length}):`);
  avoids.topics.slice(0,5).forEach(t => console.log(t));
  console.log(`\nRecent music to avoid: ${avoids.music.join(', ')}`);
} else {
  // Default: print the prompt block for injection
  process.stdout.write(h.buildPromptBlock(pruned));
}
