#!/usr/bin/env node
/**
 * test.js — Kids Newsletter Dedup Tests
 */

'use strict';

const h    = require('./history');
const path = require('path');
const fs   = require('fs');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ─── Normalisation tests ──────────────────────────────────────────────────────

console.log('\n📝 Normalisation');

test('lowercase + strip punctuation', () => {
  const n = h.normalise("Real Madrid's 3-2 Win!");
  assert(!n.includes("'") && !n.includes('-') && n === n.toLowerCase(), `got: ${n}`);
});

test('strip dates/noise words', () => {
  const n = h.normalise('SpaceX launches May 2026 Starship rocket');
  assert(!n.includes('may') && !n.includes('2026'), `got: ${n}`);
  assert(n.includes('spacex') && n.includes('starship'), `missing key words: ${n}`);
});

test('strip stop words', () => {
  const n = h.normalise('The Yankees and the Mets played a game');
  assert(!n.includes(' the ') && !n.includes(' and ') && !n.includes(' a '), `got: ${n}`);
});

// ─── Story dedup tests ────────────────────────────────────────────────────────

console.log('\n📰 Story Deduplication');

test('exact URL blocked within 30 days', () => {
  const fakeHistory = { stories: [
    { date: h.todayISO(), title: 'Yankees win', topic_hash: h.hashStr('yankees win'), url_hash: h.hashStr('https://espn.com/yankees'), url: 'https://espn.com/yankees', normalized: 'yankees win' }
  ], jokes: [], trivia: [], music: [], riddles: [] };
  const r = h.checkStory(fakeHistory, { url: 'https://espn.com/yankees', topic: 'Yankees lose' });
  assert(r.duplicate, `Expected duplicate: ${JSON.stringify(r)}`);
});

test('different URL, same topic blocked within 14 days', () => {
  const fakeHistory = { stories: [
    { date: h.todayISO(), title: 'Yankees win', topic_hash: h.hashStr(h.normalise('yankees game today')), url_hash: h.hashStr('https://espn.com/x'), url: 'https://espn.com/x', normalized: h.normalise('yankees game today') }
  ], jokes: [], trivia: [], music: [], riddles: [] };
  const r = h.checkStory(fakeHistory, { url: 'https://cnn.com/y', topic: 'yankees game today' });
  assert(r.duplicate, `Expected duplicate: ${JSON.stringify(r)}`);
});

test('story with old date allowed (>14 days ago)', () => {
  const old = new Date(); old.setDate(old.getDate() - 20);
  const oldDate = old.toLocaleDateString('en-CA');
  const fakeHistory = { stories: [
    { date: oldDate, title: 'Old story', topic_hash: h.hashStr(h.normalise('spacex starship launch')), url_hash: 'aaa', url: '', normalized: h.normalise('spacex starship launch') }
  ], jokes: [], trivia: [], music: [], riddles: [] };
  const r = h.checkStory(fakeHistory, { url: 'https://new.com', topic: 'spacex starship launch' });
  assert(!r.duplicate, `Expected NOT duplicate (20 days old): ${JSON.stringify(r)}`);
});

test('ongoing story same URL blocked within 30 days', () => {
  const recentDate = new Date(); recentDate.setDate(recentDate.getDate() - 5);
  const fakeHistory = { stories: [
    { date: recentDate.toLocaleDateString('en-CA'), title: 'Starship launch', topic_hash: 'xxx', url_hash: h.hashStr('https://spacenews.com/starship'), url: 'https://spacenews.com/starship', normalized: 'starship launch' }
  ], jokes: [], trivia: [], music: [], riddles: [] };
  const r = h.checkStory(fakeHistory, { url: 'https://spacenews.com/starship', topic: 'Starship update' });
  assert(r.duplicate, `Expected duplicate: ${JSON.stringify(r)}`);
});

