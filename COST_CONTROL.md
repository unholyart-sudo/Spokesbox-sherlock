# COST_CONTROL.md — Global Model Usage Policy

> Saved: 2026-05-20. Standing instruction from Jride. Apply to all tasks in this workspace.

---

## Default Model Order

1. **DeepSeek first** — for any task it can reasonably handle
2. **Claude only as fallback/escalation** — not the first call

---

## Apply DeepSeek-first To

- Planning and architecture drafts
- Code edits, refactors, new scripts
- Debugging (initial pass)
- Script generation (shell, Node, Python, etc.)
- Content drafting (emails, newsletters, summaries, docs)
- Data cleanup and transformation
- Routine automation tasks
- Test writing
- Documentation
- Recurring/cron job payloads

---

## Escalate to Claude Only When

- DeepSeek fails or times out
- DeepSeek output is incorrect, incomplete, or low-confidence
- Task requires complex multi-step architecture decisions
- Task involves high-risk production changes
- Task involves legal, financial, medical, or regulatory judgment
- Jride explicitly asks for Claude

---

## Logging Requirement — Claude Usage

Whenever Claude is used, always report:
1. Whether DeepSeek was attempted first
2. Why DeepSeek was not sufficient
3. What Claude was specifically used for

Do NOT silently use Claude first unless the task is clearly unsuitable for DeepSeek (e.g., nuanced multi-step reasoning, sensitive production code with no tests).

---

## For Generated Code

- DeepSeek drafts and implements first
- Run tests/smoke checks
- If tests fail repeatedly or the fix is complex → escalate to Claude for review/debugging
- Log which model wrote the final code

---

## For Content (emails, newsletters, summaries)

- DeepSeek drafts first
- Claude only polishes or fixes if DeepSeek output is unusable
- Log which model produced the final output

---

## For Recurring Jobs / Crons

- **Default LLM in cron payloads: DeepSeek**
- Claude fallback only (configure via `fallbacks` in cron payload)
- Record provider used in logs/metadata where practical
  - Field: `"script_model"` in metadata.json
  - Field: `"model_used"` in log lines

---

## DeepSeek Model Reference

| Use case | Model |
|---|---|
| Default | `deepseek/deepseek-chat` |
| Reasoning/complex | `deepseek/deepseek-reasoner` |

---

## Exceptions (Claude always appropriate)

- Main session direct conversation with Jride (already Claude via session default)
- Tasks Jride explicitly routes to Claude
- Any task where DeepSeek is not configured/available in the OpenClaw model roster
