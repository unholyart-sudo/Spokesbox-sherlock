#!/usr/bin/env node
'use strict';

const https = require('https');

const SENDGRID_KEY = '[REDACTED_SENDGRID_KEY]';

// ─── SHARED CONTENT ───────────────────────────────────────────────────────────

const TAILWINDS = `
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Morning hours are sharp, focused, and fast — use them first</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Warm, supportive energy flows through work and close relationships</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Venus in Taurus rewards quality, patience, and sensory pleasure</p>
`;

const HEADWINDS = `
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Emotional tide shifts mid-afternoon — ground yourself, don't fight it</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Discipline is demanded today — shortcuts have a price tag right now</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Wishful thinking can masquerade as intuition — check your facts</p>
`;

const RESOURCES = `
<div style="margin-top:20px;padding:16px;background:rgba(255,255,255,0.02);border:1px solid rgba(201,168,76,0.08);border-radius:12px;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#9a8a70;font-weight:600;margin-bottom:10px;">&#128218; Explore Further</div>
  <p style="font-size:13px;color:#9a8a70;margin:0 0 6px;"><a href="https://cafeastrology.com/mars.html" style="color:#c9a84c;text-decoration:none;">Mars conjunct Saturn: what disciplined action really looks like &#8599;</a></p>
  <p style="font-size:13px;color:#9a8a70;margin:0 0 6px;"><a href="https://cafeastrology.com/moon_sign_cancer.html" style="color:#c9a84c;text-decoration:none;">Moon in Cancer: emotional intelligence activated &#8599;</a></p>
  <p style="font-size:13px;color:#9a8a70;margin:0 0 6px;"><a href="https://astro.com/astrology/in_venus_e.htm" style="color:#c9a84c;text-decoration:none;">Venus in Taurus: grounded pleasure and slow-burn abundance &#8599;</a></p>
</div>
`;

// ─── SUBSCRIBERS ──────────────────────────────────────────────────────────────

