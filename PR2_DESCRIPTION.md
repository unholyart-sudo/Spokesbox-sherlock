# PR 2 — Sam Brief LLM Generation (Anthropic Claude)

**Branch:** `feat/sam-brief-generation`
**Base:** `main` (post `chore/green-guards` + `feat/user-brief-schema` merges)
**Status:** Ready for review. **Do not merge until live Claude test passes.**

---

## What this PR does

Wires up Claude to generate and update `user_briefs` from onboarding input. No UI changes, no wizard changes, no send pipeline changes. Data plumbing (PR 1) must be merged first.

### New files
- `lib/brief_prompts.js` — `BRIEF_GENERATION_PROMPT` and `BRIEF_UPDATE_PROMPT` constants
- `lib/brief_llm.js` — `generateBriefFromOnboarding()` and `updateBriefFromReply()`

### Modified files
- `server.js` — two new admin routes: `POST /admin/brief/:id/generate` and `POST /admin/brief/:id/update-from-reply`
- `test/run-tests.js` — `testBriefLlm()` section (85 total tests, all mocked)
- `.env.example` — documents `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`
- `package.json` / `package-lock.json` — adds `@anthropic-ai/sdk@^0.96.0`

---

## Provider: OpenAI → Anthropic Claude

| | Before (original draft) | After (this PR) |
|---|---|---|
| Provider | OpenAI (`gpt-4o-mini`, raw https) | Anthropic (`claude-sonnet-4-6`, `@anthropic-ai/sdk`) |
| Required key | `OPENAI_API_KEY` | `ANTHROPIC_API_KEY` |
| Model override | hardcoded | `ANTHROPIC_MODEL` env var (optional) |
| Response path | `choices[0].message.content` | `content[].text` (first text block) |
| Token logging | `prompt_tokens` / `completion_tokens` | `input_tokens` / `output_tokens` |
| Extra resilience | — | strips markdown fences before JSON parse (Claude sometimes wraps JSON) |
| Test hook | `_setOpenAIOverride` | `_setLLMOverride` (legacy alias `_setOpenAIOverride` kept) |

### OpenAI is NOT removed from the codebase — important clarification

`OPENAI_API_KEY` and `api.openai.com` remain in:
- `server.js:95` — content moderation (`moderateWithOpenAI`)
- `jobs/job_social_enrich.js` — social profile enrichment

These are **pre-existing features unrelated to Sam brief generation**. They are not touched by this PR and continue to use OpenAI as before.

The Sam brief runtime path (`lib/brief_llm.js` → `lib/user_brief.js`) has **zero OpenAI dependency**.

---

## Prompt templates (exact strings as shipped)

### `BRIEF_GENERATION_PROMPT`
```
You are Sam, an editor who writes a personal daily briefing for one reader. You're about to meet a new reader. They've told you, in their own words, what they want to be smarter about. Your job is to read what they wrote and produce a brief — a 200-400 word memo describing what you know about them and how you'll write for them. Write the brief in first person, as Sam, addressing yourself. Be specific about: what topics they care about (and how deeply); named entities they mentioned (companies, people, publications, podcasts); tone preferences (dry, casual, punchy); length preferences if stated; anything they explicitly said they don't want; what you'll be on the lookout for in coming issues. Do NOT invent facts. If they didn't say what their job is, don't guess. If they didn't say where they live, don't guess. Only describe what they actually told you, plus reasonable interpretive synthesis. Output ONLY valid JSON: {"brief_text": "…", "edit_reason": "initial brief from onboarding"}
```

### `BRIEF_UPDATE_PROMPT`
```
You are Sam, the editor of [reader]'s daily briefing. Here's what you currently know about them (the brief): [CURRENT_BRIEF]. They just replied to one of your issues. Here's their reply: [REPLY_TEXT]. Update the brief to reflect what you learned from this reply. Rules: preserve everything in the current brief unless the reply directly contradicts or supersedes it; treat user-stated preferences as authoritative — if they say 'stop covering crypto,' remove crypto coverage, don't soften it; if the reply is just conversational ('thanks!') with no new info, return the brief unchanged with edit_reason = 'no substantive update'; stay within the 600-word cap. Output ONLY valid JSON: {"brief_text": "…", "edit_reason": "one-line summary of what changed and why"}
```

