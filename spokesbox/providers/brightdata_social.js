'use strict';
/**
 * Bright Data Social Media Scraper adapter.
 * Docs: https://docs.brightdata.com/api-reference/scrapers/social-media-apis/overview
 *
 * Activate: set BRIGHTDATA_API_KEY in .env
 *
 * Bright Data endpoints are organized by: platform → object → action → input method.
 * We use the "collect by URL" input method for all platforms.
 */

const https = require('https');

const API_KEY  = process.env.BRIGHTDATA_API_KEY || '';
const BASE_URL = 'https://api.brightdata.com';
const TIMEOUT  = parseInt(process.env.SOCIAL_ENRICHMENT_TIMEOUT_MS || '12000', 10);

// Platform → Bright Data dataset ID mapping.
// Find dataset IDs at: https://brightdata.com/products/web-scraper/social-media-scrape
const DATASET_IDS = {
  linkedin:  'gd_l1viktl72bvl7s60l4',  // LinkedIn Profiles
  instagram: 'gd_l1vikfnt1wgvvqz95w',  // Instagram Profiles + Posts
  twitter:   'gd_lkj3j0l1t5qvd1e62v',  // Twitter/X Profiles + Posts
  facebook:  'gd_l95fol1t29foz82k6l',  // Facebook Profiles/Pages
  reddit:    'gd_l95fol1t29foz82k6r',  // Reddit Users + Posts
};

function isConfigured() {
  return !!API_KEY;
}

/**
 * Collect public profile data by URL.
 * Returns normalized shape: { platform, profile, posts, comments, source_meta }
 */
async function collectProfileByUrl({ platform, url }) {
  if (!isConfigured()) throw new Error('Bright Data API key not configured');

  const datasetId = DATASET_IDS[platform];
  if (!datasetId) throw new Error(`No Bright Data dataset for platform: ${platform}`);

  // Step 1: trigger collection
  const triggerResp = await apiRequest('POST', `/datasets/v3/trigger?dataset_id=${datasetId}&include_errors=true`, [
    { url }
  ]);
  const snapshotId = triggerResp.snapshot_id;
  if (!snapshotId) throw new Error('Bright Data trigger returned no snapshot_id');

  // Step 2: poll until ready (simple poll with timeout)
  const deadline = Date.now() + TIMEOUT;
  let data = null;
  while (Date.now() < deadline) {
    await sleep(2000);
    const statusResp = await apiRequest('GET', `/datasets/v3/snapshot/${snapshotId}?format=json`);
    if (statusResp.status === 'ready' || Array.isArray(statusResp)) {
      data = Array.isArray(statusResp) ? statusResp : statusResp.data;
      break;
    }
    if (statusResp.status === 'failed') throw new Error(`Bright Data snapshot failed: ${statusResp.message}`);
  }

  if (!data) throw new Error('Bright Data timeout waiting for snapshot');

  return normalizeResponse(platform, url, data);
}

function normalizeResponse(platform, url, rawData) {
  const record = Array.isArray(rawData) ? rawData[0] : rawData;
  if (!record) return { platform, profile: {}, posts: [], comments: [], source_meta: { provider: 'brightdata' } };

  return {
    platform,
    profile: {
      name:        record.name || record.full_name || record.username || '',
      username:    record.username || record.screen_name || '',
      bio:         record.biography || record.description || record.about || record.summary || '',
      headline:    record.headline || record.job_title || record.title || '',
      location:    record.location || record.city || '',
      followers:   record.followers_count || record.followers || 0,
      url,
    },
    posts: (record.posts || record.recent_posts || record.tweets || []).slice(0, 15).map(p => ({
      text:  p.text || p.caption || p.content || p.description || '',
      likes: p.likes_count || p.like_count || p.likes || 0,
      date:  p.date || p.timestamp || p.created_at || '',
    })),
    comments: (record.comments || []).slice(0, 10).map(c => ({
      text: c.text || c.content || '',
    })),
    source_meta: { provider: 'brightdata', snapshot_id: record._snapshot_id },
  };
}

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.brightdata.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type':  'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        // Guard: check HTTP status and Content-Type BEFORE JSON.parse.
        // Non-2xx or non-JSON responses produce "Unexpected token" otherwise.
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const preview = data.slice(0, 120).replace(/\n/g, ' ');
          return reject(new Error(`Bright Data HTTP ${res.statusCode}: ${preview}`));
        }
        const ct = res.headers['content-type'] || '';
        if (!ct.includes('application/json') && !ct.includes('text/json')) {
          const preview = data.slice(0, 120).replace(/\n/g, ' ');
          return reject(new Error(`Bright Data non-JSON response (${ct}): ${preview}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Bright Data JSON parse error: ${e.message} — body: ${data.slice(0,80)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT, () => { req.destroy(); reject(new Error('Bright Data request timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { collectProfileByUrl, isConfigured };