const subscribers = [
  {
    name: 'Sandy',
    email: 'SandyGreen2015@gmail.com',
    signLine: '&#9878; Libra &middot; Tuesday, April 21',
    dateShort: 'Tue, Apr 21',
    // MOMENTUM: base=71 + natal 0 = 71 → Surging
    // CLARITY:  base=53 + natal +5 (Mercury Libra/air) = 58 → Sharp
    // EMOTIONAL: base=66 + natal 0 = 66 → Charged
    momentumLabel: 'Surging', momentumPct: 71,
    clarityLabel: 'Sharp', clarityPct: 58,
    emotionalLabel: 'Charged', emotionalPct: 66,
    powerLine: 'Your mind is quick this morning — catch those ideas before the afternoon gets heavy.',
    tailwinds: TAILWINDS,
    headwinds: HEADWINDS,
    work: 'Your natural people-reading skill is a real asset today — morning is the window to pitch, negotiate, or finally resolve that lingering thing.',
    relationships: 'Someone wants to be heard, not advised. Just listen — it matters more than any solution you could offer.',
    mind: 'Balanced and sharp this morning — lock in key decisions before the afternoon softens your certainty.',
    money: 'Steady, quality-focused moves pay off right now. Don\'t let impatience override the plan.',
    detail: `
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Morning opens with bright, communicative energy — your mind runs fast and social instincts are dialed in. If there\'s a conversation you\'ve been putting off, or a connection to reestablish, the window is now.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">By early afternoon the energy shifts noticeably toward something more private and felt. What seemed clear at 10 AM may feel weightier by 2 PM — that\'s not confusion, it\'s depth. Let the afternoon be what it is.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">A disciplined backbone runs through the whole day. The kind of productive Tuesday where you don\'t cut corners — and feel genuinely good about it tonight. Put in the real work.</p>
`,
    optimism: 'A small but meaningful moment of connection is available to you today — a conversation, a message, a simple act of listening.',
    warning: 'Don\'t let other people\'s emotional weather become your weather. Stay rooted in your own clarity.',
    resources: RESOURCES,
  },

  {
    name: 'Jared',
    email: 'unholyart@gmail.com',
    signLine: '&#9977; Virgo &middot; Tuesday, April 21',
    dateShort: 'Tue, Apr 21',
    // MOMENTUM: base=71 + natal -8 (Mars Aries oppose natal Mars Libra) = 63 → Charged
    // CLARITY:  base=53 + natal +2 (Mercury air+5, Sun Virgo+5, trans Mercury oppose natal Mercury-8) = 55 → Sharp
    // EMOTIONAL: base=66 + natal +15 (capped) (Moon Scorpio water+8, Moon Cancer trine natal Scorpio moon+8 =16→15) = 81 → Overloaded
    momentumLabel: 'Charged', momentumPct: 63,
    clarityLabel: 'Sharp', clarityPct: 55,
    emotionalLabel: 'Overloaded', emotionalPct: 81,
    powerLine: 'Sharp focus up front, deep waters later — a day where your instincts earn their keep.',
    tailwinds: TAILWINDS,
    headwinds: HEADWINDS,
    work: 'Best window this week for detailed analytical work — your Virgo precision is fully online this morning. Run the numbers, finalize the plan.',
    relationships: 'Your emotional depth is running unusually high today — what comes up in relationships carries real weight. Treat it as signal, not noise.',
    mind: 'Precision mode activated this morning; by afternoon your gut takes the wheel. Trust both, in that order.',
    money: 'Practical moves built on solid analysis. Resist the urge to overcomplicate what\'s already working.',
    detail: `
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Your analytical mind gets a genuine window this morning. Mercury in fast-forward mode lines up well with your Virgo wiring — run numbers, finalize thinking, send the email you\'ve been drafting. The clarity is real, use it.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">The afternoon brings a completely different register. With your Scorpio moon lighting up as the Cancer current rolls in, you may find yourself feeling things more intensely than the situation seems to call for. That\'s not a malfunction — that\'s your emotional intelligence going deep.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">The Mars-Saturn energy running through today rewards real effort over polished strategy. You already know the difference. Trust that knowledge and let it drive your choices.</p>
`,
    optimism: 'Your depth and precision together are a rare combination — today the right people will feel it and respond.',
    warning: 'High emotional intensity doesn\'t require high drama. Feel it, process it privately, then decide what to do with it.',
    resources: RESOURCES,
  },

  {
    name: 'Elliott',
    email: 'ehbaer@gmail.com',
    signLine: '&#9801; Taurus &middot; Tuesday, April 21',
    dateShort: 'Tue, Apr 21',
    // MOMENTUM: base=71 + natal 0 = 71 → Surging
    // CLARITY:  base=53 + natal +5 (Mercury earth/Taurus) = 58 → Sharp
    // EMOTIONAL: base=66 + natal -5 (Moon air/earth est.) = 61 → Intense
    momentumLabel: 'Surging', momentumPct: 71,
    clarityLabel: 'Sharp', clarityPct: 58,
    emotionalLabel: 'Intense', emotionalPct: 61,
    powerLine: 'Good momentum all day — knock out the hard stuff early before the afternoon gets heavy.',
    tailwinds: TAILWINDS,
    headwinds: HEADWINDS,
    work: 'Steady and productive — put your head down, follow through on what\'s in front of you, and let the results speak tonight.',
    relationships: 'Warm, genuine energy around the people close to you today — a good day for simple, honest connection.',
    mind: 'Clear and practical this morning — this is your window for decisions that matter. Make them.',
    money: 'Taurus season energy favors patient, well-considered moves. Your instincts around value are dialed in right now.',
    detail: `
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">This is a solid Tuesday for a Taurus. Good momentum, clear thinking, and Venus in your sign keeping things grounded and pleasurable if you let it. The sensory world is cooperating — notice it.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Morning hours are your power window today. Practical action, steady progress, and a mental clarity that makes decisions easier than usual. Get the concrete stuff done before noon.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Mid-afternoon the emotional temperature rises for everyone. Taurus naturally slows down and anchors when that happens — and that\'s exactly the right move. Let yourself land before making any big calls late in the day.</p>
`,
    optimism: 'Taurus season is your home turf — trust that the steady, real path you\'re on is actually working.',
    warning: 'Don\'t let the afternoon\'s emotional shift talk you out of decisions you made with your clear morning mind.',
    resources: RESOURCES,
  },

  {
    name: 'Fran',
    email: 'fschleno@gmail.com',
    signLine: '&#9811; Pisces &middot; Tuesday, April 21',
    dateShort: 'Tue, Apr 21',
    // MOMENTUM: base=71 + natal +10 (Jupiter Cancer trine Pisces Sun) = 81 → Peak
    // CLARITY:  base=53 + natal 0 (Mercury fire = no modifier; no Virgo/Gem/Aqua sun) = 53 → Sharp
    // EMOTIONAL: base=66 + natal 0 = 66 → Charged
    momentumLabel: 'Peak', momentumPct: 81,
    clarityLabel: 'Sharp', clarityPct: 53,
    emotionalLabel: 'Charged', emotionalPct: 66,
    powerLine: 'The tide is genuinely with you today — ride the clarity early and trust your gut all day long.',
    tailwinds: TAILWINDS,
    headwinds: HEADWINDS,
    work: 'Good fortune is backing your efforts today — show up fully and lean into opportunities that present themselves.',
    relationships: 'Heartfelt and warm — your natural empathy lands as a genuine gift today, not a burden.',
    mind: 'Clarity is solid this morning — act on real insights before they drift into feeling. Write things down.',
    money: 'Favorable energy for abundance and resources — the long-term build is what matters right now, not the quick hit.',
    detail: `
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">The stars are genuinely working in your favor today, Pisces. Jupiter in Cancer is forming a supportive trine to your Sun — a real alignment that brings warmth, luck, and opportunity into whatever you\'re focused on. This doesn\'t happen every week.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Your morning is clear and forward-moving — don\'t waste it. Whatever you\'ve been meaning to start, restart, or push forward, today\'s energy is a genuine green light. Your momentum is at its highest point in a while.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">The afternoon\'s emotional depth will feel more natural to you than to most. Trust your intuition fully — just double-check that what you\'re sensing is real and not just what you\'re hoping for. There\'s a difference today and it matters.</p>
`,
    optimism: 'A real stroke of luck or warmth is genuinely available to you today — show up for it and let it land.',
    warning: 'Your sensitivity is elevated and Neptune\'s fog is real today — if something seems too perfect, look twice.',
    resources: RESOURCES,
  },

  {
    name: 'Lyn',
    email: 'szabogreen@gmail.com',
    signLine: '&#9802; Gemini &middot; Tuesday, April 21',
    dateShort: 'Tue, Apr 21',
    // MOMENTUM: base=71 + natal 0 = 71 → Surging
    // CLARITY:  base=53 + natal +15 (capped) (Mercury air/Gemini+5, Sun Gemini+5, transit Mercury sextile natal Mercury+8 =18→15) = 68 → Crystal
    // EMOTIONAL: base=66 + natal -5 (Moon Taurus/earth est.) = 61 → Intense
    momentumLabel: 'Surging', momentumPct: 71,
    clarityLabel: 'Crystal', clarityPct: 68,
    emotionalLabel: 'Intense', emotionalPct: 61,
    powerLine: 'Your mind is firing on all cylinders this morning — the kind of day where one quick message unsticks something big.',
    tailwinds: TAILWINDS,
    headwinds: HEADWINDS,
    work: 'Your mind is your biggest asset today — put it on something that actually requires real thinking, not just doing.',
    relationships: 'Light, communicative energy in the morning gives way to something deeper in the afternoon — be present for both.',
    mind: 'Crystal clarity today — your highest mental game in a while. Don\'t waste it on small stuff.',
    money: 'Sharp thinking cuts through the noise — trust your analysis over the hype right now.',
    detail: `
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Gemini is in its element this morning. Mercury direct in Aries gives your already quick mind an extra boost — conversations, messages, calls, ideas are all flowing. Don\'t hold back. This is your window and it\'s genuinely bright.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Your clarity score today is the highest of this week\'s group — that\'s not a coincidence, it\'s your natal wiring meeting a cooperative sky. Use that edge for something that actually matters: a plan, a pitch, a hard conversation you\'ve been avoiding.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">You may feel the emotional current kick in as the afternoon deepens, pulling you somewhere more internal than usual. That\'s less comfortable for Gemini but valuable — let whatever surfaces be heard before you translate it into words.</p>
`,
    optimism: 'One well-placed idea or message today could open something larger than expected — don\'t underestimate your timing.',
    warning: 'So much clarity can tip into overthinking. Pick a lane and move — the analysis is done, trust it.',
    resources: RESOURCES,
  },

  {
    name: 'Jeff',
    email: 'jborden13@gmail.com',
    signLine: '&#9800; Aries &middot; Tuesday, April 21',
    dateShort: 'Tue, Apr 21',
    // MOMENTUM: base=71 + natal -5 (Mars natal fire+5, Saturn conjunct natal Aries Sun-10) = 66 → Surging
    // CLARITY:  base=53 + natal 0 = 53 → Sharp
    // EMOTIONAL: base=66 + natal +15 (capped) (Moon Cancer water+8, transit Moon conjunct natal Cancer Moon+10 =18→15) = 81 → Overloaded
    momentumLabel: 'Surging', momentumPct: 66,
    clarityLabel: 'Sharp', clarityPct: 53,
    emotionalLabel: 'Overloaded', emotionalPct: 81,
    powerLine: 'Hit hard early while the energy backs you up — the afternoon has very different ideas.',
    tailwinds: TAILWINDS,
    headwinds: HEADWINDS,
    work: 'Strong early momentum — push your hardest tasks into the morning window and go hard. The afternoon wants something else.',
    relationships: 'Your emotional intensity is at a peak today — be fully present, but watch your delivery when things get charged.',
    mind: 'Fast and instinctive this morning — you\'re at your sharpest before noon, so stack the decisions there.',
    money: 'Impulse buys are a trap today. Channel the drive into building something, not spending on something.',
    detail: `
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Tuesday is Aries territory — personal planets, action, drive — and your energy is genuinely strong this morning. But Saturn in your sign is a visible undercurrent running through everything: it wants proof of concept, real results, not just fire and intention.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">There\'s a real window between now and early afternoon where you can move fast AND smart. Hit it. Don\'t hold back. After that, the emotional landscape shifts considerably and you\'ll be navigating by feel — which is less your comfort zone.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">With your emotional meter running higher than usual today, check your reactions before they leave your mouth. The intensity is real and it\'s coming from somewhere valid — it just doesn\'t need an audience for every single wave.</p>
`,
    optimism: 'Your drive is backed by real structural support today — if you push smart, not just hard, you\'ll make serious ground.',
    warning: 'Emotional volatility is genuinely elevated today — excellent for passion, risky for conflicts. Choose your battles carefully.',
    resources: RESOURCES,
  },
];

