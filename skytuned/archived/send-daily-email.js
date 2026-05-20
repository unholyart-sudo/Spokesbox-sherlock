#!/usr/bin/env node
'use strict';

const https = require('https');
const { execSync } = require('child_process');

// ── CONFIG ───────────────────────────────────────────────────────────────────
const SENDGRID_API_KEY = '[REDACTED_SENDGRID_KEY]';
const FROM_EMAIL = 'jared@jaredgreen.com';
const FROM_NAME  = 'SkyTuned';
const SUBJECT    = '🚀 SkyTuned · Your Daily Orbit — Wednesday, May 20, 2026';

// ── SUBSCRIBERS ──────────────────────────────────────────────────────────────
const raw = execSync(
  `sqlite3 /Users/openclawjg/.openclaw/workspace/skytuned/subscribers.db "SELECT email, name, token FROM email_subscribers WHERE active=1;"`
).toString().trim();

const subscribers = raw.split('\n').map(line => {
  const parts = line.split('|');
  return { email: parts[0], name: parts[1] || '', token: parts[2] || '' };
}).filter(s => s.email && s.email.includes('@'));

// ── EMAIL HTML ───────────────────────────────────────────────────────────────
const EMAIL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SkyTuned · Your Daily Orbit</title>
</head>
<body style="margin:0;padding:0;background:#07090f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#07090f;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- ── LOGO HEADER ── -->
        <tr>
          <td style="background:#000000;text-align:center;padding:20px 0 0;border-radius:8px 8px 0 0;">
            <img src="https://skytuned.com/wordmark-email-v3.jpg" alt="SkyTuned" width="280" style="display:block;margin:0 auto;">
          </td>
        </tr>
        <tr>
          <td style="background:#000000;text-align:center;padding:8px 0 16px;">
            <span style="font-size:11px;letter-spacing:2px;color:#c9a84c;text-transform:uppercase;">Space News. Comprehensive. Daily.</span>
          </td>
        </tr>

        <!-- ── DATE BAR ── -->
        <tr>
          <td style="background:#0d1121;padding:12px 24px;border-top:2px solid #c9a84c;">
            <p style="margin:0;color:#c9a84c;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;">Wednesday, May 20, 2026 &nbsp;·&nbsp; Your Daily Orbit</p>
          </td>
        </tr>

        <!-- ── TODAY'S LEAD ── -->
        <tr>
          <td style="background:#0d1121;padding:24px 24px 8px;">
            <h2 style="margin:0 0 12px;color:#c9a84c;font-size:12px;letter-spacing:2px;text-transform:uppercase;">🌌 Today's Lead</h2>
            <h1 style="margin:0 0 12px;color:#ffffff;font-size:21px;line-height:1.35;font-weight:700;">Starship Version 3 Is on the Pad — SpaceX's Most Powerful Rocket Ever Readies for Debut Flight</h1>
            <p style="margin:0 0 20px;color:#b0b8d0;font-size:15px;line-height:1.65;">SpaceX is targeting the maiden launch of <strong style="color:#f2ece0;">Starship Version 3</strong> today from <strong style="color:#f2ece0;">Starbase Pad 2</strong> in South Texas, with the window opening at <strong style="color:#c9a84c;">6:30 PM ET</strong>. Flight 12 introduces upgraded <strong style="color:#f2ece0;">Raptor 3 engines</strong> and a fully redesigned Super Heavy booster, carrying <strong style="color:#c9a84c;">22</strong> Starlink satellite simulators for the first test from the newly built second launch complex. Success here marks the single most important step yet on the path to crewed lunar and Mars missions — and comes just weeks before SpaceX's historic IPO.</p>
            <hr style="border:none;border-top:1px solid #1e2540;margin:0;">
          </td>
        </tr>

        <!-- ── MISSION CONTROL ── -->
        <tr>
          <td style="background:#0d1121;padding:20px 24px 8px;">
            <h2 style="margin:0 0 16px;color:#c9a84c;font-size:12px;letter-spacing:2px;text-transform:uppercase;">📡 Mission Control</h2>

            <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#c9a84c;letter-spacing:1px;text-transform:uppercase;">🚀 Launches</p>
            <ul style="margin:0 0 14px;padding-left:20px;color:#b0b8d0;font-size:14px;line-height:1.7;">
              <li><strong style="color:#f2ece0;">Starship V3 Flight 12</strong> — Debut of the V3 vehicle from Starbase Pad 2; 6:30 PM ET window. Booster targets controlled Gulf splashdown; Ship aims for Indian Ocean reentry.</li>
              <li><strong style="color:#f2ece0;">Starlink 17-42 Success</strong> — Falcon 9 overnight from Vandenberg deployed 24 Starlink sats. Booster B1103 landed on drone ship <em>OCISLY</em> — the 612th booster recovery overall.</li>
            </ul>

            <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#c9a84c;letter-spacing:1px;text-transform:uppercase;">🏢 Private Sector</p>
            <ul style="margin:0 0 14px;padding-left:20px;color:#b0b8d0;font-size:14px;line-height:1.7;">
              <li><strong style="color:#f2ece0;">Rocket Lab Record Q1</strong> — Revenue hit <strong style="color:#c9a84c;">$200.3M</strong> (up 63.5% YoY) with a record <strong style="color:#c9a84c;">$2.2B</strong> backlog. Neutron medium-lift rocket still on track for a Q4 2026 debut.</li>
              <li><strong style="color:#f2ece0;">Sierra Space Dream Chaser</strong> — After NASA contract modification, spaceplane <em>Tenacity</em> pivots to a free-flyer LEO demo mission targeting late 2026.</li>
            </ul>

            <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#c9a84c;letter-spacing:1px;text-transform:uppercase;">🌍 Government &amp; Agencies</p>
            <ul style="margin:0 0 14px;padding-left:20px;color:#b0b8d0;font-size:14px;line-height:1.7;">
              <li><strong style="color:#f2ece0;">NASA Lunabotics Challenge</strong> — Kennedy Space Center hosts student lunar mining robot competition through May 21, the next generation of space engineers in action.</li>
              <li><strong style="color:#f2ece0;">Artemis Timeline Update</strong> — NASA confirms Artemis III crewed Earth-orbit test in <strong style="color:#c9a84c;">2027</strong>; Artemis IV lunar surface landing targeting <strong style="color:#c9a84c;">2028</strong>.</li>
            </ul>

            <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#c9a84c;letter-spacing:1px;text-transform:uppercase;">🔬 Science &amp; Deep Space</p>
            <ul style="margin:0 0 14px;padding-left:20px;color:#b0b8d0;font-size:14px;line-height:1.7;">
              <li><strong style="color:#f2ece0;">SMILE Mission Aloft</strong> — ESA/CAS joint mission launched May 19 aboard Vega-C to study Earth's magnetic shield and geomagnetic storms using X-ray and UV cameras.</li>
              <li><strong style="color:#f2ece0;">Milky Way Magnetic Twist</strong> — Astronomers discover a major magnetic "flip" in the Sagittarius Arm, potentially rewriting our understanding of the galaxy's structure and evolution.</li>
            </ul>

            <hr style="border:none;border-top:1px solid #1e2540;margin:0;">
          </td>
        </tr>

        <!-- ── SPOTLIGHT: WEDNESDAY = 📈 SPACE STOCKS & MARKETS ── -->
        <tr>
          <td style="background:#0d1121;padding:20px 24px 8px;">
            <h2 style="margin:0 0 4px;color:#c9a84c;font-size:12px;letter-spacing:2px;text-transform:uppercase;">📈 Wednesday Spotlight</h2>
            <p style="margin:0 0 14px;color:#4a5568;font-size:11px;letter-spacing:1px;text-transform:uppercase;">Space Stocks &amp; Markets</p>
            <h3 style="margin:0 0 14px;color:#ffffff;font-size:18px;line-height:1.35;font-weight:700;">SpaceX IPO Countdown: The $1.75 Trillion Moment That Reshapes Space Markets Forever</h3>

            <p style="margin:0 0 14px;color:#b0b8d0;font-size:14px;line-height:1.65;">This week's market story has one name written across it in <strong style="color:#c9a84c;">$1.75 trillion</strong> letters: <strong style="color:#f2ece0;">SpaceX</strong>. The company has tapped <strong style="color:#f2ece0;">Goldman Sachs</strong> as lead underwriter — with a 20-bank syndicate — for what would be the <strong style="color:#f2ece0;">largest IPO in history</strong>. A Nasdaq listing under the ticker <strong style="color:#c9a84c;">SPCX</strong> is targeted for <strong style="color:#c9a84c;">June 12, 2026</strong>, with the S-1 prospectus expected as early as tomorrow.</p>

            <p style="margin:0 0 14px;color:#b0b8d0;font-size:14px;line-height:1.65;">SpaceX is targeting up to <strong style="color:#c9a84c;">$75 billion</strong> in IPO proceeds, with its valuation jumping from $1.25T to $1.75T following the <strong style="color:#f2ece0;">xAI merger</strong> in February. A <strong style="color:#c9a84c;">$60 billion</strong> acquisition of AI coding startup <strong style="color:#f2ece0;">Cursor</strong> is planned to close ~30 days post-IPO. Headwinds include a dual-class share structure locking in near-absolute Musk voting control — three large pension funds have already pushed back publicly.</p>

            <p style="margin:0 0 6px;color:#b0b8d0;font-size:14px;line-height:1.65;"><strong style="color:#f2ece0;">The pure-play space stocks</strong> present a mixed picture heading into the IPO window:</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;border-collapse:collapse;">
              <tr style="background:#111827;">
                <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#c9a84c;">Ticker</td>
                <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#c9a84c;">Level</td>
                <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#c9a84c;">1-Year</td>
                <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#c9a84c;">Key Driver</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 10px;font-size:13px;color:#c9a84c;font-weight:700;">RKLB</td>
                <td style="padding:8px 10px;font-size:13px;color:#f2ece0;">$127</td>
                <td style="padding:8px 10px;font-size:13px;color:#4caf87;">+390%</td>
                <td style="padding:8px 10px;font-size:13px;color:#9a8a70;">Record Q1 revenue; Neutron on path</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 10px;font-size:13px;color:#c9a84c;font-weight:700;">ASTS</td>
                <td style="padding:8px 10px;font-size:13px;color:#f2ece0;">$88</td>
                <td style="padding:8px 10px;font-size:13px;color:#4caf87;">+253%</td>
                <td style="padding:8px 10px;font-size:13px;color:#9a8a70;">BlueBird constellation; $3.5B cash</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 10px;font-size:13px;color:#c9a84c;font-weight:700;">LUNR</td>
                <td style="padding:8px 10px;font-size:13px;color:#f2ece0;">$32</td>
                <td style="padding:8px 10px;font-size:13px;color:#4caf87;">+18%</td>
                <td style="padding:8px 10px;font-size:13px;color:#9a8a70;">Record $1.1B backlog; lunar data pivot</td>
              </tr>
            </table>

            <p style="margin:0 0 20px;color:#b0b8d0;font-size:14px;line-height:1.65;">The SpaceX IPO effect is already rippling through the sector — retail demand for exposure to commercial space is surging ahead of the June listing. With Starship V3 flying today and the prospectus expected this week, <strong style="color:#f2ece0;">this is the most consequential 30-day stretch in commercial space finance history.</strong></p>

            <hr style="border:none;border-top:1px solid #1e2540;margin:0;">
          </td>
        </tr>

        <!-- ── TONIGHT'S SKY ── -->
        <tr>
          <td style="background:#0d1121;padding:20px 24px 8px;">
            <h2 style="margin:0 0 14px;color:#c9a84c;font-size:12px;letter-spacing:2px;text-transform:uppercase;">🌙 Tonight's Sky</h2>
            <ul style="margin:0 0 10px;padding-left:20px;color:#b0b8d0;font-size:14px;line-height:1.7;">
              <li><strong style="color:#f2ece0;">Moon:</strong> Waxing Crescent, ~20% illuminated — low and lovely in the western sky after sunset. Thin crescent ideal for dark-sky viewing. Look for it sitting just left of Jupiter tonight.</li>
              <li><strong style="color:#f2ece0;">Venus</strong> — Brilliant in the <em>western sky</em> shortly after sunset, low toward the horizon. Unmistakable as the brightest "star" in the sky.</li>
              <li><strong style="color:#f2ece0;">Jupiter</strong> — Higher in the west after sunset, pairing beautifully with the crescent Moon in a stunning alignment. Don't miss it.</li>
              <li><strong style="color:#f2ece0;">Saturn &amp; Mars</strong> — Early risers' reward: both planets visible in the <em>eastern sky</em> before dawn for a pre-sunrise double feature.</li>
            </ul>
            <p style="margin:0 0 20px;font-size:13px;color:#4a5568;">📚 <a href="https://skytuned.com/stargazing.html" style="color:#c9a84c;text-decoration:none;">Full stargazing guide at skytuned.com/stargazing.html</a></p>
            <hr style="border:none;border-top:1px solid #1e2540;margin:0;">
          </td>
        </tr>

        <!-- ── SPACE WEATHER ── -->
        <tr>
          <td style="background:#0d1121;padding:20px 24px 8px;">
            <h2 style="margin:0 0 14px;color:#c9a84c;font-size:12px;letter-spacing:2px;text-transform:uppercase;">⚡ Space Weather</h2>
            <p style="margin:0 0 20px;color:#b0b8d0;font-size:14px;line-height:1.7;">
              <strong style="color:#f2ece0;">Kp Index: 2–3 · Quiet</strong> &nbsp;|&nbsp;
              <strong style="color:#f2ece0;">Solar Activity: Low</strong> &nbsp;|&nbsp;
              <strong style="color:#f2ece0;">Aurora: Low</strong><br><br>
              Yesterday's G1–G2 geomagnetic storm (peak K5.3) has subsided — today's solar conditions are calm with only minor C-class and B-class flares on record. No significant coronal holes are facing Earth and no CMEs are currently in transit. Aurora activity is confined to high latitudes (Fairbanks, Utqiaġvik); mid-latitude observers should not expect visible displays tonight. <em>All-clear for satellite operations and HF radio communications.</em>
            </p>
            <hr style="border:none;border-top:1px solid #1e2540;margin:0;">
          </td>
        </tr>

        <!-- ── SOCIAL BUZZ ── -->
        <tr>
          <td style="background:#0d1121;padding:20px 24px 8px;">
            <h2 style="margin:0 0 14px;color:#c9a84c;font-size:12px;letter-spacing:2px;text-transform:uppercase;">📲 Social Buzz</h2>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
              <tr>
                <td width="50%" style="padding-right:5px;padding-bottom:8px;vertical-align:top;">
                  <table width="100%"><tr><td style="padding:10px 14px;background:rgba(255,255,255,0.03);border-left:3px solid #8b5cf6;border-radius:4px;">
                    <div style="font-size:13px;font-weight:700;color:#8b5cf6;">#StarshipV3</div>
                    <div style="font-size:12px;color:#9a8a70;margin-top:3px;">Flight 12 launch coverage dominating space Twitter today. Everyone's watching Starbase.</div>
                  </td></tr></table>
                </td>
                <td width="50%" style="padding-left:5px;padding-bottom:8px;vertical-align:top;">
                  <table width="100%"><tr><td style="padding:10px 14px;background:rgba(255,255,255,0.03);border-left:3px solid #c9a84c;border-radius:4px;">
                    <div style="font-size:13px;font-weight:700;color:#c9a84c;">#SpaceXIPO</div>
                    <div style="font-size:12px;color:#9a8a70;margin-top:3px;">$1.75T valuation debate is red-hot. Pension fund governance concerns vs. retail FOMO.</div>
                  </td></tr></table>
                </td>
              </tr>
              <tr>
                <td width="50%" style="padding-right:5px;padding-bottom:8px;vertical-align:top;">
                  <table width="100%"><tr><td style="padding:10px 14px;background:rgba(255,255,255,0.03);border-left:3px solid #4caf87;border-radius:4px;">
                    <div style="font-size:13px;font-weight:700;color:#4caf87;">#RKLB</div>
                    <div style="font-size:12px;color:#9a8a70;margin-top:3px;">Record Q1 results have investors buzzing. "Viva La StriX" Electron launch Thursday from NZ.</div>
                  </td></tr></table>
                </td>
                <td width="50%" style="padding-left:5px;padding-bottom:8px;vertical-align:top;">
                  <table width="100%"><tr><td style="padding:10px 14px;background:rgba(255,255,255,0.03);border-left:3px solid #4caf87;border-radius:4px;">
                    <div style="font-size:13px;font-weight:700;color:#4caf87;">#SMILEMission</div>
                    <div style="font-size:12px;color:#9a8a70;margin-top:3px;">ESA/CAS Earth magnetic shield explorer wowing the science community after Vega-C liftoff.</div>
                  </td></tr></table>
                </td>
              </tr>
              <tr>
                <td width="50%" style="padding-right:5px;padding-bottom:8px;vertical-align:top;">
                  <table width="100%"><tr><td style="padding:10px 14px;background:rgba(255,255,255,0.03);border-left:3px solid #e07a4c;border-radius:4px;">
                    <div style="font-size:13px;font-weight:700;color:#e07a4c;">#JupiterMoon</div>
                    <div style="font-size:12px;color:#9a8a70;margin-top:3px;">Crescent Moon pairs with Jupiter tonight in the west — astrophotographers are ready.</div>
                  </td></tr></table>
                </td>
                <td width="50%" style="padding-left:5px;padding-bottom:8px;vertical-align:top;">
                  <table width="100%"><tr><td style="padding:10px 14px;background:rgba(255,255,255,0.03);border-left:3px solid #8b5cf6;border-radius:4px;">
                    <div style="font-size:13px;font-weight:700;color:#8b5cf6;">#Artemis</div>
                    <div style="font-size:12px;color:#9a8a70;margin-top:3px;">NASA confirms Artemis III in 2027 and Artemis IV Moon landing in 2028. The timeline is real.</div>
                  </td></tr></table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 20px;font-size:13px;color:#4a5568;">📲 <a href="https://skytuned.com/social.html" style="color:#c9a84c;text-decoration:none;">Full social roundup at skytuned.com/social.html</a></p>
            <hr style="border:none;border-top:1px solid #1e2540;margin:0;">
          </td>
        </tr>

        <!-- ── ON THE PAD — LAUNCH SCHEDULE ── -->
        <tr>
          <td style="background:#0d1121;padding:20px 24px 8px;">
            <h2 style="margin:0 0 14px;color:#c9a84c;font-size:12px;letter-spacing:2px;text-transform:uppercase;">🚀 On the Pad — Next 7 Days</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#b0b8d0;border-collapse:collapse;">
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="font-size:13px;color:#c9a84c;font-weight:700;padding:10px 10px;white-space:nowrap;">May 20 ⭐</td>
                <td style="font-size:13px;color:#f2ece0;padding:10px 10px;">Starship Flight 12 (V3 Debut) · Starbase TX</td>
                <td style="font-size:13px;color:#9a8a70;padding:10px 10px;">Starship V3 / SpaceX</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="font-size:13px;color:#c9a84c;font-weight:700;padding:10px 10px;white-space:nowrap;">May 21</td>
                <td style="font-size:13px;color:#f2ece0;padding:10px 10px;">Starlink Group 10-31 · Cape Canaveral SFS, FL</td>
                <td style="font-size:13px;color:#9a8a70;padding:10px 10px;">Falcon 9 / SpaceX</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="font-size:13px;color:#c9a84c;font-weight:700;padding:10px 10px;white-space:nowrap;">May 22</td>
                <td style="font-size:13px;color:#f2ece0;padding:10px 10px;">"Viva La StriX" (Synspective SAR) · Māhia, NZ</td>
                <td style="font-size:13px;color:#9a8a70;padding:10px 10px;">Electron / Rocket Lab</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="font-size:13px;color:#c9a84c;font-weight:700;padding:10px 10px;white-space:nowrap;">May 23</td>
                <td style="font-size:13px;color:#f2ece0;padding:10px 10px;">Starlink Group · Vandenberg SFB, CA</td>
                <td style="font-size:13px;color:#9a8a70;padding:10px 10px;">Falcon 9 / SpaceX</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="font-size:13px;color:#c9a84c;font-weight:700;padding:10px 10px;white-space:nowrap;">May 29</td>
                <td style="font-size:13px;color:#f2ece0;padding:10px 10px;">Amazon Kuiper LA-07 (29 sats) · Cape Canaveral</td>
                <td style="font-size:13px;color:#9a8a70;padding:10px 10px;">Atlas V 551 / ULA</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="font-size:13px;color:#c9a84c;font-weight:700;padding:10px 10px;white-space:nowrap;">May 30</td>
                <td style="font-size:13px;color:#f2ece0;padding:10px 10px;">USSF-57 (Next-Gen OPIR) · Cape Canaveral ⭐</td>
                <td style="font-size:13px;color:#9a8a70;padding:10px 10px;">Vulcan Centaur / ULA</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="font-size:13px;color:#c9a84c;font-weight:700;padding:10px 10px;white-space:nowrap;">May 30</td>
                <td style="font-size:13px;color:#f2ece0;padding:10px 10px;">Globalstar-3 (9 sats) · Vandenberg SFB, CA</td>
                <td style="font-size:13px;color:#9a8a70;padding:10px 10px;">Falcon 9 / SpaceX</td>
              </tr>
            </table>
            <p style="margin:8px 0 20px;font-size:11px;color:#4a5568;">⭐ = High-interest watch event</p>
            <hr style="border:none;border-top:1px solid #1e2540;margin:0;">
          </td>
        </tr>

        <!-- ── MARKET SNAPSHOT ── -->
        <tr>
          <td style="background:#0d1121;padding:20px 24px 20px;">
            <h2 style="margin:0 0 14px;color:#c9a84c;font-size:12px;letter-spacing:2px;text-transform:uppercase;">📈 Market Snapshot</h2>
            <p style="margin:0 0 12px;font-size:11px;color:#4a5568;">As of prior close · Wednesday, May 20, 2026</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#b0b8d0;border-collapse:collapse;">
              <tr style="background:#111827;">
                <td style="padding:8px 10px;color:#c9a84c;font-weight:700;border-radius:4px 0 0 0;">Ticker</td>
                <td style="padding:8px 10px;color:#c9a84c;font-weight:700;">Price</td>
                <td style="padding:8px 10px;color:#c9a84c;font-weight:700;">Change</td>
                <td style="padding:8px 10px;color:#c9a84c;font-weight:700;border-radius:0 4px 0 0;">Note</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:10px 10px;color:#c9a84c;font-weight:700;">RKLB</td>
                <td style="padding:10px 10px;color:#f2ece0;">$127.31</td>
                <td style="padding:10px 10px;color:#9a8a70;">0.0%</td>
                <td style="padding:10px 10px;color:#9a8a70;">Record Q1 $200M rev; Neutron Q4 debut approaching</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:10px 10px;color:#c9a84c;font-weight:700;">ASTS</td>
                <td style="padding:10px 10px;color:#f2ece0;">$88.49</td>
                <td style="padding:10px 10px;color:#4caf87;">+0.4%</td>
                <td style="padding:10px 10px;color:#9a8a70;">BlueBird expansion; up 252% past year; $3.5B cash</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:10px 10px;color:#c9a84c;font-weight:700;">LUNR</td>
                <td style="padding:10px 10px;color:#f2ece0;">$32.46</td>
                <td style="padding:10px 10px;color:#e07a4c;">-3.4%</td>
                <td style="padding:10px 10px;color:#9a8a70;">Record $1.1B backlog; lunar data services expanding</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:10px 10px;color:#c9a84c;font-weight:700;">UFO</td>
                <td style="padding:10px 10px;color:#f2ece0;">$57.07</td>
                <td style="padding:10px 10px;color:#9a8a70;">-0.2%</td>
                <td style="padding:10px 10px;color:#9a8a70;">Procure Space ETF; broad sector macro pressure</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:10px 10px;color:#c9a84c;font-weight:700;">SPCE</td>
                <td style="padding:10px 10px;color:#f2ece0;">$2.58</td>
                <td style="padding:10px 10px;color:#e07a4c;">-1.2%</td>
                <td style="padding:10px 10px;color:#9a8a70;">Virgin Galactic; near multi-year lows; path uncertain</td>
              </tr>
              <tr>
                <td style="padding:10px 10px;color:#c9a84c;font-weight:700;">KTOS</td>
                <td style="padding:10px 10px;color:#f2ece0;">$38.50</td>
                <td style="padding:10px 10px;color:#4caf87;">+1.2%</td>
                <td style="padding:10px 10px;color:#9a8a70;">Kratos Defense; Space Force contracts driving growth</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── FOOTER ── -->
        <tr>
          <td style="background:#070910;padding:20px 24px 24px;border-radius:0 0 8px 8px;text-align:center;border-top:1px solid #1e2540;">
            <p style="margin:0 0 8px;color:#4a5568;font-size:12px;">
              You're receiving SkyTuned because you signed up at
              <a href="https://skytuned.com" style="color:#c9a84c;text-decoration:none;">skytuned.com</a>
            </p>
            <p style="margin:0 0 8px;color:#4a5568;font-size:12px;">
              <a href="https://skytuned.com/unsubscribe?email={{EMAIL}}&token={{TOKEN}}" style="color:#6a7a9a;text-decoration:none;">Unsubscribe</a>
               &nbsp;·&nbsp;
              <a href="https://skytuned.com" style="color:#6a7a9a;text-decoration:none;">Visit SkyTuned</a>
            </p>
            <p style="margin:0;color:#2d3748;font-size:11px;">© 2026 SkyTuned · Space News. Comprehensive. Daily.</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;

