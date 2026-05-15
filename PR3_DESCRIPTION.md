# PR 3 — Sam Brief Wiring: Email-First Onboarding via "Meet Sam" Screen

**Branch:** `feat/sam-brief-pr3-wiring`
**Base:** `main` (post PR1 + PR2 merge, tag v0.2.0)
**Status:** Ready for review. All 93 tests passing (mocked — no ANTHROPIC_API_KEY required).

---

## What this PR does

Wires Sam brief generation to fire as soon as the user's email is confirmed —
**before the Wizard questions begin**, via a dedicated "Meet Sam" interstitial screen.

Sam's data source is the user's own words typed on the Meet Sam screen, not Wizard
structured answers. The Wizard (topics, ZIP, preview) remains intact and unchanged as
the newsletter personalization layer; it is not Sam's brief source.

---

## User flow

```
Landing page (email input)
  → wizard.html opens
  → POST /wizard/start (session created)
  → Step 0: email_and_name (subscriber row created)
  → ⭐ MEET SAM SCREEN ← NEW
      User types what they want Sam to know about them
      → POST /api/sam-onboarding
        → res.json({success:true})  ← Wizard continues immediately
        → setImmediate: generateBriefFromOnboarding()  ← Claude runs async
  → Step 1: ZIP/social (existing Wizard)
  → Step 2: Topics (existing Wizard)
  → Step 3: Preview (existing Wizard)
  → POST /api/onboarding-complete (existing — sends welcome email)
  → /newsletter-preview
```

---

## Changes

### New files
*(none — lib/brief_synthesis.js was added and then removed in this PR)*

### Modified files
- `server.js`:
  - **Added** `POST /api/sam-onboarding` — email-first brief trigger
  - **Removed** Wizard-completion brief triggers from `/api/onboarding-complete` and `/wizard/complete`
  - **Removed** `require('./lib/brief_synthesis')` import
- `public/wizard.html`:
  - **Added** `#meetSam` HTML panel + CSS
  - **Added** JS intercept: after `email_and_name` answer resolves, shows Meet Sam before rendering next Wizard question
  - **Added** `showMeetSam()`, `handleSamSubmit()`, `skipSam()`, `continuePastSam()` functions
- `test/run-tests.js`:
  - Replaced synthesis unit tests with sam-onboarding route tests (8 tests, section 15)

### Deleted files
- `lib/brief_synthesis.js` — no longer needed (Sam uses user's own words, not synthesized Wizard data)

---

## POST /api/sam-onboarding

```
POST /api/sam-onboarding
Body: { session_id, onboarding_text }

Validation:
  - session_id: required, must exist in wizard_sessions
  - subscriber must exist for session email (email_and_name step must have run)
  - onboarding_text: required, 30–5000 chars

Response: { success: true, message: "Sam is reviewing your intro." }
  → Returned immediately (non-blocking)

After response:
  setImmediate → generateBriefFromOnboarding({ subscriberId, onboardingText, db })
  On failure: logged as non-fatal, Wizard unaffected
```

---

## Meet Sam Screen (wizard.html)

Shown after `email_and_name` step completes, before Step 1 (ZIP).

- Sam avatar + intro ("Your personal editor — building your brief from scratch.")
- `<h2>` prompt: "What do you want Sam to know about you?"
- `<p>` subtext: plain language, no jargon
- `<textarea>` — 5000 char max, char counter, 30-char client validation
- "Tell Sam →" button → calls `handleSamSubmit()` → POST `/api/sam-onboarding` → `continuePastSam()`
- "Skip for now" link → calls `skipSam()` → `continuePastSam()` (no POST)

**Fire-and-forget:** Wizard advances regardless of Sam's response (success, error, or skip).

---

## Tests — section 15 (8 tests, 93 total)

| Test | What it verifies |
|---|---|
| `sam_onboarding_200` | Valid session + ≥30-char text → 200 `{success:true}` |
| `sam_onboarding_missing_session` | No `session_id` → 400 |
| `sam_onboarding_bad_session` | Unknown `session_id` → 404 |
| `sam_onboarding_short_text` | Text < 30 chars → 400 |
| `sam_onboarding_missing_text` | Missing `onboarding_text` → 400 |
| `wiring_wizard_still_works` | `email_and_name` answer → next step `zip_code_with_social` (Wizard intact) |
| `admin_subscribers_list` | `GET /admin/subscribers` → 200 with array |
| `admin_subscribers_401` | `GET /admin/subscribers` no secret → 401 |

```
npm test               → CI guards 3/3 ✅
node test/run-tests.js → 93/93 ✅  0 failed
```

---

## Reviewer checklist

- [ ] Open `/wizard` and complete the email step — confirm "Meet Sam" screen appears before ZIP
- [ ] Type something in the textarea and click "Tell Sam →" — confirm Wizard advances to ZIP step
- [ ] Click "Skip for now" — confirm Wizard advances without Sam POST
- [ ] Check server logs after "Tell Sam" — confirm `[sam-onboarding] Brief generated for subscriber N` (requires ANTHROPIC_API_KEY in .env)
- [ ] After completing full Wizard flow, run `curl -H "x-admin-secret: ..." http://localhost:3002/admin/subscribers | jq '.subscribers[0]'` — confirm `has_brief` = 1 if key present
- [ ] Confirm mocked suite passes: `node test/run-tests.js` → 93/93

---

## What's NOT in this PR

- No changes to Wizard questions, topics, ZIP, or preview steps
- No changes to `/api/onboarding-complete` email sending logic
- No backfill of briefs for existing subscribers
- No live Claude test required (CI-safe mocked suite covers all paths)
- `lib/brief_synthesis.js` removed — synthesis from Wizard answers was the wrong approach
