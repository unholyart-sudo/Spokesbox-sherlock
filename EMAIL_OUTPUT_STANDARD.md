# EMAIL_OUTPUT_STANDARD.md
**Version:** 1.0.0 · **Created:** 2026-05-20  
**Applies to:** TorahTxt · SkyTuned · Spokesbox · TODO

---

## 1. Output Contract

Every project's email builder must export one primary function returning this shape:

```js
{
  subject:   string,          // Full subject line
  preheader: string,          // Hidden preview text (under 150 chars)
  html:      string,          // Full rendered HTML email
  text:      string,          // Plain-text fallback
  metadata: {
    project:          string, // 'torahtxt' | 'skytuned' | 'spokesbox' | 'todo'
    template_version: string, // semver e.g. '1.0.0'
    generated_at:     string, // ISO-8601
    source_date:      string, // YYYY-MM-DD
    from_email:       string,
    from_name:        string,
    reply_to:         string | null,
    subject:          string, // copy of envelope subject
    preheader:        string, // copy of preheader
  }
}
```

No send script should hand-build subject lines or HTML inline. All scripts call
a project's `buildEmailPayload()` and pass the result to `sendEmail()`.

---

## 2. Shared Design Tokens

```js
// email/shared/design-tokens.js
// Import and override per-project via token merging.

const EMAIL_TOKENS = {
  maxWidth:      '600px',
  bgPage:        '#07090f',   // outermost page background
  bgCard:        '#0d1121',   // content card background
  bgHeader:      '#000000',   // logo header bar
  colorGold:     '#c9a84c',   // primary accent / headings
  colorGoldLight:'#e2c46a',   // tagline / softer gold
  colorWhite:    '#f2ece0',   // primary body text
  colorOffWhite: '#d4cfc4',   // secondary body text
  colorMuted:    '#6b7a96',   // muted / footer text
  colorBorder:   'rgba(201,168,76,0.18)', // card border
  colorLink:     '#c9a84c',   // hyperlink colour
  fontSerif:     "Georgia, 'Times New Roman', serif",
  fontSans:      "'Helvetica Neue', Arial, sans-serif",
  fontSizeBody:  '15px',
  fontSizeSmall: '12px',
  lineHeight:    '1.75',
  borderRadius:  '12px',
};

// TorahTxt overrides
const TORAHTXT_TOKENS = { ...EMAIL_TOKENS, bgPage: '#1a1c2e' };

// SkyTuned overrides
const SKYTUNED_TOKENS  = { ...EMAIL_TOKENS }; // uses base

// Spokesbox overrides (lighter, editorial)
const SPOKESBOX_TOKENS = {
  ...EMAIL_TOKENS,
  bgPage: '#f0f4f8',
  bgCard: '#ffffff',
  bgHeader: '#1a2744',
  colorGold: '#667eea',
  colorWhite: '#1a2744',
  colorOffWhite: '#2d3748',
  colorMuted: '#718096',
  colorBorder: '#e2e8f0',
  colorLink: '#667eea',
};

// TODO overrides (dark, personal/private)
const TODO_TOKENS = { ...EMAIL_TOKENS };
```

---

## 3. Required Sections in Every Email

| Section | Required | Notes |
|---|---|---|
| Hidden preheader | ✅ | `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">…</span>` |
| Branded header / logo | ✅ | Per project; never use cross-project logos |
| Date / context line | ✅ | Formatted weekday + date |
| Primary content area | ✅ | The main message/lesson/brief/task list |
| Footer | ✅ | Copyright + project name |
| Unsubscribe link | ✅ (broadcast) | Required for TorahTxt, SkyTuned, Spokesbox; omit for TODO |
| Plain-text fallback | ✅ | Always include in multipart send |

---

## 4. Subject Line Formulas

| Project | Formula | Example |
|---|---|---|
| TorahTxt | `TorahTxt: {title} — {Weekday, Month D, YYYY}` | `TorahTxt: Your Calling Isn't Like Everyone Else's — Wednesday, May 20, 2026` |
| SkyTuned | `🚀 SkyTuned · Your Daily Orbit — {Weekday, Month D, YYYY}` | `🚀 SkyTuned · Your Daily Orbit — Wednesday, May 20, 2026` |
| Spokesbox | `📬 {FirstName}, your Spokesbox Brief — {Weekday, Month D}` | `📬 Avi, your Spokesbox Brief — Wednesday, May 20` |
| TODO | `📋 Jride TODO List — {Month D, YYYY}` | `📋 Jride TODO List — May 20, 2026` |

