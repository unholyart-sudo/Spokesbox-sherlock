// SkyTuned Daily Emails — Saturday, April 18, 2026
// Astrological context: Moon Waxing Crescent in Taurus (conjunct Venus + Pleiades), NOT void of course
// Jupiter ending retrograde shadow (going fully direct), Mercury in Aries, Sun last day in Aries
// Venus and Sun both entering Taurus TOMORROW — big transitional eve energy
// Mars–Saturn conjunction building in Aries (exact tomorrow) — discipline meets drive
// Uranus approaching Gemini (Apr 25) — long-term shift stirring
// Saturday theme: Reflection / Integration

const https = require('https');

const SENDGRID_KEY = '[REDACTED_SENDGRID_KEY]';

const CTA_BLOCK = `<div style="text-align:center;margin:24px 0;">
  <a href="https://skytuned.com" style="background:linear-gradient(135deg,#8b5cf6,#c9a84c);color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:14px;font-weight:600;display:inline-block;letter-spacing:0.5px;">✨ Explore Your Full Chart</a>
</div>`;

const RESOURCES = `<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(201,168,76,0.1);border-radius:12px;padding:16px;margin-top:0;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#9a8a70;font-weight:600;margin-bottom:12px;">📚 Resources</div>
  <p style="font-size:13px;color:#9a8a70;margin:0 0 8px;"><a href="https://cafeastrology.com/moon.html" style="color:#c9a84c;text-decoration:none;">Café Astrology Moon Calendar ↗</a> — Daily Moon sign and phase</p>
  <p style="font-size:13px;color:#9a8a70;margin:0 0 8px;"><a href="https://lunaf.com/lunar-calendar/2026/04/" style="color:#c9a84c;text-decoration:none;">Luna Lunar Calendar — April 2026 ↗</a> — Full month at a glance</p>
  <p style="font-size:13px;color:#9a8a70;margin:0;"><a href="https://skytuned.com" style="color:#c9a84c;text-decoration:none;">SkyTuned ↗</a> — Your personalized cosmic dashboard</p>
</div>`;

