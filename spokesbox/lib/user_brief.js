'use strict';
/**
 * lib/user_brief.js — CRUD for user_briefs + user_brief_history
 * PR 1/3: data plumbing only. No LLM calls, no async, no OpenAI imports.
 *
 * All functions use the caller-supplied better-sqlite3 db handle.
 * Word-count cap: 600 words. Enforced in application logic for clean error messages.
 */

const WORD_CAP = 600;

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function validateEditedBy(editedBy) {
  const valid = ['user', 'llm', 'system'];
  if (!valid.includes(editedBy)) {
    throw new Error(`Invalid editedBy value "${editedBy}". Must be one of: ${valid.join(', ')}.`);
  }
}

/**
 * getBrief(db, subscriberId)
 * Returns { brief_text, brief_version, last_edited_by, last_edited_at } or null.
 */
function getBrief(db, subscriberId) {
  const row = db.prepare(
    'SELECT brief_text, brief_version, last_edited_by, last_edited_at FROM user_briefs WHERE subscriber_id = ?'
  ).get(subscriberId);
  return row || null;
}

/**
 * saveBrief(db, { subscriberId, briefText, editedBy, editReason })
 * Atomically:
 *   1. Validates word count (rejects if > 600 words).
 *   2. Validates editedBy ('user' | 'llm' | 'system').
 *   3. If a current brief exists, copies it to user_brief_history FIRST.
 *   4. Upserts user_briefs with new text and incremented version.
 * Returns the saved brief row.
 */
function saveBrief(db, { subscriberId, briefText, editedBy, editReason }) {
  // Validate word count
  const wordCount = countWords(briefText);
  if (wordCount > WORD_CAP) {
    throw new Error(`Brief exceeds 600-word cap. Trim before saving. (${wordCount} words)`);
  }

  // Validate editedBy
  validateEditedBy(editedBy);

  const save = db.transaction(() => {
    // Fetch current brief (if any)
    const current = db.prepare(
      'SELECT brief_text, brief_version, last_edited_by, last_edited_at FROM user_briefs WHERE subscriber_id = ?'
    ).get(subscriberId);

    let nextVersion = 1;

    if (current) {
      // Write OUTGOING brief to history before overwriting
      db.prepare(
        'INSERT INTO user_brief_history (subscriber_id, brief_text, brief_version, edited_by, edited_at, edit_reason) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(subscriberId, current.brief_text, current.brief_version, current.last_edited_by, current.last_edited_at, editReason || null);

      nextVersion = current.brief_version + 1;

      // Update existing row
      db.prepare(
        'UPDATE user_briefs SET brief_text = ?, brief_version = ?, last_edited_by = ?, last_edited_at = datetime(\'now\') WHERE subscriber_id = ?'
      ).run(briefText, nextVersion, editedBy, subscriberId);
    } else {
      // First-ever save — no history entry, insert v1
      db.prepare(
        'INSERT INTO user_briefs (subscriber_id, brief_text, brief_version, last_edited_by) VALUES (?, ?, 1, ?)'
      ).run(subscriberId, briefText, editedBy);
    }

    return db.prepare(
      'SELECT brief_text, brief_version, last_edited_by, last_edited_at FROM user_briefs WHERE subscriber_id = ?'
    ).get(subscriberId);
  });

  return save();
}

/**
 * getBriefHistory(db, subscriberId, limit = 20)
 * Returns array of historical versions, newest first.
 */
function getBriefHistory(db, subscriberId, limit = 20) {
  return db.prepare(
    'SELECT id, brief_text, brief_version, edited_by, edited_at, edit_reason FROM user_brief_history WHERE subscriber_id = ? ORDER BY edited_at DESC, id DESC LIMIT ?'
  ).all(subscriberId, limit);
}

/**
 * deleteBrief(db, subscriberId)
 * Soft delete: copies current brief to history with edit_reason='deleted',
 * then removes from user_briefs. getBrief returns null after this.
 */
function deleteBrief(db, subscriberId) {
  const del = db.transaction(() => {
    const current = db.prepare(
      'SELECT brief_text, brief_version, last_edited_by, last_edited_at FROM user_briefs WHERE subscriber_id = ?'
    ).get(subscriberId);

    if (!current) return false; // nothing to delete

    // Write to history with edit_reason='deleted'
    db.prepare(
      'INSERT INTO user_brief_history (subscriber_id, brief_text, brief_version, edited_by, edited_at, edit_reason) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(subscriberId, current.brief_text, current.brief_version, current.last_edited_by, current.last_edited_at, 'deleted');

    db.prepare('DELETE FROM user_briefs WHERE subscriber_id = ?').run(subscriberId);
    return true;
  });

  return del();
}

module.exports = { getBrief, saveBrief, getBriefHistory, deleteBrief, WORD_CAP };
