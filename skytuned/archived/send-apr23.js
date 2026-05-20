#!/usr/bin/env node
const fs = require('fs');
const https = require('https');

const TEMPLATE = fs.readFileSync('/Users/openclawjg/.openclaw/workspace/skytuned/email-template.html', 'utf8');
const SENDGRID_KEY = '[REDACTED_SENDGRID_KEY]';

function tailwind(items) {
  return items.map(t => `<p style="font-size:13px;color:#b0c8a8;line-height:1.6;margin:0 0 7px;">✦ ${t}</p>`).join('');
}
function headwind(items) {
  return items.map(t => `<p style="font-size:13px;color:#c8a090;line-height:1.6;margin:0 0 7px;">✦ ${t}</p>`).join('');
}
function detail(text) {
  return `<p style="font-size:14px;color:#c0b090;line-height:1.75;margin:0 0 16px;font-style:italic;">${text}</p>`;
}
function ctaBlock() {
  return `<div style="text-align:center;margin:20px 0 8px;"><a href="https://skytuned.com" style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#c9a84c);color:#fff;font-size:13px;font-weight:700;padding:11px 30px;border-radius:999px;text-decoration:none;letter-spacing:1px;">Explore Your Full Chart ✨</a></div>`;
}
function resources() {
  return `<div style="margin-top:12px;text-align:center;"><p style="font-size:12px;color:#9a8a70;line-height:1.8;margin:0;">Uranus enters Gemini · Apr 25 · <a href="https://skytuned.com" style="color:#c9a84c;text-decoration:none;">skytuned.com</a></p></div>`;
}

function buildEmail(data) {
  const token = Buffer.from(data.email).toString('base64');
  let html = TEMPLATE
    .replace(/\{\{SIGN_LINE\}\}/g, data.signLine)
    .replace(/\{\{DATE_SHORT\}\}/g, 'Thu, Apr 23')
    .replace(/\{\{POWER_LINE\}\}/g, data.powerLine)
    .replace(/\{\{MOMENTUM_LABEL\}\}/g, data.momentumLabel)
    .replace(/\{\{MOMENTUM_PCT\}\}/g, String(data.momentumPct))
    .replace(/\{\{CLARITY_LABEL\}\}/g, data.clarityLabel)
    .replace(/\{\{CLARITY_PCT\}\}/g, String(data.clarityPct))
    .replace(/\{\{EMOTIONAL_LABEL\}\}/g, data.emotionalLabel)
    .replace(/\{\{EMOTIONAL_PCT\}\}/g, String(data.emotionalPct))
    .replace(/\{\{TAILWINDS\}\}/g, tailwind(data.tailwinds))
    .replace(/\{\{HEADWINDS\}\}/g, headwind(data.headwinds))
    .replace(/\{\{WORK\}\}/g, data.work)
    .replace(/\{\{RELATIONSHIPS\}\}/g, data.relationships)
    .replace(/\{\{MIND\}\}/g, data.mind)
    .replace(/\{\{MONEY\}\}/g, data.money)
    .replace(/\{\{DETAIL\}\}/g, detail(data.detailText))
    .replace(/\{\{OPTIMISM\}\}/g, data.optimism)
    .replace(/\{\{WARNING\}\}/g, data.warning)
    .replace(/\{\{CTA_BLOCK\}\}/g, ctaBlock())
    .replace(/\{\{RESOURCES\}\}/g, resources())
    .replace(/\{\{EMAIL\}\}/g, encodeURIComponent(data.email))
    .replace(/\{\{TOKEN\}\}/g, token);
  return html;
}