---

## Tests

### Mocked suite (no API calls, CI-safe)
All 11 mocked cases in `testBriefLlm()` pass. Total suite: **85/85**.

| Test | Result |
|---|---|
| Valid input + valid LLM response → v1 saved, `editedBy=llm` | ✅ |
| Invalid first response, valid on retry → brief saved after 2nd attempt | ✅ |
| Two invalid responses → throws, no DB write | ✅ |
| 700-word LLM response → rejected by 600-word cap, no DB write | ✅ |
| `updateBriefFromReply` with no existing brief → throws correct error | ✅ |
| Substantive reply → v2, history gains v1 | ✅ |
| "thanks!" reply → v3, `edit_reason = 'no substantive update'` | ✅ |
| `POST /admin/brief/:id/generate` — 401 on bad secret | ✅ |
| `POST /admin/brief/:id/generate` — 400 on short `onboarding_text` | ✅ |
| `POST /admin/brief/:id/generate` — 404 on unknown subscriber | ✅ |
| `POST /admin/brief/:id/update-from-reply` — 404 when no brief exists | ✅ |

### CI guards
```
npm test
→ check-async-previews.sh  ✅  15 files scanned, 0 violations
→ check-deploy-sync.sh     ✅  wizard.html + server.js in sync with main
→ check-schema-brief-sync.sh ✅  user_briefs + user_brief_history tables present
```

### Live test (pending)
Gated behind `RUN_LIVE_LLM_TESTS=1`. **Not yet run** — blocked on `ANTHROPIC_API_KEY` in `.env`.

```bash
# Add to workspace/spokesbox/.env:
ANTHROPIC_API_KEY=sk-ant-...

# Then run:
cd workspace/spokesbox
RUN_LIVE_LLM_TESTS=1 node test/run-tests.js
```

The live test:
1. Calls `generateBriefFromOnboarding` with the Rarity Advisors onboarding paragraph
2. Asserts: 200 response, `brief_text` 200–400 words, `brief_version = 1`
3. Calls `updateBriefFromReply` with "actually drop sports coverage, I'm burned out on it"
4. Asserts: `brief_version = 2`, `edit_reason` mentions sports removal
5. Prints both `brief_text` values verbatim for Sam voice inspection

**Acceptance bar:** the generated brief must be specific, dry, and name real entities (Rarity Advisors, The Information, Stratechery, Matt Levine). Generic filler fails.

---

## Required env vars

```
# Required for Sam brief generation:
ANTHROPIC_API_KEY=sk-ant-...

# Optional — defaults to claude-sonnet-4-6:
# ANTHROPIC_MODEL=claude-sonnet-4-6
```

`OPENAI_API_KEY` is still required by the pre-existing moderation and social enrichment features, but is **not used** by Sam brief generation.

---

## Reviewer checklist

- [ ] **Confirm Sam brief generation uses `ANTHROPIC_API_KEY`** — grep `lib/brief_llm.js` for `ANTHROPIC_API_KEY`; confirm no `OPENAI_API_KEY` reference in that file's runtime path
- [ ] **Confirm `ANTHROPIC_MODEL` override works** — set `ANTHROPIC_MODEL=claude-3-haiku-20240307` in `.env`, hit `POST /admin/brief/:id/generate`, check `[brief_llm]` cost log line shows the overridden model
- [ ] **Confirm mocked tests pass** — `node test/run-tests.js` → 85/85, no live API calls
- [ ] **Confirm no OpenAI dependency in Sam brief path** — `grep -rn "openai\|OPENAI" lib/brief_llm.js lib/brief_prompts.js lib/user_brief.js` should return only the comment in `brief_llm.js` header saying it's NOT used
- [ ] **⏳ Pending: run live Claude test and inspect Sam voice output** — `ANTHROPIC_API_KEY=... RUN_LIVE_LLM_TESTS=1 node test/run-tests.js`; paste both `brief_text` outputs; confirm Sam sounds specific and dry, not generic

---

## What's NOT in this PR

- No changes to `public/wizard.html`
- No changes to `POST /wizard/start` or `POST /wizard/answer`
- No changes to send pipeline or daily cron
- No user-facing UI for brief generation
- No default briefs backfilled for existing subscribers
- No LLM imports in `lib/user_brief.js` or any wizard code
