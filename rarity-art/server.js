const express = require('express');
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');

const app = express();
const PORT = 3005;
const BASE_DIR = '/Users/openclawjg/.openclaw/workspace/rarity-art';

// Load data
function loadData() {
  // Load Artlogic records
  let artlogic = [];
  try {
    artlogic = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'artworks.json'), 'utf8'));
  } catch (e) { console.error('artworks.json load error:', e.message); }

  // Load custom image overrides
  let customImages = {};
  try {
    customImages = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'custom-images.json'), 'utf8'));
  } catch (e) {}

  // Load personal Excel
  let current = [], sold = [];
  try {
    const wb = XLSX.readFile(path.join(BASE_DIR, 'Rarity Advisors - Master Art Collection.xlsx'));
    
    const parseSheet = (sheetName) => {
      const ws = wb.Sheets[sheetName];
      if (!ws) return [];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      return rows;
    };

    current = parseSheet('Current Inventory');
    sold = parseSheet('Sold Inventory');
  } catch (e) { console.error('Excel load error:', e.message); }

  return { artlogic, current, sold, customImages };
}

let cache = null;
let cacheTime = 0;

function getData() {
  const now = Date.now();
  if (!cache || now - cacheTime > 60000) {
    cache = loadData();
    cacheTime = now;
  }
  return cache;
}

// Password protection middleware
const SITE_PASSWORD = 'rarity';

app.use((req, res, next) => {
  // Allow API calls without auth check (optional — remove if you want API locked too)
  const auth = req.headers['authorization'];
  if (auth) {
    const b64 = auth.split(' ')[1] || '';
    const [user, pass] = Buffer.from(b64, 'base64').toString().split(':');
    if (pass === SITE_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Rarity Advisors"');
  res.status(401).send('Authentication required');
});

// API endpoints
app.get('/api/summary', (req, res) => {
  const { current, sold } = getData();
  
  // Current holdings stats (personal sheet only)
  const totalHoldings = current.length;
  const artistCount = new Set(current.map(r => r['Artist']).filter(Boolean)).size;
  
  // Purchase totals — current holdings
  const totalInvested = current.reduce((sum, r) => {
    return sum + (parseFloat(r['Purchase Amnt']) || 0) + (parseFloat(r['Fees']) || 0);
  }, 0);
  const avgPurchase = totalHoldings > 0 ? totalInvested / totalHoldings : 0;

  // Most expensive current holding
  let topHolding = null;
  let topValue = 0;
  current.forEach(r => {
    const v = (parseFloat(r['Purchase Amnt']) || 0) + (parseFloat(r['Fees']) || 0);
    if (v > topValue) { topValue = v; topHolding = { artist: r['Artist'], title: r['Title'], value: v }; }
  });

  // Sold stats
  const soldCount = sold.length;
  const totalSoldRevenue = sold.reduce((sum, r) => sum + (parseFloat(r['Sold Amt. & Fees']) || 0), 0);
  const totalSoldCost = sold.reduce((sum, r) => sum + (parseFloat(r['Purchase Amnt']) || 0) + (parseFloat(r['Fees']) || 0), 0);
  const netProfit = totalSoldRevenue - totalSoldCost;

  // Top artists by current holdings count
  const artistCounts = {};
  current.forEach(r => {
    if (r['Artist']) artistCounts[r['Artist']] = (artistCounts[r['Artist']] || 0) + 1;
  });
  const topArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Top artists by value
  const artistValue = {};
  current.forEach(r => {
    if (r['Artist']) {
      const v = (parseFloat(r['Purchase Amnt']) || 0) + (parseFloat(r['Fees']) || 0);
      artistValue[r['Artist']] = (artistValue[r['Artist']] || 0) + v;
    }
  });
  const topByValue = Object.entries(artistValue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, value]) => ({ name, value: Math.round(value) }));

  res.json({
    totalHoldings,
    artistCount,
    totalInvested: Math.round(totalInvested),
    avgPurchase: Math.round(avgPurchase),
    soldCount,
    totalSoldRevenue: Math.round(totalSoldRevenue),
    netProfit: Math.round(netProfit),
    topHolding,
    topArtists,
    topByValue,
  });
});

