#!/usr/bin/env node
/**
 * TorahTxt Daily Podcast Generator
 * Converts daily Torah lesson JSON → spoken script → MP3 via ElevenLabs
 *
 * Usage:
 *   node generate-podcast.js                        # today, live mode
 *   node generate-podcast.js --date 2026-05-20      # specific date, live mode
 *   node generate-podcast.js --dry-run              # today, script only (no ElevenLabs)
 *   node generate-podcast.js --dry-run --date ...   # specific date, script only
 *
 * Env vars required:
 *   ELEVENLABS_API_KEY  — ElevenLabs secret key
 *   ANTHROPIC_API_KEY   — Anthropic Claude key (for script generation)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ─── CONFIG ────────────────────────────────────────────────────────────────

const ELEVENLABS_VOICE_ID = 'pqHfZKP75CvOlQylNhV4'; // Bill — Wise, Mature, Balanced
const ELEVENLABS_MODEL    = 'eleven_multilingual_v2'; // Best quality; handles Hebrew terms
const ELEVENLABS_SPEED    = 1.1;                      // 10% faster than default
const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY;
const ANTHROPIC_API_KEY   = process.env.ANTHROPIC_API_KEY;
const DEEPSEEK_API_KEY    = process.env.DEEPSEEK_API_KEY;

// Cost-control policy: DeepSeek first, Claude fallback (COST_CONTROL.md)
const PRIMARY_MODEL   = { provider: 'deepseek', model: 'deepseek-chat',   apiKey: () => DEEPSEEK_API_KEY,   host: 'api.deepseek.com',   path: '/v1/chat/completions',   style: 'openai' };
const FALLBACK_MODEL  = { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: () => ANTHROPIC_API_KEY, host: 'api.anthropic.com', path: '/v1/messages', style: 'anthropic' };

// ─── HEBREW PRONUNCIATION MAP ───────────────────────────────────────────────
// Used to create a TTS-optimised version of the script.
// Keys are case-insensitive regex patterns; values are phonetic substitutions.
// The human-readable script.md is saved unmodified; ElevenLabs receives script_tts.md.

const PRONUNCIATION_MAP = [
  // Parasha / Parshot
  [/\bParshat\b/gi,             'Par-shat'],
  [/\bParashat\b/gi,            'Par-ah-shat'],
  [/\bParasha\b/gi,             'Par-ah-shah'],
  [/\bParsha\b/gi,              'Par-shah'],
  // Torah / foundational terms
  [/\bTorah\b/gi,               'Toe-rah'],
  [/\bMitzvah\b/gi,             'Mits-vah'],
  [/\bMitzvot\b/gi,             'Mits-vote'],
  [/\bHashem\b/gi,              'Hah-shem'],
  [/\bShechina\b/gi,            'Sh-khee-nah'],
  [/\bShechinah\b/gi,           'Sh-khee-nah'],
  // Books / People
  [/\bBamidbar\b/gi,            'Bah-mid-bar'],
  [/\bBereshit\b/gi,            'Beh-reh-sheet'],
  [/\bShemot\b/gi,              'Sh-mote'],
  [/\bVayikra\b/gi,             'Vah-yik-rah'],
  [/\bDevarim\b/gi,             'Deh-vah-reem'],
  [/\bMoshe\b/gi,               'Moe-sheh'],
  [/\bAvraham\b/gi,             'Av-rah-ham'],
  [/\bYitzchak\b/gi,            'Yits-chak'],
  [/\bYaakov\b/gi,              'Yah-ah-kov'],
  [/\bYosef\b/gi,               'Yo-sef'],
  [/\bDavid HaMelech\b/gi,      'Dah-vid Hah-meh-lekh'],
  // Institutions / places
  [/\bMishkan\b/gi,             'Mish-kahn'],
  [/\bTabernacle\b/gi,          'Tab-er-na-kl'],
  [/\bShabbat\b/gi,             'Shah-baht'],
  [/\bShabbos\b/gi,             'Shah-bis'],
  // Commentators
  [/\bRashi\b/gi,               'Rah-shee'],
  [/\bRamban\b/gi,              'Rahm-bahn'],
  [/\bRambam\b/gi,              'Rahm-bahm'],
  [/\bSfat Emet\b/gi,           'Sfaht Eh-met'],
  [/\bSfas Emes\b/gi,           'Sfahs Eh-mes'],
  [/\bHirsch\b/gi,              'Hirsh'],
  // Concepts
  [/\bD'var Torah\b/gi,         'D-var Toe-rah'],
  [/\bDvar Torah\b/gi,          'D-var Toe-rah'],
  [/\bBnei Yisrael\b/gi,        "B'nay Yis-rah-el"],
  [/\bB'nei Yisrael\b/gi,       "B'nay Yis-rah-el"],
  [/\bEretz Yisrael\b/gi,       'Eh-rets Yis-rah-el'],
  [/\bBeit HaMikdash\b/gi,      'Bayt Hah-mik-dash'],
  [/\bTeshuvah\b/gi,            'T-shoo-vah'],
  [/\bChesed\b/gi,              'Kheh-sed'],
  [/\bEmet\b/gi,                'Eh-met'],
  [/\bTzaddik\b/gi,             'Tsah-dik'],
  [/\bTzedakah\b/gi,            'Tsed-ah-kah'],
  [/\bDavening\b/gi,            'Dah-ven-ing'],
  [/\bDaven\b/gi,               'Dah-ven'],
  [/\bNeshama\b/gi,             'N-shah-mah'],
  [/\bNeshamot\b/gi,            'N-shah-mote'],
  [/\bHalachah\b/gi,            'Hah-lah-khah'],
  [/\bHalacha\b/gi,             'Hah-lah-khah'],
  [/\bKiddush Hashem\b/gi,      'Ki-dush Hah-shem'],
  [/\bKiddush\b/gi,             'Ki-dush'],
  [/\bHavdalah\b/gi,            'Hav-dah-lah'],
];

function applyPronunciationMap(text) {
  let out = text;
  for (const [pattern, replacement] of PRONUNCIATION_MAP) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR    = path.join(__dirname, 'content', 'daily');
const PODCAST_DIR    = path.join(WORKSPACE_ROOT, 'podcasts', 'daily-torah');
const LOG_FILE       = path.join(PODCAST_DIR, 'podcast.log');

// ─── CLI ARGS ───────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const dateArg = (() => {
  const i = args.indexOf('--date');
  return i !== -1 ? args[i + 1] : null;
})();

const TODAY = dateArg || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// ─── HELPERS ────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── STEP 1: LOAD SOURCE LESSON ─────────────────────────────────────────────

function loadLesson(date) {
  const filePath = path.join(CONTENT_DIR, `${date}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Source lesson not found: ${filePath}`);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse ${filePath}: ${e.message}`);
  }
  if (!data.email || !data.title) {
    throw new Error(`Source lesson at ${filePath} is missing required fields (title, email).`);
  }
  return { ...data, sourceFile: filePath };
}

// ─── STEP 2: GENERATE SPOKEN SCRIPT (DeepSeek first, Claude fallback) ──────────────
// Cost-control policy (COST_CONTROL.md): DeepSeek is the primary model.
// Claude is used only if DeepSeek fails or produces unusable output.

async function callLLM(modelCfg, systemPrompt, userPrompt) {
  const key = modelCfg.apiKey();
  if (!key) throw new Error(`${modelCfg.provider} API key not set.`);

  if (modelCfg.style === 'openai') {
    const body = {
      model: modelCfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ],
      max_tokens: 1500,
      temperature: 0.7
    };
    const res = await httpsPost(
      modelCfg.host, modelCfg.path,
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body
    );
    if (res.status !== 200) throw new Error(`DeepSeek API error ${res.status}: ${res.body.toString().slice(0,200)}`);
    const json = JSON.parse(res.body.toString());
    const text = json.choices?.[0]?.message?.content;
    if (!text || text.trim().length < 100) throw new Error('DeepSeek returned empty or too-short content.');
    return text;
  } else {
    const body = {
      model: modelCfg.model,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    };
    const res = await httpsPost(
      modelCfg.host, modelCfg.path,
      { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body
    );
    if (res.status !== 200) throw new Error(`Anthropic API error ${res.status}: ${res.body.toString().slice(0,200)}`);
    const json = JSON.parse(res.body.toString());
    const text = json.content?.[0]?.text;
    if (!text) throw new Error('Anthropic returned empty content.');
    return text;
  }
}

// ─── STEP 2: GENERATE SPOKEN SCRIPT (DeepSeek first, Claude fallback) ──────────────────────────────

async function generateScript(lesson, date) {
  if (!DEEPSEEK_API_KEY && !ANTHROPIC_API_KEY) {
    throw new Error('Neither DEEPSEEK_API_KEY nor ANTHROPIC_API_KEY is set. Cannot generate script.');
  }

  // Parse parasha name from first line of email content
  const firstLine = (lesson.email || '').split('\n')[0].trim();
  const parshaMatch = firstLine.match(/Parshat?\s+\S+/i) || firstLine.match(/^([^—–\n]+)/);
  const parshaName = parshaMatch ? parshaMatch[0].trim() : 'Today\'s Parasha';

  const dateObj   = new Date(date + 'T12:00:00Z');
  const dateLabel = dateObj.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const systemPrompt = `You are writing a spoken podcast script for "TorahTxt Daily," a short daily Torah reflection podcast. 
The script will be read aloud by a warm, mature voice (Bill). 

RULES:
- Write ONLY the spoken words — no stage directions, no markdown headers, no asterisks, no bullet points.
- Paragraphs only. Natural spoken language.
- Preserve Hebrew and Aramaic terms (Mishkan, Shechina, Parasha, D'var Torah, Rashi, Ramban, etc.) exactly as they appear — they will be pronounced naturally by the TTS voice.
- Do not invent Torah content. Base everything on the source material provided.
- Keep the intro and outro warm but brief — the lesson is the centerpiece.
- Target: 550–750 spoken words total (roughly 4–5 minutes at natural pace).
- Avoid overly dramatic language. Calm, thoughtful, conversational.`;

  const userPrompt = `Convert this Torah lesson into a spoken podcast script.

Date: ${dateLabel}
Lesson title: ${lesson.title}
Source: ${firstLine}

SOURCE LESSON (email version — use this as your content basis):
${lesson.email}

SCRIPT STRUCTURE:
1. INTRO (~40 words): "Welcome to TorahTxt Daily. I'm glad you're here. Today is ${dateLabel}. Our lesson today comes from ${parshaName}..."
2. THE LESSON (~400–550 words): Spoken version of the source content. Keep all the named commentators and their ideas. Natural spoken flow — no bullet points.
3. TAKEAWAY (~80 words): Draw out the practical/personal application from the closing lines of the source.
4. CLOSING (~40 words): End with: "Have a meaningful day. This has been TorahTxt Daily — dedicated to the memory of Michael Green, who showed us that Torah isn't just studied. It's lived."

Write the full script now, spoken words only:`;

  // Cost-control policy (COST_CONTROL.md): try DeepSeek first, Claude fallback
  let script = null;
  let modelUsed = null;
  let fallbackReason = null;

  if (DEEPSEEK_API_KEY) {
    try {
      script = await callLLM(PRIMARY_MODEL, systemPrompt, userPrompt);
      modelUsed = 'deepseek/deepseek-chat';
    } catch (err) {
      fallbackReason = `DeepSeek failed: ${err.message}`;
    }
  } else {
    fallbackReason = 'DEEPSEEK_API_KEY not set — skipping primary model';
  }

  if (!script) {
    if (!ANTHROPIC_API_KEY) throw new Error(`Script generation failed. ${fallbackReason}. ANTHROPIC_API_KEY also not set.`);
    // Log escalation per cost-control policy
    console.log(`[COST-CONTROL] Escalating to Claude. Reason: ${fallbackReason}`);
    script = await callLLM(FALLBACK_MODEL, systemPrompt, userPrompt);
    modelUsed = 'anthropic/claude-sonnet-4-6';
  }

  return { script, parshaName, dateLabel, modelUsed, fallbackReason };
}

// ─── STEP 3: GENERATE AUDIO VIA ELEVENLABS ──────────────────────────────────

async function generateAudio(script, outputPath) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not set. Cannot generate audio.');
  }

  const reqBody = {
    text: script,
    model_id: ELEVENLABS_MODEL,
    speed: ELEVENLABS_SPEED,   // 1.1 = 10% faster; range 0.7–1.2
    voice_settings: {
      stability: 0.55,         // Slight variation for natural speech
      similarity_boost: 0.80,  // Stay close to Bill's voice character
      style: 0.20,             // Gentle expressiveness — not flat, not dramatic
      use_speaker_boost: true
    }
  };

  const res = await httpsPost(
    'api.elevenlabs.io',
    `/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
      'Accept': 'audio/mpeg'
    },
    reqBody
  );

  if (res.status !== 200) {
    const errText = res.body.toString().slice(0, 300);
    throw new Error(`ElevenLabs API error ${res.status}: ${errText}`);
  }

  fs.writeFileSync(outputPath, res.body);
  return res.body.length;
}

// ─── STEP 4: WRITE METADATA ──────────────────────────────────────────────────

function writeMetadata(outDir, date, lesson, parshaName, dateLabel, scriptPath, ttsPath, audioPath, audioBytes, status, scriptModel, fallbackReason) {
  const wordCount  = (lesson.script || '').split(/\s+/).filter(Boolean).length;
  const estMinutes = Math.round(wordCount / 135); // ~135 wpm natural pace
  const estSeconds = Math.round((wordCount / 135) * 60);

  const meta = {
    project:        'TorahTxt Daily Podcast',
    date,
    title:          lesson.title,
    parasha:        parshaName,
    date_formatted: dateLabel,
    subject:        `TorahTxt Daily — ${lesson.title}`,
    description:    (lesson.sms || '').replace(/\s+/g, ' ').trim(),
    source_file:    lesson.sourceFile,
    script_path:    scriptPath,
    tts_script_path: ttsPath,
    audio_path:     audioPath || null,
    script_model:   scriptModel || 'unknown',
    fallback_reason: fallbackReason || null,
    voice_id:       ELEVENLABS_VOICE_ID,
    voice_name:     'Bill',
    elevenlabs_model: ELEVENLABS_MODEL,
    elevenlabs_speed: ELEVENLABS_SPEED,
    word_count:     wordCount,
    duration_estimate_seconds: estSeconds,
    duration_estimate_formatted: `${estMinutes}m ${estSeconds % 60}s`,
    audio_size_bytes: audioBytes || null,
    audio_size_kb:  audioBytes ? Math.round(audioBytes / 1024) : null,
    status,
    generated_at:   new Date().toISOString(),
    dry_run:        DRY_RUN,
    // RSS-ready fields for future use
    rss_ready: {
      enclosure_type: 'audio/mpeg',
      itunes_author:  'TorahTxt Daily',
      itunes_subtitle: parshaName,
      itunes_summary: (lesson.email || '').slice(0, 255) + '...',
      itunes_explicit: 'no',
      itunes_duration: `${String(estMinutes).padStart(2,'0')}:${String(estSeconds % 60).padStart(2,'0')}`
    }
  };

  const metaPath = path.join(outDir, 'metadata.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return metaPath;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  // Ensure dirs exist
  fs.mkdirSync(PODCAST_DIR, { recursive: true });

  const outDir = path.join(PODCAST_DIR, TODAY);
  fs.mkdirSync(outDir, { recursive: true });

  const mode = DRY_RUN ? 'DRY-RUN' : 'LIVE';
  log(`=== TorahTxt Podcast Generator [${mode}] — ${TODAY} ===`);

  // ── Step 1: Load lesson ──
  let lesson;
  try {
    lesson = loadLesson(TODAY);
    log(`✓ Source loaded: ${lesson.title} (${lesson.email.length} chars)`);
  } catch (err) {
    log(`✗ FAILED to load source lesson: ${err.message}`);
    const failMeta = path.join(outDir, 'metadata.json');
    fs.writeFileSync(failMeta, JSON.stringify({ date: TODAY, status: 'failed', error: err.message, generated_at: new Date().toISOString() }, null, 2));
    process.exit(1);
  }

  // ── Step 2: Generate script ──
  let scriptText, parshaName, dateLabel, scriptModel, fallbackReason;
  try {
    log('Generating spoken script (DeepSeek first, Claude fallback per COST_CONTROL.md)...');
    ({ script: scriptText, parshaName, dateLabel,
       modelUsed: scriptModel, fallbackReason } = await generateScript(lesson, TODAY));
    log(`✓ Script generated: ${scriptText.split(/\s+/).length} words via ${scriptModel}`);
    if (fallbackReason) log(`[COST-CONTROL] Claude used. Reason: ${fallbackReason}`);
  } catch (err) {
    log(`✗ FAILED to generate script: ${err.message}`);
    process.exit(1);
  }

  // Save human-readable script
  const scriptPath = path.join(outDir, 'script.md');
  const scriptMd = `# TorahTxt Daily Podcast — ${TODAY}\n**${lesson.title}**\n*${parshaName} · ${dateLabel}*\n\n---\n\n${scriptText}\n`;
  fs.writeFileSync(scriptPath, scriptMd);
  log(`✓ Script saved: ${scriptPath}`);

  // Apply pronunciation map and save TTS version
  const ttsSafe = applyPronunciationMap(scriptText);
  const ttsPath = path.join(outDir, 'script_tts.md');
  const ttsMd = `# TorahTxt Daily Podcast — TTS Version — ${TODAY}\n**${lesson.title}**\n*${parshaName} · ${dateLabel}*\n\n> This file is the ElevenLabs-ready pronunciation version. Do not use for human reading.\n\n---\n\n${ttsSafe}\n`;
  fs.writeFileSync(ttsPath, ttsMd);
  log(`✓ TTS script saved: ${ttsPath}`);

  // Attach to lesson object for metadata
  lesson.script = scriptText;

  const audioPath = path.join(outDir, `audio.mp3`);
  let audioBytes  = null;
  let status      = 'script-only';

  // ── Step 3: Generate audio (live mode only) ──
  if (!DRY_RUN) {
    try {
      log(`Calling ElevenLabs (voice: Bill / ${ELEVENLABS_VOICE_ID}, speed: ${ELEVENLABS_SPEED})...`);
      audioBytes = await generateAudio(ttsSafe, audioPath);  // send TTS-safe version
      log(`✓ Audio saved: ${audioPath} (${Math.round(audioBytes / 1024)} KB)`);
      status = 'success';
    } catch (err) {
      log(`✗ FAILED ElevenLabs call: ${err.message}`);
      status = 'audio-failed';
    }
  } else {
    log(`[DRY-RUN] Skipping ElevenLabs call. Script generation complete.`);
    status = 'dry-run';
  }

  // ── Step 4: Write metadata ──
  const metaPath = writeMetadata(outDir, TODAY, lesson, parshaName, dateLabel,
    scriptPath,
    ttsPath,
    DRY_RUN ? null : (status === 'success' ? audioPath : null),
    audioBytes,
    status,
    scriptModel,
    fallbackReason
  );
  log(`✓ Metadata saved: ${metaPath}`);

  // ── Summary ──
  log(`=== DONE [${status.toUpperCase()}] ===`);
  console.log('\n─────────────────────────────────────────');
  console.log(`  Date:        ${TODAY}`);
  console.log(`  Mode:        ${mode}`);
  console.log(`  Status:      ${status}`);
  console.log(`  Lesson:      ${lesson.title}`);
  console.log(`  Script:      ${scriptPath}`);
  console.log(`  Audio:       ${status === 'success' ? audioPath : '(not generated)'}`);
  if (audioBytes) console.log(`  Audio size:  ${Math.round(audioBytes / 1024)} KB`);
  console.log(`  Metadata:    ${metaPath}`);
  console.log(`  Log:         ${LOG_FILE}`);
  console.log('─────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