// ── SEND VIA SENDGRID ────────────────────────────────────────────────────────
function sendEmail(subscriber) {
  return new Promise((resolve, reject) => {
    const html = EMAIL_HTML
      .replace(/\{\{EMAIL\}\}/g, subscriber.email)
      .replace(/\{\{TOKEN\}\}/g, subscriber.token);

    const payload = JSON.stringify({
      personalizations: [{ to: [{ email: subscriber.email, name: subscriber.name }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject: SUBJECT,
      content: [{ type: 'text/html', value: html }]
    });

    const options = {
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve({ ok: true });
      } else {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`)));
      }
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log(`📡 SkyTuned Daily Email — Wednesday, May 20, 2026`);
  console.log(`📬 Sending to ${subscribers.length} subscribers...\n`);

  let sent = 0, failed = 0;
  const errors = [];

  for (const sub of subscribers) {
    try {
      await sendEmail(sub);
      sent++;
      process.stdout.write(`✓ ${sub.email}\n`);
    } catch (e) {
      failed++;
      errors.push(`${sub.email}: ${e.message}`);
      process.stderr.write(`✗ ${sub.email}: ${e.message}\n`);
    }
    // Small delay to respect SendGrid rate limits
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n──────────────────────────────────────`);
  console.log(`✅ Sent: ${sent}  ❌ Failed: ${failed}`);
  if (errors.length > 0) {
    console.log('\nFailed addresses:');
    errors.forEach(e => console.log(' -', e));
  }
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