function buildHtml(data) {
  const template = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SkyTuned · Your Daily Reading</title>
</head>
<body style="margin:0;padding:0;background-color:#07090f;font-family:'DM Sans',Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#07090f;">
<tr><td align="center" style="padding:32px 16px;">

  <!-- Outer card -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

    <!-- Logo header -->
    <tr>
      <td align="center" style="background:#0d1121;border:1px solid rgba(201,168,76,0.2);border-bottom:none;border-radius:22px 22px 0 0;padding:28px 32px 20px;">
        <img src="https://skytuned.com/wordmark-email-v3.jpg" alt="SkyTuned" width="300" style="display:block;margin:0 auto 8px;">
        <div style="font-size:11px;color:#9a8a70;letter-spacing:2px;text-transform:uppercase;margin-top:8px;">Your stars. Your day.</div>
      </td>
    </tr>

    <!-- Top gradient bar -->
    <tr>
      <td style="height:3px;background:linear-gradient(90deg,#8b5cf6,#c9a84c,#8b5cf6);"></td>
    </tr>

    <!-- Card body -->
    <tr>
      <td style="background:#0d1121;border:1px solid rgba(201,168,76,0.2);border-top:none;border-radius:0 0 22px 22px;padding:28px 32px 32px;">

        <!-- Header: sign + date inline, then power line -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
          <tr>
            <td valign="middle">
              <span style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#c9a84c;font-weight:600;">${data.signLine}</span>
            </td>
            <td valign="middle" align="right">
              <span style="font-size:12px;color:#9a8a70;">${data.dateShort}</span>
            </td>
          </tr>
        </table>
        <div style="font-family:Georgia,'Playfair Display',serif;font-size:20px;font-weight:700;color:#f2ece0;line-height:1.3;margin-bottom:24px;">${data.powerLine}</div>

        <!-- MOMENTUM -->
        <div style="margin-bottom:16px;">
          <div style="font-size:13px;color:#9a8a70;margin-bottom:2px;">Momentum &nbsp;<span style="color:#f2ece0;font-weight:500;">${data.momentumLabel}</span></div>
          <div style="background:#1e1e35;border-radius:999px;height:8px;width:100%;">
            <div style="background:linear-gradient(90deg,#8b5cf6,#a78bfa);border-radius:999px;height:8px;width:${data.momentumPct}%;max-width:100%;"></div>
          </div>
        </div>

        <!-- CLARITY -->
        <div style="margin-bottom:16px;">
          <div style="font-size:13px;color:#9a8a70;margin-bottom:2px;">Clarity &nbsp;<span style="color:#f2ece0;font-weight:500;">${data.clarityLabel}</span></div>
          <div style="background:#1e1e35;border-radius:999px;height:8px;width:100%;">
            <div style="background:linear-gradient(90deg,#c9a84c,#e2c97a);border-radius:999px;height:8px;width:${data.clarityPct}%;max-width:100%;"></div>
          </div>
        </div>

        <!-- EMOTIONAL LOAD -->
        <div style="margin-bottom:28px;">
          <div style="font-size:13px;color:#9a8a70;margin-bottom:2px;">Emotional Load &nbsp;<span style="color:#f2ece0;font-weight:500;">${data.emotionalLabel}</span></div>
          <div style="background:#1e1e35;border-radius:999px;height:8px;width:100%;">
            <div style="background:linear-gradient(90deg,#e05a4a,#f08070);border-radius:999px;height:8px;width:${data.emotionalPct}%;max-width:100%;"></div>
          </div>
        </div>

        <!-- Tailwinds / Headwinds -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
          <tr>
            <td width="50%" valign="top" style="padding-right:12px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#4caf87;font-weight:600;margin-bottom:10px;">&#10022; Tailwinds</div>
              ${data.tailwinds}
            </td>
            <td width="50%" valign="top" style="padding-left:12px;border-left:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#e07a4c;font-weight:600;margin-bottom:10px;">&#10022; Headwinds</div>
              ${data.headwinds}
            </td>
          </tr>
        </table>

        <!-- Divider -->
        <div style="height:1px;background:rgba(201,168,76,0.15);margin-bottom:24px;"></div>

        <!-- Directives 2x2 -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
          <tr>
            <td width="50%" valign="top" style="padding:0 6px 12px 0;">
              <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(201,168,76,0.1);border-radius:12px;padding:16px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#c9a84c;font-weight:600;margin-bottom:6px;">&#128188; Work</div>
                <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${data.work}</div>
              </div>
            </td>
            <td width="50%" valign="top" style="padding:0 0 12px 6px;">
              <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(201,168,76,0.1);border-radius:12px;padding:16px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#c9a84c;font-weight:600;margin-bottom:6px;">&#10084;&#65039; Relationships</div>
                <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${data.relationships}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td width="50%" valign="top" style="padding:0 6px 0 0;">
              <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(201,168,76,0.1);border-radius:12px;padding:16px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#c9a84c;font-weight:600;margin-bottom:6px;">&#129504; Mind</div>
                <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${data.mind}</div>
              </div>
            </td>
            <td width="50%" valign="top" style="padding:0 0 0 6px;">
              <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(201,168,76,0.1);border-radius:12px;padding:16px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#c9a84c;font-weight:600;margin-bottom:6px;">&#128176; Money</div>
                <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${data.money}</div>
              </div>
            </td>
          </tr>
        </table>

        <!-- Detail -->
        ${data.detail}

        <!-- Divider -->
        <div style="height:1px;background:rgba(201,168,76,0.15);margin:24px 0;"></div>

        <!-- Outlook -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
          <tr>
            <td style="background:rgba(76,175,135,0.08);border:1px solid rgba(76,175,135,0.25);border-radius:10px;padding:14px 16px;margin-bottom:10px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#4caf87;font-weight:600;margin-bottom:6px;">&#10024; Optimism</div>
              <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${data.optimism}</div>
            </td>
          </tr>
          <tr><td style="height:10px;"></td></tr>
          <tr>
            <td style="background:rgba(224,90,74,0.08);border:1px solid rgba(224,90,74,0.25);border-radius:10px;padding:14px 16px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#e07a4c;font-weight:600;margin-bottom:6px;">&#9888;&#65039; Watch For</div>
              <div style="font-size:14px;color:#f2ece0;line-height:1.5;">${data.warning}</div>
            </td>
          </tr>
        </table>

        <!-- CTA -->
        ${CTA_BLOCK}

        <!-- Resources -->
        ${RESOURCES}

      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td align="center" style="padding:20px 16px 0;">
        <p style="margin:0;font-size:11px;color:#3a3a5a;line-height:1.8;">
          SkyTuned &#10024; &middot; Personalized cosmic intelligence<br>
          <a href="https://skytuned.com/unsubscribe?email=${data.email}&token=${data.token}" style="color:#3a3a5a;text-decoration:none;">Unsubscribe</a> &middot; <a href="https://skytuned.com/profile" style="color:#3a3a5a;text-decoration:none;">Update preferences</a>
        </p>
      </td>
    </tr>

  </table>
</td></tr>
</table>

</body>
</html>`;
  return template;
}

const subscribers = [
  {
    name: 'Sandy Green',
    email: 'SandyGreen2015@gmail.com',
    token: 'SandyGreen2015%40gmail.com',
    signLine: '&#9806; Libra &middot; Saturday, April 18',
    dateShort: 'Sat, Apr 18',
    powerLine: 'A quiet Saturday is exactly what the doctor ordered — let yourself enjoy something beautiful today without the guilt.',
    momentumLabel: 'Building',
    momentumPct: 55,
    clarityLabel: 'Clearing',
    clarityPct: 60,
    emotionalLabel: 'Stirring',
    emotionalPct: 52,
    tailwinds: `<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Social warmth is flowing naturally</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Creative instincts are sharp</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Financial intuition is unusually good</p>`,
    headwinds: `<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Tendency to overthink small decisions</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">One nagging task keeps pinging you</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Balancing others' needs vs. your own</p>`,
    work: 'Step away from the inbox — the best ideas for next week are brewing quietly in the background.',
    relationships: 'A sweet, low-key moment of connection is available today — reach out to someone you\'ve been meaning to.',
    mind: 'Your thinking is noticeably cleaner than it\'s been in weeks; a quiet morning of journaling or planning will click.',
    money: 'A small financial decision you\'ve been circling is ready for a clear answer — trust your gut.',
    detail: `<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">The week is wrapping up with some genuinely beautiful energy for you. Today has a soft, sensory quality — you may find yourself craving something lovely: good food, a long walk, time with someone you care about. That craving is a signal, not an indulgence. Lean in.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">There's a quiet undercurrent of "something is shifting" in your world right now, and it's mostly good news. A chapter is genuinely closing and a lighter one is about to open. You're not imagining that feeling.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">This Saturday is yours to recharge, not perform. The bigger moves are coming soon enough — but they'll go better if you show up rested. Give yourself that.</p>`,
    optimism: 'The next few weeks are going to feel noticeably lighter — this moment right now is where the turn begins.',
    warning: 'Don\'t let indecision eat your Saturday. Pick one thing you\'ve been avoiding and either handle it or officially table it until Monday.',
  },

  {
    name: 'Jared Green',
    email: 'unholyart@gmail.com',
    token: 'unholyart%40gmail.com',
    signLine: '&#9805; Virgo &middot; Saturday, April 18',
    dateShort: 'Sat, Apr 18',
    powerLine: 'You\'ve been running hard — this Saturday is a genuine permission slip to slow down and let the good stuff consolidate.',
    momentumLabel: 'Charged',
    momentumPct: 70,
    clarityLabel: 'Sharp',
    clarityPct: 80,
    emotionalLabel: 'Calm',
    emotionalPct: 38,
    tailwinds: `<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Grounded, steady energy suits you today</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Clarity on something you've been chewing on</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Details clicking into place on their own</p>`,
    headwinds: `<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Perfectionism wanting to turn rest into work</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Restless when things get too quiet</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Overthinking a situation that just needs time</p>`,
    work: 'The best insight you could have today will arrive while you\'re NOT trying — let the weekend actually be a weekend.',
    relationships: 'Warmth and ease are available — a simple, present moment with someone you love goes further than you\'d expect.',
    mind: 'Your analytical engine is sharp and well-rested; if you do pick up a problem today, you\'ll solve it fast.',
    money: 'A 30-minute financial overview — where things stand, what\'s next — would bring surprising clarity and calm.',
    detail: `<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Virgo tends to keep moving even when the calendar says stop. Today, the energy is genuinely encouraging you to rest — not because you're depleted, but because something good is consolidating. Today's sky craves sensory pleasure: good food, quiet, familiar comfort. You're allowed to have that without justifying it.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Your mind is sharp right now, and the irony is that the best use of that sharpness is to give it breathing room. Walk away from the screen for a few hours. The clarity you've been chasing often shows up the moment you stop chasing it.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">The week ahead is going to demand real focus and discipline — significant energy is building. Today is essentially your last easy day before things pick up. Bank it. You'll thank yourself Monday.</p>`,
    optimism: 'Something you\'ve been quietly building is about to get real traction — the foundation you laid is solid and the timing is right.',
    warning: 'The urge to optimize your Saturday into a to-do list is real and familiar. Resist it. Recovery is part of the system, not a detour from it.',
  },

  {
    name: 'Elliott Baer',
    email: 'ehbaer@gmail.com',
    token: 'ehbaer%40gmail.com',
    signLine: '&#9801; Taurus &middot; Saturday, April 18',
    dateShort: 'Sat, Apr 18',
    powerLine: 'Today has your name written all over it — something about the whole vibe is going to feel like it was made specifically for you.',
    momentumLabel: 'Surging',
    momentumPct: 88,
    clarityLabel: 'Crystal',
    clarityPct: 90,
    emotionalLabel: 'Calm',
    emotionalPct: 35,
    tailwinds: `<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Everything lining up quietly in your favor</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Intuition and logic are finally in agreement</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Natural magnetism at a seasonal peak</p>`,
    headwinds: `<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Risk of riding the good vibes past overindulgence</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Stubbornness about something that's clearly shifting</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Comfort-seeking when action is the better move</p>`,
    work: 'If there\'s something you want to pitch, propose, or build next week — sketch it out today while the vision is this clear.',
    relationships: 'Your warmth and groundedness are magnetic right now — someone in your circle has definitely noticed.',
    mind: 'You\'re thinking with both head and gut today and they\'re in agreement, which is rare. Whatever they agree on, trust it.',
    money: 'This is one of the better windows for financial clarity and planning in a while — your instincts on this are dialed in.',
    detail: `<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">This Saturday hits differently for you, Elliott. The Moon is in your sign today, meeting up with Venus for a soft, luminous pairing — and with your birthday season about to begin, there's a real sense of personal renewal in the air. You probably felt something when you woke up this morning, even if you couldn't name it.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">The energy today is slow and rich, not rushed. Your energy isn't about pushing — it's about receiving. Let good things come to you. Say yes to pleasure, beauty, and anything that makes life feel worth the effort. This isn't laziness; it's alignment.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Something is clicking into place in your life right now. You may not have full visibility on what it is yet, but the momentum is real. Over the next few weeks you're going to see clearly why this whole stretch was worth it.</p>`,
    optimism: 'Your birthday season is kicking off with genuine gifts attached — some of them are already quietly in motion.',
    warning: 'Don\'t let stubbornness block a pivot that\'s clearly needed in one area. Today\'s clarity makes it easier to see — use that.',
  },

  {
    name: 'Fran Schleno',
    email: 'fschleno@gmail.com',
    token: 'fschleno%40gmail.com',
    signLine: '&#9812; Pisces &middot; Saturday, April 18',
    dateShort: 'Sat, Apr 18',
    powerLine: 'Something that\'s been confusing you all week is about to make sense — let it settle instead of forcing the answer.',
    momentumLabel: 'Building',
    momentumPct: 48,
    clarityLabel: 'Clearing',
    clarityPct: 55,
    emotionalLabel: 'Stirring',
    emotionalPct: 62,
    tailwinds: `<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Intuition finally finding practical footing</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">A sense of the water calming down</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Good conditions for reflection and release</p>`,
    headwinds: `<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Old worries or fears trying to creep back in</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Difficulty separating reality from what-ifs</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Someone else's urgency pulling you off your pace</p>`,
    work: 'Something that felt stuck earlier this week may shift today — a fresh angle that wasn\'t visible before will become obvious.',
    relationships: 'You\'ve been doing a lot of giving lately. Today is genuinely for receiving — accept care without analyzing it to death.',
    mind: 'Your intuition is several steps ahead of your logic today. Both are useful, but let the gut lead and let the mind confirm.',
    money: 'A slow, honest look at one financial situation would bring more peace and clarity than you expect — worth 20 minutes.',
    detail: `<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">You've been swimming in a lot of emotional currents lately, Fran. Today the water calms somewhat — the sky has a grounding, earthy quality that's like finding the bottom of the pool with your feet. It doesn't mean everything is resolved, but you can stand here for a moment and breathe without treading water.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Saturday calls for integration over action. You don't need to figure everything out right now. The pieces that matter are assembling themselves on their own schedule, and your job today is to stop swimming upstream against them.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">There's a window opening over the next two weeks — a genuine fresh start in an area that's felt stuck. Before you step through it, today is a chance to consciously release what you're done carrying. Write it down, throw it away, name it aloud — whatever works for you. Then let it go.</p>`,
    optimism: 'A cycle of confusion or uncertainty is genuinely ending. You\'re about to feel noticeably clearer — it\'s already beginning.',
    warning: 'Don\'t let someone else\'s urgency pull you off your own rhythm today. Your slower pace right now is right, not wrong.',
  },

  {
    name: 'Lyn',
    email: 'szabogreen@gmail.com',
    token: 'szabogreen%40gmail.com',
    signLine: '&#9802; Gemini &middot; Saturday, April 18',
    dateShort: 'Sat, Apr 18',
    powerLine: 'Your brain is running faster than the day requires — let yourself be a little bored and see what interesting thing floats up.',
    momentumLabel: 'Charged',
    momentumPct: 65,
    clarityLabel: 'Sharp',
    clarityPct: 72,
    emotionalLabel: 'Calm',
    emotionalPct: 38,
    tailwinds: `<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Mental sharpness that surprises even you</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Good for conversations that actually matter</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">A sense of something quietly unlocking</p>`,
    headwinds: `<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Scattered energy if you try to do everything</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Over-scheduling a day that wants to breathe</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Overthinking something that just needs to sit</p>`,
    work: 'Not a work day — but if you must: anything involving writing, research, or conversation will flow unusually well.',
    relationships: 'A light, easy connection is available today — don\'t overthink the invitation or the dynamic. Just show up.',
    mind: 'This is a great day to let thoughts surface without immediately acting on them — something genuinely interesting will emerge.',
    money: 'A small organizational task around finances — tracking, sorting, reviewing — would feel oddly satisfying and productive.',
    detail: `<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Lyn, you're in a transitional moment that's bigger than it looks on the surface. The next several weeks are going to bring some meaningful changes to the way you communicate, think, and connect with the world around you. Today is one of the quieter days before that energy fully arrives.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Your mind is sharp and your curiosity is fully alive — two things that are always true for you, but especially so today. The invitation is to let that curiosity wander without an agenda. Read something random. Follow a thought somewhere unexpected. Enjoy the ride without needing a destination.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">There's also a quiet sense that something you'd partly given up on — a plan, a possibility, a connection — is about to resurface in a surprisingly good way. Don't be too surprised when it does.</p>`,
    optimism: 'Something is building in your favor on a scale you haven\'t seen in a while — the next few weeks will make it impossible to miss.',
    warning: 'Overthinking a simple situation could turn a genuinely good Saturday complicated. Keep it light. The complexity isn\'t real.',
  },

  {
    name: 'Jeff Borden',
    email: 'jborden13@gmail.com',
    token: 'jborden13%40gmail.com',
    signLine: '&#9800; Aries &middot; Saturday, April 18',
    dateShort: 'Sat, Apr 18',
    powerLine: 'You\'ve got more drive today than you\'ll know what to do with — pick exactly one thing and absolutely go all in.',
    momentumLabel: 'Surging',
    momentumPct: 90,
    clarityLabel: 'Sharp',
    clarityPct: 74,
    emotionalLabel: 'Intense',
    emotionalPct: 73,
    tailwinds: `<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Unstoppable drive and locked-in focus</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Courage to finally make a move you've been considering</p>
<p style="font-size:13px;color:#c8e6c9;margin:0 0 6px;">Physical and mental energy at a genuine high</p>`,
    headwinds: `<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Impatience with anything slow or bureaucratic</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Risk of burning bright and burning out in the same afternoon</p>
<p style="font-size:13px;color:#ffccbc;margin:0 0 6px;">Impulse decisions that feel obvious now, regrettable later</p>`,
    work: 'You could move mountains today if you channel it right — but pick ONE mountain. Not seven. Depth over breadth.',
    relationships: 'Your energy is high and magnetic. Just make sure you\'re actually listening as much as you\'re talking today.',
    mind: 'Fast, decisive, slightly stubborn — useful when you\'re right, risky when you\'re not. Double-check before committing to anything big.',
    money: 'Impulse purchases and quick financial decisions carry extra risk today — sleep on anything over a couple hundred dollars.',
    detail: `<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">Jeff, you're running genuinely hot right now, and that's not surprising given what's building in the sky. Your drive, determination, and desire to get things done are at a real peak today. The planetary energy is stacking up in your sign — your sign — and you can probably feel it. The key question is what you do with it.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">The biggest trap under this kind of energy is scatter — starting five things at once and finishing none of them. The people who get the most out of days like this are the ones who identify one clear target and drive at it with everything they have. Quality of focus beats quantity of action every time today.</p>
<p style="font-size:14px;color:#c8c0b0;line-height:1.7;margin:0 0 14px;">A Saturday well used for you: a hard workout that actually empties the tank, a focused creative or work sprint on something that matters, or a difficult conversation you've been putting off. The energy is there. The only question is what you build with it.</p>`,
    optimism: 'You\'re in a genuinely powerful stretch right now — the moves you make this weekend will still be paying off a month from now.',
    warning: 'Watch the anger trigger. Your tolerance for slowness is near zero today, and someone will inevitably be slow. Keep your cool.',
  },
];

