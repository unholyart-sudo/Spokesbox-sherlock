# DO_NOT_RUN: archived legacy Spokesbox sender. Do not execute. Kept only for historical reference.
# This script was the source of duplicate/stale emails on May 22, 2026.
# Canonical sender is OpenClaw cron e727f97e — "Spokesbox Daily Brief — 7:00 AM".
# Archived: 2026-05-22

#!/usr/bin/env python3
"""Spokesbox Newsletter Sender - May 21, 2026"""

import json
import urllib.request
import urllib.error

SENDGRID_API_KEY = "SG.SPOKESBOX_OLD_KEY_REDACTED"
FROM_EMAIL = "jared@jaredgreen.com"
FROM_NAME = "Spokesbox"
SUBJECT = "📬 Your Spokesbox Newsletter — Thursday, May 21"

def send_email(to_email, to_name, subject, html_body):
    url = "https://api.sendgrid.com/v3/mail/send"
    payload = {
        "personalizations": [{"to": [{"email": to_email, "name": to_name}]}],
        "from": {"email": FROM_EMAIL, "name": FROM_NAME},
        "subject": subject,
        "content": [{"type": "text/html", "value": html_body}]
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {SENDGRID_API_KEY}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, "OK"
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

BASE_STYLE = """
<style>
  body { margin:0; padding:0; background:#f4f4f4; font-family: 'Helvetica Neue', Arial, sans-serif; }
  .wrapper { max-width:600px; margin:0 auto; background:#ffffff; }
  .header { background:#1a1a2e; padding:28px 32px; text-align:center; }
  .header h1 { color:#e8c84a; margin:0; font-size:26px; letter-spacing:1px; }
  .header p { color:#aaaacc; margin:6px 0 0; font-size:13px; }
  .section { padding:24px 32px; border-bottom:1px solid #f0f0f0; }
  .section h2 { color:#1a1a2e; font-size:16px; text-transform:uppercase; letter-spacing:0.5px; margin:0 0 12px; display:flex; align-items:center; gap:8px; }
  .section p { color:#444; font-size:15px; line-height:1.6; margin:0 0 10px; }
  .section ul { padding-left:18px; color:#444; font-size:15px; line-height:1.8; margin:0; }
  .joke-box { background:#fff8e1; border-left:4px solid #e8c84a; padding:14px 18px; border-radius:4px; font-size:15px; color:#555; }
  .footer { background:#f9f9f9; padding:18px 32px; text-align:center; font-size:12px; color:#aaa; }
  .tag { display:inline-block; background:#e8f4fd; color:#1a6fa0; padding:2px 8px; border-radius:10px; font-size:12px; margin-right:4px; }
  .highlight { color:#1a6fa0; font-weight:bold; }
  .emoji-header { font-size:20px; margin-right:6px; }
</style>
"""

# ─────────────────────────────────────────────
# NEWSLETTER 1: Jride — informative, medium
# Topics: Finance & Markets, Technology, Sports, Local News, Daily Joke
# ─────────────────────────────────────────────
JRIDE_HTML = BASE_STYLE + """
<div class="wrapper">
  <div class="header">
    <h1>📬 SPOKESBOX</h1>
    <p>Thursday, May 21, 2026 &nbsp;|&nbsp; Good morning, Jride!</p>
  </div>

  <div class="section">
    <h2><span class="emoji-header">😂</span> Daily Joke</h2>
    <div class="joke-box">
      I told my accountant I wanted to invest in something with explosive growth.<br>
      He handed me a list of AI stocks and a box of antacids. 📈
    </div>
  </div>

  <div class="section">
    <h2><span class="emoji-header">💰</span> Finance & Markets</h2>
    <ul>
      <li><span class="highlight">Dow Jones crossed 50,000</span> — climbing 645 pts (+1.31%) yesterday as Middle East tension eases</li>
      <li><span class="highlight">S&P 500 at 7,434</span> — up 1.08%, Nasdaq +1.54%</li>
      <li><span class="highlight">Nvidia blowout earnings:</span> Record $81.6B revenue (+85% YoY), $58.3B profit. CEO Jensen Huang: "Demand has gone parabolic." Added $80B in buybacks.</li>
      <li><span class="highlight">OpenAI IPO filing:</span> Company reportedly filed preliminary paperwork for what could be the largest-ever IPO</li>
      <li><span class="highlight">SpaceX</span> also publicly filed for an IPO this week</li>
      <li><span class="highlight">Bond market watch:</span> 10-yr yield above 4.5%, 30-yr crossed 5.1% — Fed minutes hint at possible rate hike</li>
      <li><span class="highlight">Oil:</span> Brent crude at $105.72/barrel after 5%+ drop yesterday on Iran deal optimism</li>
    </ul>
  </div>

  <div class="section">
    <h2><span class="emoji-header">🏀</span> Sports</h2>
    <ul>
      <li><span class="highlight">NBA East Finals — Knicks lead Cavaliers 1-0:</span> Jalen Brunson erupted for 38 pts as NY overcame a 22-pt 4th quarter deficit in OT, 115-104. Game 2 tonight at 8 PM ET on ESPN</li>
      <li><span class="highlight">NBA West Finals — OKC evens series vs Spurs 1-1:</span> Thunder win Game 2, 122-113 despite injury concerns for both sides. De'Aaron Fox (ankle) and Jalen Williams (hamstring) both in question. Game 3 Friday.</li>
      <li><span class="highlight">NBA Finals:</span> Set to tip off June 3rd</li>
      <li><span class="highlight">MLB today:</span> Yankees host Blue Jays; Cardinals host Pirates (5-0 vs PIT this season)</li>
      <li><span class="highlight">Soccer:</span> Arsenal clinched the Premier League title for the first time in 22 years 🏆</li>
    </ul>
  </div>

  <div class="section">
    <h2><span class="emoji-header">💻</span> Technology</h2>
    <ul>
      <li><span class="highlight">Nvidia's "Physical AI" push:</span> Introduced Vera Rubin platform — the first processor built specifically for agentic AI. Expanding into robotics, autonomous vehicles, and edge computing</li>
      <li><span class="highlight">Google + Nvidia partnership expands</span> with new Vera Rubin-powered A5X cloud instances running Gemini models</li>
      <li><span class="highlight">Meta & LinkedIn restructuring</span> for AI efficiency — LinkedIn cut 600+ jobs this week</li>
      <li><span class="highlight">Korea's AI rally:</span> Samsung +6%, SK Hynix +11% after wage deal and Nvidia's results lit up Asian markets</li>
    </ul>
  </div>

  <div class="section">
    <h2><span class="emoji-header">📍</span> Local News</h2>
    <ul>
      <li><span class="highlight">LaGuardia Airport sinkhole:</span> A sinkhole forced runway closure at LGA, causing cancellations and delays — check your flights if traveling today</li>
      <li><span class="highlight">US indicts Raúl Castro</span> over the 1996 shootdown of two civilian aircraft flown by anti-Castro pilots, as the USS Nimitz carrier group arrives in the Caribbean</li>
      <li><span class="highlight">Trump warns Iran:</span> "Agree to a deal or face some nasty things" — negotiations reportedly in final stages as US boards Iranian oil tanker in Gulf of Oman</li>
    </ul>
  </div>

  <div class="footer">
    <p>You're on the Spokesbox trial — thanks for being here 🙌</p>
    <p style="margin-top:6px;">© 2026 Spokesbox &nbsp;|&nbsp; Unsubscribe</p>
  </div>
</div>
"""

# ─────────────────────────────────────────────
# NEWSLETTER 2: Avi — upbeat, short, age ~8-9
# Topics: Sports (Soccer), Daily Joke, Fun Facts, Trivia, Word of the Day
# South Orange, NJ
# ─────────────────────────────────────────────
AVI_HTML = BASE_STYLE + """
<div class="wrapper">
  <div class="header">
    <h1>📬 SPOKESBOX</h1>
    <p>Thursday, May 21, 2026 &nbsp;|&nbsp; Hey Avi! ⚽</p>
  </div>

  <div class="section">
    <h2><span class="emoji-header">😂</span> Daily Joke</h2>
    <div class="joke-box">
      Why did the soccer player bring string to the game?<br>
      Because he wanted to <strong>tie</strong> the score! ⚽😄
    </div>
  </div>

  <div class="section">
    <h2><span class="emoji-header">⚽</span> Soccer News</h2>
    <ul>
      <li>🏆 <span class="highlight">Arsenal won the Premier League!</span> Their first title in 22 years — the whole city of London went wild!</li>
      <li>🇺🇸 <span class="highlight">MLS All-Star voting ends TODAY</span> at midnight! The All-Stars will play against Mexico's Liga MX on July 29 in Charlotte — you can still vote for your favorite player!</li>
      <li>⚽ Colorado Rapids knocked out San Jose in the U.S. Open Cup and made the semifinals for the first time since 1999!</li>
      <li>🌍 MLS is taking a break soon for the <span class="highlight">FIFA World Cup</span> — soccer's biggest event is coming up!</li>
    </ul>
  </div>

  <div class="section">
    <h2><span class="emoji-header">🌟</span> Fun Fact of the Day</h2>
    <p>🦐 After a huge storm in <span class="highlight">Hawaii</span>, a field turned into a lake overnight — and ancient "dinosaur shrimp" that had been sleeping underground for YEARS woke up and started swimming! These creatures are so tough they can survive for decades as eggs just waiting for water. How cool is that?!</p>
  </div>

  <div class="section">
    <h2><span class="emoji-header">🧠</span> Trivia Time!</h2>
    <p><strong>Question:</strong> How many players are on the field for one soccer team at a time?</p>
    <p style="color:#aaa; font-style:italic;">👇 Scroll for the answer...</p>
    <p><strong>Answer:</strong> <span class="highlight">11 players!</span> Including the goalkeeper 🧤</p>
  </div>

  <div class="section">
    <h2><span class="emoji-header">📖</span> Word of the Day</h2>
    <p><strong>TENACIOUS</strong> <span style="color:#888; font-size:13px;">[tuh-NAY-shuss]</span></p>
    <p>It means <span class="highlight">never giving up</span>, no matter how hard things get. Like a soccer player who keeps chasing the ball even when they're tired!</p>
    <p><em>"She was tenacious — even down 2-0, she kept pushing until she scored the tying goal."</em></p>
  </div>

  <div class="footer">
    <p>You're on the Spokesbox trial — thanks for being here 🙌</p>
    <p style="margin-top:6px;">© 2026 Spokesbox &nbsp;|&nbsp; Unsubscribe</p>
  </div>
</div>
"""

# ─────────────────────────────────────────────
# NEWSLETTER 3: Bob — upbeat, short
# Topics: Sports (Warriors, Duke, Tournaments), Finance (DAC, SFTBY), Humor, Politics
# Corte Madera, CA | DOB: 08/14/1981
# ─────────────────────────────────────────────
BOB_HTML = BASE_STYLE + """
<div class="wrapper">
  <div class="header">
    <h1>📬 SPOKESBOX</h1>
    <p>Thursday, May 21, 2026 &nbsp;|&nbsp; Morning, Bob! ☀️</p>
  </div>

  <div class="section">
    <h2><span class="emoji-header">😂</span> Humor Corner</h2>
    <div class="joke-box">
      The Warriors finished 37-45 this season.<br>
      On the bright side, they're now the heavy favorites to land the 11th pick. Progress! 🏆😅
    </div>
  </div>

  <div class="section">
    <h2><span class="emoji-header">🏀</span> Sports</h2>
    <p><strong>Warriors Offseason Watch 🌉</strong></p>
    <ul>
      <li>After a 37-45 season and Play-In exit, the Warriors are hunting big names: <span class="highlight">Giannis, Kawhi, and LeBron</span> all linked to Golden State</li>
      <li>Curry's contract extension talks heating up — reportedly contingent on the Warriors making big moves</li>
      <li>Draymond may <span class="highlight">opt out</span> to free up cap space and re-sign on a new deal</li>
      <li>Warriors hold the <span class="highlight">11th pick</span> in the upcoming draft — GM Mike Dunleavy Jr. says all options open</li>
    </ul>
    <p style="margin-top:14px;"><strong>NBA Conference Finals 🏆</strong></p>
    <ul>
      <li>🗽 <span class="highlight">Knicks lead Cavs 1-0</span> after Brunson's 38-pt OT classic. Game 2 tonight on ESPN at 8 PM ET</li>
      <li>⚡ <span class="highlight">OKC evens series vs Spurs 1-1</span> — both teams dealing with injury drama. Game 3 Friday</li>
    </ul>
    <p style="margin-top:14px;"><strong>Duke Basketball 🔵😈</strong></p>
    <ul>
      <li>Offseason is heating up — Duke coaching staff is reportedly active in portal recruiting to reload for next season's tournament run</li>
    </ul>
  </div>

  <div class="section">
    <h2><span class="emoji-header">💰</span> Finance (DAC & SFTBY)</h2>
    <ul>
      <li><span class="highlight">Markets surging:</span> Dow +645 pts (50K!), S&P +1.08%, Nasdaq +1.54% yesterday on Nvidia earnings + Iran deal optimism</li>
      <li><span class="highlight">Nvidia (NVDA):</span> Record $81.6B revenue (+85% YoY), $58.3B profit. Added $80B buyback + raised dividend. CEO: "Demand has gone parabolic." Stock dipped slightly after-hours on cautious outlook vs. lofty expectations.</li>
      <li><span class="highlight">DAC (Danaos Corp):</span> Container shipping space benefiting from elevated cargo demand — oil tensions in the Middle East keeping shipping rates firm. Worth monitoring Iran/US deal impact on Strait of Hormuz traffic.</li>
      <li><span class="highlight">SFTBY (SoftBank):</span> SoftBank jumped nearly <span class="highlight">20%</span> in Asian trading today following Nvidia's results and OpenAI IPO news — SoftBank is a major OpenAI backer. Huge day if you're holding.</li>
      <li><span class="highlight">OpenAI IPO:</span> Filed preliminary paperwork — could be the largest IPO ever. SpaceX also filed this week.</li>
      <li><span class="highlight">Bond watch:</span> 10-yr yield above 4.5%, 30-yr above 5.1%. Fed minutes hint at possible rate hike — keep an eye on duration risk.</li>
    </ul>
  </div>

  <div class="section">
    <h2><span class="emoji-header">🏛️</span> Politics</h2>
    <ul>
      <li><span class="highlight">Trump warns Iran:</span> "Agree to a deal or face some nasty things" — negotiations reportedly in final stages</li>
      <li><span class="highlight">US indicts Raúl Castro</span> (Cuba's former president) over the 1996 civilian plane shootdown as USS Nimitz arrives in Caribbean</li>
      <li>China <span class="highlight">blocked</span> a Pentagon official's visit over $14B Taiwan arms deal</li>
    </ul>
  </div>

  <div class="footer">
    <p>You're on the Spokesbox trial — thanks for being here 🙌</p>
    <p style="margin-top:6px;">© 2026 Spokesbox &nbsp;|&nbsp; Unsubscribe</p>
  </div>
</div>
"""

# ─────────────────────────────────────────────
# GENERIC NEWSLETTER for test/NYC accounts
# Topics: General news, Finance, Sports, Technology
# ─────────────────────────────────────────────
def make_generic_html(name):
    return BASE_STYLE + f"""
<div class="wrapper">
  <div class="header">
    <h1>📬 SPOKESBOX</h1>
    <p>Thursday, May 21, 2026 &nbsp;|&nbsp; Good morning, {name}!</p>
  </div>

  <div class="section">
    <h2><span class="emoji-header">🗞️</span> Today's Top Stories</h2>
    <ul>
      <li><span class="highlight">LaGuardia sinkhole:</span> Runway closed at LGA causing flight delays — check your travel plans</li>
      <li><span class="highlight">US-Iran talks in "final stages":</span> Trump warns Iran to "agree or face nasty things" as US boards Iranian tanker in Gulf of Oman</li>
      <li><span class="highlight">Arsenal wins Premier League</span> for first time in 22 years 🏆</li>
      <li><span class="highlight">Ebola outbreak:</span> 130+ deaths in DR Congo/Uganda — health officials racing to contain it</li>
    </ul>
  </div>

  <div class="section">
    <h2><span class="emoji-header">💰</span> Markets</h2>
    <ul>
      <li>Dow climbed 645 pts past <span class="highlight">50,000</span> yesterday (+1.31%)</li>
      <li>Nvidia posted record <span class="highlight">$81.6B revenue</span> — AI chip demand "gone parabolic," per CEO Jensen Huang</li>
      <li>OpenAI & SpaceX both filed for IPOs this week</li>
      <li>Oil: Brent crude at $105.72 after 5%+ drop on Iran deal optimism</li>
    </ul>
  </div>

  <div class="section">
    <h2><span class="emoji-header">🏀</span> Sports</h2>
    <ul>
      <li><span class="highlight">NBA East Finals:</span> Knicks lead Cavaliers 1-0 — Brunson dropped 38 in OT thriller. Game 2 tonight, 8 PM ET ESPN</li>
      <li><span class="highlight">NBA West Finals:</span> OKC evens it 1-1 vs Spurs, 122-113. Game 3 Friday.</li>
      <li>Yankees host Blue Jays today in MLB</li>
    </ul>
  </div>

  <div class="section">
    <h2><span class="emoji-header">💻</span> Technology</h2>
    <ul>
      <li>Nvidia unveiled <span class="highlight">Vera Rubin</span> — the first chip designed for "agentic AI" — alongside a $80B share buyback</li>
      <li>LinkedIn cuts 600+ jobs as Meta also restructures around AI</li>
      <li>South Korea's KOSPI surged 7-8% overnight on Nvidia earnings + AI enthusiasm</li>
    </ul>
  </div>

  <div class="section">
    <h2><span class="emoji-header">😂</span> Daily Joke</h2>
    <div class="joke-box">
      Why don't scientists trust atoms?<br>
      Because they <strong>make up everything!</strong> 🔬😄
    </div>
  </div>

  <div class="footer">
    <p>You're on the Spokesbox trial — thanks for being here 🙌</p>
    <p style="margin-top:6px;">© 2026 Spokesbox &nbsp;|&nbsp; Unsubscribe</p>
  </div>
</div>
"""

# ─────────────────────────────────────────────
# Subscriber list
# ─────────────────────────────────────────────
subscribers = [
    # Real subscribers
    {"id": 2,   "email": "unholyart@gmail.com",               "name": "Jride",      "html": JRIDE_HTML},
    {"id": 7,   "email": "greena35@goastudent.org",           "name": "Avi",        "html": AVI_HTML},
    {"id": 8,   "email": "stevenjoshuagreen@gmail.com",       "name": "Bob",        "html": BOB_HTML},
    # Test accounts — generic
    {"id": 44,  "email": "fulltest@test.com",                 "name": "Full Tester",  "html": None},
    {"id": 45,  "email": "verify3@test.com",                  "name": "Verify User",  "html": None},
    {"id": 47,  "email": "qa-onboarding@test.com",            "name": "QA User",      "html": None},
    {"id": 52,  "email": "preview-qa@test.com",               "name": "Preview QA",   "html": None},
    {"id": 55,  "email": "fix-qa@test.com",                   "name": "Fix QA",       "html": None},
    {"id": 59,  "email": "trace@test.com",                    "name": "Trace",         "html": None},
    {"id": 60,  "email": "endtoend@test.com",                 "name": "End User",      "html": None},
    {"id": 64,  "email": "trialcheck@test.com",               "name": "Check",         "html": None},
    {"id": 65,  "email": "jride-verify@test.com",             "name": "Jared",         "html": None},
    {"id": 71,  "email": "social-arch@test.com",              "name": "Arch Test",     "html": None},
    {"id": 204, "email": "flowtest@example.com",              "name": "Flow Tester",   "html": None},
    {"id": 250, "email": "test+debug_1778706575052@example.com", "name": "Test User",  "html": None},
    {"id": 253, "email": "test+exact_1778706599779@example.com", "name": "Test User",  "html": None},
]

sent = []
failed = []

for sub in subscribers:
    html = sub["html"] if sub["html"] else make_generic_html(sub["name"])
    status, msg = send_email(sub["email"], sub["name"], SUBJECT, html)
    if status in (200, 202):
        print(f"✅ Sent to {sub['email']} ({sub['name']}) — HTTP {status}")
        sent.append(sub["email"])
    else:
        print(f"❌ Failed {sub['email']} — HTTP {status}: {msg[:200]}")
        failed.append(sub["email"])

print(f"\n{'='*50}")
print(f"SENT: {len(sent)} | FAILED: {len(failed)}")
if sent:
    print("Sent to: " + ", ".join(sent))
if failed:
    print("Failed: " + ", ".join(failed))