app.get('/api/artworks', (req, res) => {
  const { artlogic, current, sold, customImages } = getData();
  const { q, artist, status, sort = 'artist', order = 'asc', limit = 100, offset = 0 } = req.query;

  const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  // Build purchase lookup from Current Inventory only
  const purchaseLookup = {};
  const artistPurchaseLookup = {};
  current.forEach(r => {
    const price = parseFloat(r['Purchase Amnt']) || 0;
    const fees = parseFloat(r['Fees']) || 0;
    const a = normalize(r['Artist']);
    const fullTitle = normalize(r['Title'] || '');
    const shortTitle = normalize((r['Title'] || '').split(',')[0]);
    const entry = { price, fees, total: price + fees, date: r['Purchase Date'],
      purchased_from: r['Purchased From'], list_price: r['List Price'],
      materials: r['Materials'] || r['Art Type'], dimensions: r['Dimensions'] };
    purchaseLookup[a + '|' + fullTitle] = entry;
    if (shortTitle !== fullTitle) purchaseLookup[a + '|' + shortTitle] = entry;
    if (!artistPurchaseLookup[a]) artistPurchaseLookup[a] = [];
    artistPurchaseLookup[a].push({ ...entry, title: fullTitle });
  });

  // Build set of artists/titles in current sheet for filtering
  const currentSet = new Set(current.map(r => normalize(r['Artist']) + '|' + normalize((r['Title'] || '').split(',')[0])));
  const currentArtists = new Set(current.map(r => normalize(r['Artist'])));

  // Build artlogic lookup for enrichment
  const artlogicByKey = {};
  artlogic.forEach(a => {
    const na = normalize(a.artist);
    const nt = normalize(a.title);
    artlogicByKey[na + '|' + nt] = a;
    // Also index by artist for fuzzy match
    if (!artlogicByKey[na]) artlogicByKey[na] = [];
    if (Array.isArray(artlogicByKey[na])) artlogicByKey[na].push(a);
  });

  // Start from the personal sheet (source of truth) — all 94 rows
  let results = current.map(r => {
    const rArtist = normalize(r['Artist']);
    const rTitleFull = normalize(r['Title'] || '');
    const rTitleShort = normalize((r['Title'] || '').split(',')[0]);

    // Find matching artlogic record for enrichment (image, stock#, etc.)
    let al = artlogicByKey[rArtist + '|' + rTitleFull] ||
             artlogicByKey[rArtist + '|' + rTitleShort] || null;
    if (!al && Array.isArray(artlogicByKey[rArtist])) {
      const candidates = artlogicByKey[rArtist];
      al = candidates.find(a => {
        const nt = normalize(a.title);
        return nt.startsWith(rTitleShort.split(' ').slice(0,3).join(' ')) ||
               rTitleShort.startsWith(nt.split(' ').slice(0,3).join(' '));
      }) || null;
    }

    const price = parseFloat(r['Purchase Amnt']) || 0;
    const fees = parseFloat(r['Fees']) || 0;

    return {
      // Personal sheet fields (source of truth)
      id: al?.id || null,
      artist: r['Artist'] || '',
      title: r['Title'] || '',
      year: al?.year || '',
      medium: r['Materials'] || r['Art Type'] || al?.medium || '',
      dimensions: r['Dimensions'] || al?.dimensions || '',
      status: al?.status || (r['Status'] || 'Stock'),
      availability: al?.availability || '',
      location: r['Purchased From'] || al?.location || '',
      stock_number: al?.stock_number || '',
      provenance: al?.provenance || '',
      // Images: check custom override first (try full title and first-line-only), then artlogic match
      // Custom image lookup: try full title, first line, first 2 words of title
      // eslint-disable-next-line no-shadow
      ...((() => {
        const titleRaw = r['Title'] || '';
        const firstLine = titleRaw.split('\n')[0].trim();
        const twoWords = firstLine.split(/\s+/).slice(0,2).join(' ');
        const a = r['Artist'];
        const ci = customImages;
        // Custom images may be array (multi) or single string
        const customRaw = ci[`${a}|${titleRaw}`] || ci[`${a}|${firstLine}`] || ci[`${a}|${twoWords}`] || null;
        const customArr = customRaw ? (Array.isArray(customRaw) ? customRaw : [customRaw]) : null;
        const primary = customArr ? customArr[0] : (al?.img_small || null);
        const primaryM = customArr ? customArr[0] : (al?.img_medium || null);
        const primaryL = customArr ? customArr[0] : (al?.img_large || null);
        const allImages = customArr || (al?.img_small ? [al.img_small] : []);
        return { img_small: primary, img_medium: primaryM, img_large: primaryL, has_image: !!(primary), images: allImages };
      })()),
      // Purchase data
      _purchase_price: price || null,
      _purchase_fees: fees || null,
      _purchase_total: (price + fees) || null,
      _purchased_from: r['Purchased From'] || null,
      _list_price: r['List Price'] || null,
      _artsy_link: r['Artsy Link'] || null,
      _matched_artlogic: !!al,
    };
  });

  // Filter
  if (q) {
    const lq = q.toLowerCase();
    results = results.filter(a => 
      [a.artist, a.title, a.medium, a.year, a.stock_number].join(' ').toLowerCase().includes(lq)
    );
  }
  if (artist) results = results.filter(a => a.artist === artist);
  if (status) results = results.filter(a => a.status === status);

  // Sort
  results.sort((a, b) => {
    let va, vb;
    if (sort === 'purchase_price') {
      va = a._purchase_total || 0;
      vb = b._purchase_total || 0;
      return order === 'desc' ? vb - va : va - vb;
    } else if (sort === 'retail_price') {
      va = parseFloat(a.retail_price) || 0;
      vb = parseFloat(b.retail_price) || 0;
      return order === 'desc' ? vb - va : va - vb;
    } else if (sort === 'year') {
      va = a.year || ''; vb = b.year || '';
      return order === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
    } else if (sort === 'title') {
      va = a.title || ''; vb = b.title || '';
      return order === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
    } else {
      va = a.artist || ''; vb = b.artist || '';
      return order === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
    }
  });

  const total = results.length;
  const page = results.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  
  res.json({ total, results: page });
});

app.get('/api/artists', (req, res) => {
  const { artlogic } = getData();
  const artists = [...new Set(artlogic.map(a => a.artist).filter(Boolean))].sort();
  res.json(artists);
});

app.get('/api/statuses', (req, res) => {
  const { artlogic } = getData();
  const statuses = [...new Set(artlogic.map(a => a.status).filter(Boolean))].sort();
  res.json(statuses);
});

// Serve static files (images, etc.) before HTML fallback
const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'application/javascript' };
app.use((req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  if (mime[ext]) {
    const filePath = path.join(BASE_DIR, 'public', req.path);
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', mime[ext]);
      return res.end(fs.readFileSync(filePath));
    }
  }
  next();
});

// Serve frontend HTML for all other routes
const HTML = fs.readFileSync(path.join(BASE_DIR, 'public', 'index.html'), 'utf8');
app.use((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(HTML);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎨 Rarity Art running on http://0.0.0.0:${PORT}`);
  console.log(`   Access from any device on your network`);
});