// ─── EMAIL BUILDER ────────────────────────────────────────────────────────────

function buildEmail(sub) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SkyTuned &middot; Your Daily Reading</title>
</head>
<body style="margin:0;padding:0;background-color:#07090f;font-family:'DM Sans',Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#07090f;">
<tr><td align="center" style="padding:32px 16px;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

    <tr>
      <td align="center" style="background:#0d1121;border:1px solid rgba(201,168,76,0.2);border-bottom:none;border-radius:22px 22px 0 0;padding:28px 32px 20px;">
        <img src="https://skytuned.com/wordmark-email-v3.jpg" alt="SkyTuned" width="300" style="display:block;margin:0 auto 8px;">
        <div style="font-size:11px;color:#9a8a70;letter-spacing:2px;text-transform:uppercase;margin-top:8px;">Your stars. Your day.</div>
      </td>
    </tr>

    <tr>
      <td style="height:3px;background:linear-gradient(90deg,#8b5cf6,#c9a84c,#8b5cf6);"></td>
    </tr>

    <tr>
      <td style="background:#0d1121;border:1px solid rgba(201,168,76,0.2);border-top:none;border-radius:0 0 22px 22px;padding:28px 32px 32px;">

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
          <tr>
            <td valign="middle">
              <span style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#c9a84c;font-weight:600;">${sub.signLine}</span>
            </td>
            <td valign="middle" align="right">
              <span style="font-size:12px;color:#9a8a70;">${sub.dateShort}</span>
            </td>
          </tr>
        </table>
        <div style="font-family:Georgia,'Playfair Display',serif;font-size:20px;font-weight:700;color:#f2ece0;line-height:1.3;margin-bottom:24px;">${sub.powerLine}</div>

        <div style="margin-bottom:16px;">
          <div style="font-size:13px;color:#9a8a70;margin-bottom:2px;">Momentum &nbsp;<span style="color:#f2ece0;font-weight:500;">${sub.momentumLabel}</span></div>
          <div style="background:#1e1e35;border-radius:999px;height:8px;width:100%;">
            <div style="background:linear-gradient(90deg,#8b5cf6,#a78bfa);border-radius:999px;height:8px;width:${sub.momentumPct}%;max-width:100%;"></div>
          </div>
        </div>

        <div style="margin-bottom:16px;">
          <div style="font-size:13px;color:#9a8a70;margin-bottom:2px;">Clarity &nbsp;<span style="color:#f2ece0;font-weight:500;">${sub.clarityLabel}</span></div>
          <div style="background:#1e1e35;border-radius:999px;height:8px;width:100%;">
            <div style="background:linear-gradient(90deg,#c9a84c,#e2c97a);border-radius:999px;height:8px;width:${sub.clarityPct}%;max-width:100%;"></div>
          </div>
        </div>

        <div style="margin-bottom:28px;">
          <div style="font-size:13px;color:#9a8a70;margin-bottom:2px;">Emotional Load &nbsp;<span style="color:#f2ece0;font-weight:500;">${sub.emotionalLabel}</span></div>
          <div style="background:#1e1e35;border-radius:999px;height:8px;width:100%;">
            <div style="background:linear-gradient(90deg,#e05a4a,#f08070);border-radius:999px;height:8px;width:${sub.emotionalPct}%;max-width:100%;"></div>
          </div>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
          <tr>
            <td width="50%" valign="top" style="padding-right:12px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#4caf87;font-weight:600;margin-bottom:10px;">&#10022; Tailwinds</div>
              ${sub.tailwinds}
            </td>
            <td width="50%" valign="top" style="padding-left:12px;border-left:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#e07a4c;font-weight:600;margin-bottom:10px;">&#10022; Headwinds</div>
              ${sub.headwinds}
            </td>
          </tr>
        </table>

        <div style="height:1px;background:rgba(201,168,76,0.15);margin-bottom:24px;"></div>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
          <tr>
            <td width="50%" valign="top" style="padding:0 6px 12px 0;">
              <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(201,168,76,0.1);border-radius:12px;padding:16px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#c9a84c;font-weight:600;margin-bottom:6px;">&#128188; Work</div>
                <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${sub.work}</div>
              </div>
            </td>
            <td width="50%" valign="top" style="padding:0 0 12px 6px;">
              <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(201,168,76,0.1);border-radius:12px;padding:16px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#c9a84c;font-weight:600;margin-bottom:6px;">&#10084;&#65039; Relationships</div>
                <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${sub.relationships}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td width="50%" valign="top" style="padding:0 6px 0 0;">
              <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(201,168,76,0.1);border-radius:12px;padding:16px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#c9a84c;font-weight:600;margin-bottom:6px;">&#129504; Mind</div>
                <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${sub.mind}</div>
              </div>
            </td>
            <td width="50%" valign="top" style="padding:0 0 0 6px;">
              <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(201,168,76,0.1);border-radius:12px;padding:16px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#c9a84c;font-weight:600;margin-bottom:6px;">&#128176; Money</div>
                <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${sub.money}</div>
              </div>
            </td>
          </tr>
        </table>

        ${sub.detail}

        <div style="height:1px;background:rgba(201,168,76,0.15);margin:24px 0;"></div>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
          <tr>
            <td style="background:rgba(76,175,135,0.08);border:1px solid rgba(76,175,135,0.25);border-radius:10px;padding:14px 16px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#4caf87;font-weight:600;margin-bottom:6px;">&#10024; Optimism</div>
              <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${sub.optimism}</div>
            </td>
          </tr>
          <tr><td style="height:10px;"></td></tr>
          <tr>
            <td style="background:rgba(224,90,74,0.08);border:1px solid rgba(224,90,74,0.25);border-radius:10px;padding:14px 16px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#e07a4c;font-weight:600;margin-bottom:6px;">&#9888;&#65039; Watch For</div>
              <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${sub.warning}</div>
            </td>
          </tr>
        </table>

        ${sub.resources}

      </td>
    </tr>

    <tr>
      <td align="center" style="padding:20px 16px 0;">
        <p style="margin:0;font-size:11px;color:#3a3a5a;line-height:1.8;">
          SkyTuned &#10024; &middot; Personalized cosmic intelligence<br>
          <a href="https://skytuned.com/unsubscribe?email=${encodeURIComponent(sub.email)}&token=${encodeURIComponent(sub.email)}" style="color:#3a3a5a;text-decoration:none;">Unsubscribe</a> &middot; <a href="https://skytuned.com/profile" style="color:#3a3a5a;text-decoration:none;">Update preferences</a>
        </p>
      </td>
    </tr>

  </table>
