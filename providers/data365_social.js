'use strict';
/**
 * Data365 Social API adapter.
 * Docs: https://data365.co
 *
 * ⚠️  NOT AN APPROVED PROVIDER.
 * Data365 has not been approved for use in Spokesbox. isConfigured() always
 * returns false so this adapter is never selected by the provider chain.
 * This file is retained to preserve the interface contract should Data365
 * be approved and integrated in the future.
 *
 * To enable: (1) obtain approval, (2) add 'data365' to APPROVED_PROVIDERS
 * in job_social_enrich.js, (3) update isConfigured() to check DATA365_API_KEY,
 * (4) test end-to-end.
 */

const https = require('https');

const API_KEY  = process.env.DATA365_API_KEY || '';
const BASE_URL = 'https://api.data365.co/v1.1';
const TIMEOUT  = parseInt(process.env.SOCIAL_ENRICHMENT_TIMEOUT_MS || '12000', 10);

// Platform → Data365 endpoint prefix
const ENDPOINTS = {
  instagram: '/instagram/profile/update',
  twitter:   '/twitter/profile/update',
  facebook:  '/facebook/profile/update',
  linkedin:  '/linkedin/profile/update',
  reddit:    '/reddit/user/update',
};

function isConfigured() {
  // Intentionally always false — Data365 is not an approved provider.
  // See header comment for how to enable if approved in future.
  return false;
}

async function collectProfileByUrl({ platform, url }) {
  if (!isConfigured()) throw new Error('Data365 API key not configured');

  const endpoint = ENDPOINTS[platform];
  if (!endpoint) throw new Error(`No Data365 endpoint for platform: ${platform}`);

  // Data365 uses a username/handle, extract from URL
  const handle = extractHandle(platform, url);
  if (!handle) throw new Error(`Could not extract handle for ${platform} from URL: ${url}`);

  // Step 1: request update (trigger collection)
  await apiRequest('POST', `${endpoint}?identifier=${encodeURIComponent(handle)}&max_posts=15`);

  // Step 2: poll for profile data
  const profileEndpoint = endpoint.replace('/update', '');
  const deadline = Date.now() + TIMEOUT;
  let data = null;
  while (Date.now() < deadline) {
    await sleep(2500);
    try {
      const resp = await apiRequest('GET', `${profileEndpoint}?identifier=${encodeURIComponent(handle)}&max_posts=15`);
      if (resp && resp.data) { data = resp.data; break; }
    } catch (_) { /* keep polling */ }
  }

  if (!data) throw new Error('Data365 timeout or empty response');
  return normalizeResponse(platform, url, data);
}

function normalizeResponse(platform, url, data) {
  return {
    platform,
    profile: {
      name:      data.full_name || data.name || data.username || '',
      username:  data.username || data.screen_name || '',
      bio:       data.biography || data.description || data.summary || '',
      headline:  data.headline || data.title || '',
      location:  data.location || '',
      followers: data.follower_count || data.followers_count || 0,
      url,
    },
    posts: (data.posts || data.timeline || data.tweets || []).slice(0, 15).map(p => ({
      text:  p.text || p.caption || p.description || '',
      likes: p.like_count || p.likes_count || 0,
      date:  p.taken_at || p.created_at || p.date || '',
    })),
    comments: [],
    source_meta: { provider: 'data365' },
  };
}

function extractHandle(platform, url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (platform === 'reddit') return parts.find(p => p.startsWith('u/'))?.slice(2) || parts[1] || parts[0];
    return parts[parts.length - 1] || parts[0];
  } catch (_) { return url; }
}

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
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
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Data365 parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT, () => { req.destroy(); reject(new Error('Data365 timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { collectProfileByUrl, isConfigured };