test('different topic, different URL always allowed', () => {
  const fakeHistory = { stories: [
    { date: h.todayISO(), title: 'Soccer news', topic_hash: h.hashStr(h.normalise('soccer goal mls')), url_hash: 'abc', url: 'https://mls.com', normalized: h.normalise('soccer goal mls') }
  ], jokes: [], trivia: [], music: [], riddles: [] };
  const r = h.checkStory(fakeHistory, { url: 'https://nasa.gov/new', topic: 'NASA moon mission' });
  assert(!r.duplicate, `Expected NOT duplicate: ${JSON.stringify(r)}`);
});

// ─── Joke dedup tests ─────────────────────────────────────────────────────────

console.log('\n😂 Joke Deduplication');

test('exact same joke blocked within 90 days', () => {
  const fakeHistory = { stories: [], jokes: [
    { date: h.todayISO(), text: 'Why did the soccer ball go to school? To get a kick out of learning!', normalized: h.normalise('why did the soccer ball go to school to get a kick out of learning'), hash: h.hashStr(h.normalise('why did the soccer ball go to school to get a kick out of learning')) }
  ], trivia: [], music: [], riddles: [] };
  const r = h.checkJoke(fakeHistory, 'Why did the soccer ball go to school? To get a kick out of learning!');
  assert(r.duplicate, `Expected duplicate: ${JSON.stringify(r)}`);
});

test('near-duplicate joke (>70% word overlap) blocked', () => {
  const original = h.normalise('why did the soccer ball go to school because it wanted to get a kick out of learning');
  const fakeHistory = { stories: [], jokes: [
    { date: h.todayISO(), text: 'Why did the soccer ball go to school?', normalized: original, hash: h.hashStr(original) }
  ], trivia: [], music: [], riddles: [] };
  const r = h.checkJoke(fakeHistory, 'Why did the soccer ball visit school? Because it wanted to get a kick out of learning today.');
  assert(r.duplicate, `Expected near-duplicate blocked: ${JSON.stringify(r)}`);
});

test('different joke always allowed', () => {
  const fakeHistory = { stories: [], jokes: [
    { date: h.todayISO(), text: 'Soccer joke', normalized: h.normalise('soccer ball school kick learning'), hash: h.hashStr(h.normalise('soccer ball school kick learning')) }
  ], trivia: [], music: [], riddles: [] };
  const r = h.checkJoke(fakeHistory, 'Why did the astronaut break up with his girlfriend? He needed space!');
  assert(!r.duplicate, `Expected NOT duplicate: ${JSON.stringify(r)}`);
});

test('old joke (>90 days) allowed', () => {
  const old = new Date(); old.setDate(old.getDate() - 95);
  const oldJoke = h.normalise('soccer ball school kick');
  const fakeHistory = { stories: [], jokes: [
    { date: old.toLocaleDateString('en-CA'), text: 'Soccer joke', normalized: oldJoke, hash: h.hashStr(oldJoke) }
  ], trivia: [], music: [], riddles: [] };
  const r = h.checkJoke(fakeHistory, 'Why did the soccer ball go to school? Because it wanted a kick!');
  assert(!r.duplicate, `Expected NOT duplicate (95 days old): ${JSON.stringify(r)}`);
});

// ─── Trivia dedup tests ───────────────────────────────────────────────────────

console.log('\n🧠 Trivia Deduplication');

test('same trivia question blocked within 90 days', () => {
  const normQ = h.normalise('How many players are on a soccer team');
  const fakeHistory = { stories: [], jokes: [], trivia: [
    { date: h.todayISO(), question: 'How many players are on a soccer team?', answer: '11', category: 'soccer', question_hash: h.hashStr(normQ), answer_hash: h.hashStr(h.normalise('11')), normalized_q: normQ }
  ], music: [], riddles: [] };
  const r = h.checkTrivia(fakeHistory, { question: 'How many players are on a soccer team?', answer: '11' });
  assert(r.duplicate, `Expected duplicate: ${JSON.stringify(r)}`);
});