function sendEmail(subscriber) {
  return new Promise((resolve, reject) => {
    const html = buildHtml(subscriber);
    const payload = JSON.stringify({
      personalizations: [{ to: [{ email: subscriber.email }] }],
      from: { email: 'jared@jaredgreen.com', name: 'SkyTuned ✨' },
      subject: `✨ Your SkyTuned Reading — Saturday, April 18`,
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
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 202) {
          console.log(`✅ Sent to ${subscriber.name} <${subscriber.email}>`);
          resolve({ name: subscriber.name, status: 'ok' });
        } else {
          console.error(`❌ Failed for ${subscriber.name}: HTTP ${res.statusCode} — ${body}`);
          resolve({ name: subscriber.name, status: 'error', code: res.statusCode, body });
        }
      });
    });

    req.on('error', (err) => {
      console.error(`❌ Network error for ${subscriber.name}:`, err.message);
      resolve({ name: subscriber.name, status: 'error', message: err.message });
    });

    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('🔭 SkyTuned Daily Emails — Saturday, April 18, 2026');
  console.log('📡 Moon: Waxing Crescent in Taurus | Jupiter going direct | Last day of Aries season\n');

  const results = [];
  for (const sub of subscribers) {
    const result = await sendEmail(sub);
    results.push(result);
    // Small delay between sends
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n📊 Summary:');
  results.forEach(r => console.log(`  ${r.status === 'ok' ? '✅' : '❌'} ${r.name}`));
  const ok = results.filter(r => r.status === 'ok').length;
  console.log(`\n${ok}/${results.length} emails sent successfully.`);
}

main();