function sendEmail(to, name, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      personalizations: [{ to: [{ email: to, name }] }],
      from: { email: 'jared@jaredgreen.com', name: 'SkyTuned ✨' },
      subject: '✨ Your SkyTuned Reading — Thursday, April 23',
      content: [{ type: 'text/html', value: html }]
    });
    const req = https.request({
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, to }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const subscribers = [
  {
    name: 'Sandy Green',
    email: 'SandyGreen2015@gmail.com',
    signLine: 'Libra ♎ · Daily Reading',
    powerLine: 'Your ruler just got hit by lightning — something in love or money is about to surprise you in the best way.',
    momentumLabel: 'Peak', momentumPct: 84,
    clarityLabel: 'Sharp', clarityPct: 61,
    emotionalLabel: 'Charged', emotionalPct: 74,
    tailwinds: [
      'Venus (your chart ruler) is supercharged today by Uranus',
      'Air energy building — connections flow more easily tonight',
      'First Quarter Moon pushing you toward a decision you\'ve been delaying'
    ],
    headwinds: [
      'Venus + Uranus = unexpected plot twists, not all convenient',
      'Moon in Cancer this morning can stir old feelings',
      'Avoid impulsive purchases while Uranus is still active'
    ],
    work: 'Saturn in Aries activates your growth zone — structured effort today pays dividends in weeks. Resist shortcuts.',
    relationships: 'Venus-Uranus means someone may say something that genuinely surprises you. Stay open instead of guarded.',
    mind: 'The First Quarter Moon brings clarity by forcing a choice. What have you been avoiding deciding?',
    money: 'Venus moving from Taurus to Gemini tonight is actually good news for diversifying your income. Explore new options.',
    detailText: 'Today\'s outer planet story centers on Uranus making its final statement in Taurus — the sign it has shared with Venus since 2019. Their exact conjunction now is a goodbye kiss before everything shifts. For Libra, whose life force runs through Venus, this is deeply personal. Expect a flash of insight about what you truly value — and what no longer fits the life you\'re building.',
    optimism: 'Venus entering Gemini tonight opens a lighter, more playful chapter for your relationships and creative life.',
    warning: 'Don\'t let Moon-in-Cancer morning nostalgia pull you backward — the real action is all forward today.'
  },
  {
    name: 'Jared Green',
    email: 'unholyart@gmail.com',
    signLine: 'Virgo ♍ · Daily Reading',
    powerLine: 'Something big is two days away — today, get your mind clear and your foundation solid.',
    momentumLabel: 'Surging', momentumPct: 76,
    clarityLabel: 'Sharp', clarityPct: 63,
    emotionalLabel: 'Overloaded', emotionalPct: 82,
    tailwinds: [
      'Uranus trine your Virgo Sun/Venus — grounding electric energy, not chaos',
      'Natal Moon Scorpio resonating with Cancer Moon — deep intuitive access today',
      'Mercury direct in Aries sharpening your analytical edge'
    ],
    headwinds: [
      'Emotional depth can tip toward overthinking — watch the spiral',
      'Mars opposing natal Mars (Libra) creates subtle friction in partnerships',
      'Avoid perfectionism: good enough ships, perfect doesn\'t'
    ],
    work: 'Saturn Aries activates your 6th house — methodical execution wins today. Don\'t scatter focus across too many tabs.',
    relationships: 'Your emotional radar is running unusually hot with the Moon-Scorpio resonance. Trust what you feel under the surface.',
    mind: 'Today is a prep day. Uranus enters Gemini in 48 hours and will conjunct your natal Jupiter at 0° Gemini — the seeds you plant in your thinking today germinate then.',
    money: 'Uranus\'s final degree in Taurus makes an earth trine to your chart. Stability and grounding over speculation — that\'s the call.',
    detailText: 'With natal Jupiter sitting at 0° Gemini, you are among the very few people who will experience Uranus hitting that exact degree when it ingresses Saturday. This is an 84-year cycle activation — you may already feel it as a low-level electrical hum in your thoughts. Today, the Moon in Cancer trines your Scorpio Moon. That\'s deep-water clarity: trust what surfaces emotionally. It\'s signal, not noise.',
    optimism: 'You\'re standing at the threshold of a major expansion cycle. The quiet today is actually the runway.',
    warning: 'Emotional depth is a gift if you sit with it. A trap if you spiral in it. Know the difference today.'
  },
  {
    name: 'Elliott Baer',
    email: 'ehbaer@gmail.com',
    signLine: 'Taurus ♉ · Daily Reading',
    powerLine: 'Venus and Uranus just collided in your sign — something you\'ve been building for years is about to break open.',
    momentumLabel: 'Peak', momentumPct: 85,
    clarityLabel: 'Sharp', clarityPct: 58,
    emotionalLabel: 'Overloaded', emotionalPct: 77,
    tailwinds: [
      'Venus-Uranus exact conjunction in Taurus — your chart is the epicenter today',
      'Jupiter Cancer trine your Sun: growth energy supporting you in the background',
      'Taurus season momentum still building from last week'
    ],
    headwinds: [
      'Uranus electricity can feel destabilizing even when positive',
      'Moon enters Leo this afternoon, squaring your Taurus Sun — minor friction',
      'Don\'t confuse a sudden surprise for a threat — it\'s probably a gift'
    ],
    work: 'Uranus in Taurus has been rewiring your professional identity for 7 years. Today\'s Venus-Uranus conjunction is a breakthrough — something clicks or a new opportunity lands unexpectedly.',
    relationships: 'Venus rules your love life and it\'s lit up today. Expect an honest, refreshing, surprising conversation.',
    mind: 'Your mind is electric today. Write down every idea that surfaces — they\'re wired differently than usual, and that\'s the whole point.',
    money: 'Venus-Uranus in your sign = financial surprise, likely positive. An unexpected opportunity or a new perspective on your earning potential.',
    detailText: 'For Taurus, Uranus\'s 7-year tenure in your sign has been about one thing: dismantling the structures that kept you comfortable but small. The Venus-Uranus conjunction today is the capstone — a moment of clarity about what the disruption was actually FOR. In two days, Uranus exits Taurus for Gemini, and the rubble becomes the foundation. Today, Venus is present for the handoff, blessing the whole transition with beauty and meaning.',
    optimism: 'Everything Uranus has stirred up in your life since 2018 is about to start making beautiful, undeniable sense.',
    warning: 'Don\'t cling to the old version of your story. Today\'s energy is firmly on the side of the new one.'
  },
  {
    name: 'Fran',
    email: 'fschleno@gmail.com',
    signLine: 'Pisces ♓ · Daily Reading',
    powerLine: 'A rare triple-water alignment is active today — your intuition is not just good right now, it\'s operating at full power.',
    momentumLabel: 'Peak', momentumPct: 85,
    clarityLabel: 'Sharp', clarityPct: 53,
    emotionalLabel: 'Overloaded', emotionalPct: 82,
    tailwinds: [
      'Moon Cancer + Jupiter Cancer both trine your Pisces Sun — rare triple-water support',
      'Venus-Uranus in Taurus makes a supportive earth sextile to your chart',
      'Morning birth mirrors today\'s morning Cancer Moon — you\'re in sync with the sky'
    ],
    headwinds: [
      'Emotional load is high — set a boundary on absorbing others\' stress today',
      'First Quarter Moon amplifies sensitivity — choose your inputs carefully',
      'Watch for idealism overriding practical judgment on a key decision'
    ],
    work: 'Water trine energy means your best work today flows from intuition, not structure. Trust your gut on a project — it\'s sharper than logic right now.',
    relationships: 'Deeply compassionate day. You feel others acutely — both the gift and the potential drain. Be intentional about where you direct your energy.',
    mind: 'Jupiter in Cancer is your expansion zone — your imaginative mind is running above its normal ceiling today. This is the day to dream without the self-imposed ceiling.',
    money: 'Venus-Uranus in earth makes a supportive angle to your Pisces chart. An unexpected financial insight or opportunity may surface today — take it seriously, not symbolically.',
    detailText: 'Triple-water configurations — Moon, Jupiter, and your own natal Sun all harmonizing in water signs — happen rarely and briefly. For Pisces, this is like your native element turning into a fast-moving river instead of a still pond. The current moves in your direction today. You were born at the very end of the Pisces cycle — which means your intuition carries the distilled wisdom of the entire zodiac. Today, that wisdom is amplified and unusually accurate. Don\'t second-guess what you sense.',
    optimism: 'Your natural gifts — empathy, vision, creativity — are operating near their annual peak today. Lead with them.',
    warning: 'Don\'t absorb what isn\'t yours to carry. Even on a high-compassion day, emotional boundaries protect everyone — including the people you care about.'
  },
  {
    name: 'Lyn',
    email: 'szabogreen@gmail.com',
    signLine: 'Gemini ♊ · Daily Reading',
    powerLine: 'Venus moves into your sign tonight and Uranus follows in two days — your season is officially, finally beginning.',
    momentumLabel: 'Peak', momentumPct: 85,
    clarityLabel: 'Crystal', clarityPct: 66,
    emotionalLabel: 'Charged', emotionalPct: 74,
    tailwinds: [
      'Venus enters Gemini tonight — your social life, beauty, and love energy ignite',
      'Uranus follows in just 48 hours — major transformation arriving at your doorstep',
      'Mercury direct in Aries creates strong mental-creative flow via sextile to your chart'
    ],
    headwinds: [
      'Moon in Cancer this morning opposes your Sun — head vs. heart tension early',
      'So much incoming energy can scatter focus — stay grounded through the shift',
      'Don\'t overcommit socially just because the energy is saying yes to everything'
    ],
    work: 'Your mind is running fast and clear today — Mercury sextile is excellent for communication, writing, and pitching. Get your best thoughts on paper.',
    relationships: 'Venus entering your sign tonight starts a season where connections deepen quickly and new ones form easily. Stay receptive and specific about who gets your real attention.',
    mind: 'The quiet before two big waves (Venus tonight, Uranus Saturday) is a gift. Use this morning\'s clarity to prepare mentally for a very active and unusual week ahead.',
    money: 'Venus in Gemini is classically positive for income through communication, ideas, and networking. Keep your eyes open for an unexpected offer this week.',
    detailText: 'Uranus has not been in Gemini since 1942. For someone born in Gemini in 1951, you will experience Uranus transiting your natal Sun in the coming years — a once-in-a-lifetime activation of your core self. Today is the threshold. Venus arrives first tonight, softening the road ahead. The electric charge you may be feeling is entirely appropriate — something genuinely new is taking shape in your life. You are perfectly, specifically positioned for what\'s coming.',
    optimism: 'Your chart is about to get a decade\'s worth of fresh wind. It starts this week, and it starts with tonight.',
    warning: 'Old Gemini patterns of overthinking and endless deliberation are the only real obstacle right now. Don\'t let them be.'
  },
  {
    name: 'Jeff',
    email: 'jborden13@gmail.com',
    signLine: 'Aries ♈ · Daily Reading',
    powerLine: 'Today\'s moon is in Cancer — and that\'s your moon too. Trust what you feel this morning more than usual.',
    momentumLabel: 'Surging', momentumPct: 76,
    clarityLabel: 'Sharp', clarityPct: 61,
    emotionalLabel: 'Charged', emotionalPct: 74,
    tailwinds: [
      'Cancer Moon resonating with your natal Cancer Moon — deep emotional clarity available',
      'First Quarter Moon is a turning point — the push you\'ve been waiting for',
      'Mars-Saturn Aries keeping focused, disciplined fire burning in your chart'
    ],
    headwinds: [
      'Venus-Uranus in Taurus squares your Aries Sun — expect a plot twist in finances or relationships',
      'Moon enters Leo this afternoon, which can amplify ego friction',
      'Don\'t use force where finesse is clearly the better tool today'
    ],
    work: 'Disciplined Aries energy (Mars-Saturn) is ideal for executing plans you\'ve already committed to. Not a brainstorm day — a ship-it day.',
    relationships: 'Your natal Cancer Moon is resonating strongly with today\'s sky — you\'re unusually emotionally attuned. Use that to say something you\'ve been holding back.',
    mind: 'Morning is your power window — Cancer Moon peaks before 3:30 PM ET when it goes void. Do your clearest, most important thinking before then.',
    money: 'Venus-Uranus in Taurus squares your Sun this afternoon — watch for an unexpected financial development. Don\'t react impulsively; give it 24 hours before deciding.',
    detailText: 'With natal Moon in Cancer and today\'s Moon also in Cancer, you have what astrologers call Moon Return energy — a brief reset where your emotional baseline gets recalibrated to its natural state. Combined with the First Quarter Moon\'s push toward action and Mars-Saturn providing disciplined fire in Aries, today is a rare day where emotional intelligence and focused execution can work in perfect sync. The Leo Moon this afternoon adds a shot of creative confidence as the sequel.',
    optimism: 'Your emotional attunement is a genuine strategic advantage today — your Cancer Moon resonating with the sky gives you an instinctive accuracy in calls and decisions.',
    warning: 'Venus-Uranus squaring your Aries Sun could deliver a financial or relationship curveball mid-afternoon. Pause before reacting. It\'s probably more opportunity than threat.'
  }
];

async function main() {
  const results = [];
  for (const sub of subscribers) {
    const html = buildEmail(sub);
    try {
      const r = await sendEmail(sub.email, sub.name, html);
      results.push({ to: sub.email, status: r.status, ok: r.status === 202 });
      console.log(`${r.status === 202 ? '✅' : '❌'} ${sub.name} <${sub.email}> → ${r.status}`);
      if (r.status !== 202) console.log('   Body:', r.body);
    } catch (e) {
      results.push({ to: sub.email, status: 'error', error: e.message });
      console.log(`❌ ${sub.name} <${sub.email}> → ERROR: ${e.message}`);
    }
    // small delay between sends
    await new Promise(r => setTimeout(r, 400));
  }
  const ok = results.filter(r => r.ok).length;
  console.log(`\n${ok}/${results.length} delivered.`);
  if (ok < results.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