</td></tr>
</table>

</body>
</html>`;
}

// ─── SENDER ───────────────────────────────────────────────────────────────────

function sendEmail(sub) {
  return new Promise((resolve, reject) => {
    const html = buildEmail(sub);
    const payload = JSON.stringify({
      personalizations: [{ to: [{ email: sub.email }] }],
      from: { email: 'jared@jaredgreen.com', name: 'SkyTuned \u2728' },
      subject: `\u2728 Your SkyTuned Reading \u2014 Tuesday, April 21`,
      content: [{ type: 'text/html', value: html }],
    });

    const options = {
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ name: sub.name, email: sub.email, status: res.statusCode, ok: true });
        } else {
          resolve({ name: sub.name, email: sub.email, status: res.statusCode, ok: false, body });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('SkyTuned Daily Emails — Tuesday, April 21, 2026\n');
  console.log('Sending to 6 subscribers...\n');

  const results = [];
  for (const sub of subscribers) {
    try {
      const result = await sendEmail(sub);
      results.push(result);
      console.log(`[${result.ok ? 'OK' : 'FAIL'}] ${result.name} <${result.email}> — HTTP ${result.status}`);
      if (!result.ok) console.log('  Body:', result.body);
    } catch (err) {
      console.log(`[ERROR] ${sub.name} <${sub.email}> — ${err.message}`);
      results.push({ name: sub.name, email: sub.email, ok: false, error: err.message });
    }
    // Small delay to avoid burst rate limits
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n─── SCORING AUDIT LOG ───────────────────────────────────────────────\n');
  console.log('BASE SKY SCORES for April 21, 2026:');
  console.log('  MOMENTUM:  base=50 (waxing+10, Mars fire+8, Mars conj Saturn-5, Sun sextile Jupiter+8) = 71');
  console.log('  CLARITY:   base=50 (Mercury direct+8, Mercury fire+3, Moon Cancer water-8) = 53');
  console.log('  EMOTIONAL: base=40 (Moon Cancer+18, Mars conj Saturn pressure+8) = 66\n');

  console.log('Sandy Green (Libra):');
  console.log('  MOMENTUM:  base=71 + natal adj=0 = 71 → "Surging"');
  console.log('  CLARITY:   base=53 + natal adj=+5 (Mercury Libra/air) = 58 → "Sharp"');
  console.log('  EMOTIONAL: base=66 + natal adj=0 = 66 → "Charged"\n');

  console.log('Jared Green (Virgo):');
  console.log('  MOMENTUM:  base=71 + natal adj=-8 (trans Mars Aries oppose natal Mars Libra) = 63 → "Charged"');
  console.log('  CLARITY:   base=53 + natal adj=+2 (Mercury air+5, Sun Virgo+5, trans Merc oppose natal Merc-8) = 55 → "Sharp"');
  console.log('  EMOTIONAL: base=66 + natal adj=+15 capped (Moon Scorpio water+8, Moon Cancer trine natal Scorpio Moon+8=16→cap15) = 81 → "Overloaded"\n');

  console.log('Elliott Baer (Taurus):');
  console.log('  MOMENTUM:  base=71 + natal adj=0 = 71 → "Surging"');
  console.log('  CLARITY:   base=53 + natal adj=+5 (Mercury Taurus/earth) = 58 → "Sharp"');
  console.log('  EMOTIONAL: base=66 + natal adj=-5 (Moon est. air/earth) = 61 → "Intense"\n');

  console.log('Fran Schleno (Pisces):');
  console.log('  MOMENTUM:  base=71 + natal adj=+10 (Jupiter Cancer trine natal Pisces Sun) = 81 → "Peak"');
  console.log('  CLARITY:   base=53 + natal adj=0 (Mercury fire=no modifier; no Virgo/Gem/Aqua Sun) = 53 → "Sharp"');
  console.log('  EMOTIONAL: base=66 + natal adj=0 = 66 → "Charged"\n');

  console.log('Lyn (Gemini):');
  console.log('  MOMENTUM:  base=71 + natal adj=0 = 71 → "Surging"');
  console.log('  CLARITY:   base=53 + natal adj=+15 capped (Mercury Gemini/air+5, Sun Gemini+5, trans Merc sextile natal Merc+8=18→cap15) = 68 → "Crystal"');
  console.log('  EMOTIONAL: base=66 + natal adj=-5 (Moon est. Taurus/earth) = 61 → "Intense"\n');

  console.log('Jeff Borden (Aries):');
  console.log('  MOMENTUM:  base=71 + natal adj=-5 (natal Mars fire+5, Saturn conj natal Aries Sun-10) = 66 → "Surging"');
  console.log('  CLARITY:   base=53 + natal adj=0 = 53 → "Sharp"');
  console.log('  EMOTIONAL: base=66 + natal adj=+15 capped (Moon Cancer water+8, trans Moon conj natal Cancer Moon+10=18→cap15) = 81 → "Overloaded"\n');

  console.log('─────────────────────────────────────────────────────────────────────');
  const sent = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\nDone. Sent: ${sent}/6, Failed: ${failed}/6`);
}

main().catch(console.error);