---

## 5. Preheader Formulas

| Project | Formula |
|---|---|
| TorahTxt | `Today's D'var Torah from {parasha}: {first ~100 chars of lesson}` |
| SkyTuned | `Today's top space story, mission watch, sky events, space weather, and market snapshot.` |
| Spokesbox | `Your personalized brief: the stories and signals Sam is watching for you today.` |
| TODO | `Today's open tasks, deadlines, money items, and follow-ups.` |

---

## 6. From / Reply-To

| Project | From Name | From Email | Reply-To |
|---|---|---|---|
| TorahTxt | `TorahTxt` | `jared@jaredgreen.com` | `sherlock.claw@gmail.com` |
| SkyTuned | `SkyTuned` | `jared@jaredgreen.com` | `sherlock.claw@gmail.com` |
| Spokesbox | `Spokesbox` | `jared@jaredgreen.com` | `sherlock.claw@gmail.com` |
| TODO | `Sherlock` | `jared@jaredgreen.com` | — |

---

## 7. Unsubscribe URL Format

```
https://{domain}/unsubscribe/{channel}?email={encoded_email}&token={hmac_token}
```

| Project | Channel | Domain |
|---|---|---|
| TorahTxt | `email` | torahtxt.com |
| SkyTuned | `email` | skytuned.com |
| Spokesbox | `email` | spokesbox.com |
| TODO | N/A — omit | — |

---

## 8. Logo Rules

| Project | Logo file | Must never use |
|---|---|---|
| TorahTxt | `logo-final.png` | any other logo |
| SkyTuned | `logo-space-v2.jpg` | `wordmark-email-v3.jpg` (astrology era) |
| Spokesbox | none (text header) | — |
| TODO | none (text header) | — |

---

## 9. SkyTuned Section Order (canonical)

1. Today's Lead
2. Mission Control
3. Spotlight (day-of-week rotation)
4. Tonight's Sky
5. Space Weather
6. Social Buzz
7. On the Pad
8. Market Snapshot
9. Footer

AI generation must produce structured JSON for these sections; the template renderer
fills placeholders. Free-form HTML output from the LLM is **not permitted**.

---

## 10. Spokesbox Section Schema (LLM output contract)

LLM must return valid JSON matching this shape. The renderer rejects free-form HTML:

```json
{
  "greeting": "Good morning",
  "sections": [
    {
      "id": "lead",
      "title": "Today's Lead",
      "emoji": "📰",
      "summary": "One-sentence intro",
      "bullets": ["Item 1", "Item 2"],
      "links": [{ "text": "Read more", "url": "https://…" }]
    }
  ],
  "closing": "Have a great day."
}
```

---

## 11. Validation Checklist (run via `email/scripts/validate-email-output.js`)

- [ ] `subject` present, ≤ 70 chars (warn if longer, never block)
- [ ] `preheader` present, ≤ 150 chars
- [ ] `html` present, includes `<html>` and `</html>`
- [ ] `text` present and non-empty
- [ ] `html` contains required logo `src` attribute for branded emails
- [ ] `html` contains unsubscribe link for broadcast emails
- [ ] `html` contains preheader `<span>` element
- [ ] No astrology-era markers in SkyTuned output (`wordmark-email-v3`, `Momentum`, `Emotional Load`, `Clarity`)
- [ ] `metadata.project`, `metadata.template_version`, `metadata.generated_at` all set

---

## 12. File Locations

| File | Purpose |
|---|---|
| `email/EMAIL_OUTPUT_STANDARD.md` | This document |
| `email/shared/design-tokens.js` | Shared token definitions |
| `email/scripts/validate-email-output.js` | Validation CLI |
| `torahtxt/email-builder.js` | TorahTxt payload builder |
| `torahtxt/test/email-snapshot.test.js` | TorahTxt snapshot tests |
| `skytuned/email-builder.js` | SkyTuned payload builder |
| `skytuned/send-canonical.js` | Single canonical SkyTuned send script |
| `skytuned/test/email-snapshot.test.js` | SkyTuned snapshot tests |
| `spokesbox/email-builder.js` | Spokesbox payload builder |
| `spokesbox/email-schema.js` | LLM output schema validator |
| `spokesbox/test/email-snapshot.test.js` | Spokesbox snapshot tests |
| `todo/email-builder.js` | TODO payload builder |
| `todo/todo-template.html` | TODO base HTML template |