test('same answer/entity blocked within 30 days', () => {
  const fakeHistory = { stories: [], jokes: [], trivia: [
    { date: h.todayISO(), question: 'Which team won the 2026 World Cup?', answer: 'Brazil', category: 'soccer', question_hash: 'q1', answer_hash: h.hashStr(h.normalise('brazil')), normalized_q: 'team won world cup' }
  ], music: [], riddles: [] };
  const r = h.checkTrivia(fakeHistory, { question: 'What country is famous for soccer and carnival?', answer: 'Brazil' });
  assert(r.duplicate, `Expected same-answer duplicate: ${JSON.stringify(r)}`);
});

test('different question and answer always allowed', () => {
  const fakeHistory = { stories: [], jokes: [], trivia: [
    { date: h.todayISO(), question: 'How many players on soccer team', answer: '11', question_hash: 'x', answer_hash: 'y', normalized_q: 'players soccer team' }
  ], music: [], riddles: [] };
  const r = h.checkTrivia(fakeHistory, { question: 'What is the largest planet in our solar system?', answer: 'Jupiter' });
  assert(!r.duplicate, `Expected NOT duplicate: ${JSON.stringify(r)}`);
});

// ─── History update tests ─────────────────────────────────────────────────────

console.log('\n💾 History Update');

test('addStory adds to history', () => {
  const hist = { stories: [], jokes: [], trivia: [], music: [], riddles: [] };
  h.addStory(hist, { url: 'https://test.com', topic: 'Test Story', title: 'Test Story' });
  assert(hist.stories.length === 1, 'Story not added');
  assert(hist.stories[0].title === 'Test Story', 'Wrong title');
});

test('addJoke adds to history', () => {
  const hist = { stories: [], jokes: [], trivia: [], music: [], riddles: [] };
  h.addJoke(hist, 'Why did the chicken cross the road? To get to the other side!');
  assert(hist.jokes.length === 1, 'Joke not added');
  assert(hist.jokes[0].hash, 'Missing hash');
});

test('addTrivia adds to history', () => {
  const hist = { stories: [], jokes: [], trivia: [], music: [], riddles: [] };
  h.addTrivia(hist, { question: 'What is 2+2?', answer: '4', category: 'math' });
  assert(hist.trivia.length === 1, 'Trivia not added');
  assert(hist.trivia[0].question_hash, 'Missing hash');
});

test('prune removes entries older than 120 days', () => {
  const old = new Date(); old.setDate(old.getDate() - 130);
  const hist = {
    stories: [{ date: old.toLocaleDateString('en-CA'), title: 'Old', topic_hash: 'x', url_hash: 'y', url: '', normalized: 'old' }],
    jokes: [], trivia: [], music: [], riddles: []
  };
  const pruned = h.prune(hist);
  assert(pruned.stories.length === 0, 'Old story not pruned');
});

test('prune keeps entries within 120 days', () => {
  const recent = new Date(); recent.setDate(recent.getDate() - 60);
  const hist = {
    stories: [{ date: recent.toLocaleDateString('en-CA'), title: 'Recent', topic_hash: 'x', url_hash: 'y', url: '', normalized: 'recent' }],
    jokes: [], trivia: [], music: [], riddles: []
  };
  const pruned = h.prune(hist);
  assert(pruned.stories.length === 1, 'Recent story incorrectly pruned');
});

test('buildPromptBlock includes all categories', () => {
  const hist = { stories: [], jokes: [], trivia: [], music: [], riddles: [] };
  h.addStory(hist, { url: 'https://t.com', topic: 'Soccer match', title: 'Soccer match' });
  h.addJoke(hist, 'Test joke here');
  h.addTrivia(hist, { question: 'Test Q?', answer: 'Test A', category: 'sports' });
  h.addMusic(hist, 'Test Artist');
  const block = h.buildPromptBlock(hist);
  assert(block.includes('DEDUPLICATION'), 'Missing dedup header');
  assert(block.includes('Soccer match'), 'Missing story');
  assert(block.includes('Test joke'), 'Missing joke');
  assert(block.includes('Test Q'), 'Missing trivia');
  assert(block.includes('Test Artist'), 'Missing music');
});

// ─── Results ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed · ${failed} failed / ${passed + failed} total`);
if (failed > 0) {
  console.error(`\n⚠️  ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log(`✅ All tests passed`);
}
