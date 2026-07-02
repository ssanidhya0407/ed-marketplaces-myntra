#!/usr/bin/env node
/**
 * Refresh data/marketplace_skus.json — the SKU universe the Inventory page probes
 * against Myntra's Search Inventory API.
 *
 * Pulls the CURRENT catalog live from Amazon (All Listings Report) and Flipkart
 * (Listing Search), unions them, and rewrites the JSON. Run this locally whenever you
 * add SKUs on Amazon/Flipkart, then redeploy the file to the Myntra server (which has
 * no marketplace credentials of its own).
 *
 *   node scripts/refresh-marketplace-skus.js
 *
 * Credentials are read from ../dashboardweb/.env.local by default
 * (override the path with MARKETPLACE_ENV=/path/to/.env, or export the vars yourself).
 *
 * NOTE: newly-*ordered* Myntra SKUs already auto-merge at runtime (from the local order
 * store) — this script only refreshes the Amazon∪Flipkart base catalog.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function loadEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('='); if (i < 0) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[t.slice(0, i).trim()] = v;
    }
  } catch { /* file may not exist; rely on process.env */ }
  return out;
}

const ENV_FILE = process.env.MARKETPLACE_ENV || path.join(__dirname, '..', '..', 'dashboardweb', '.env.local');
const E = { ...loadEnv(ENV_FILE), ...process.env };
const OUT = path.join(__dirname, '..', 'data', 'marketplace_skus.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── Amazon: All Listings Report ─────────────────────────
async function pullAmazon() {
  const { LWA_CLIENT_ID, LWA_CLIENT_SECRET, LWA_REFRESH_TOKEN, SP_API_ENDPOINT, MARKETPLACE_ID } = E;
  if (!LWA_CLIENT_ID || !LWA_REFRESH_TOKEN || !SP_API_ENDPOINT || !MARKETPLACE_ID) {
    console.warn('  [amazon] credentials missing — skipping'); return [];
  }
  const tok = await (await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: LWA_REFRESH_TOKEN, client_id: LWA_CLIENT_ID, client_secret: LWA_CLIENT_SECRET }),
  })).json();
  if (!tok.access_token) throw new Error('LWA token exchange failed');
  const H = { 'x-amz-access-token': tok.access_token, 'Content-Type': 'application/json' };

  const create = await (await fetch(`${SP_API_ENDPOINT}/reports/2021-06-30/reports`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA', marketplaceIds: [MARKETPLACE_ID] }),
  })).json();
  if (!create.reportId) throw new Error('report create failed: ' + JSON.stringify(create).slice(0, 200));

  let docId = null;
  for (let i = 0; i < 30; i++) {
    await sleep(6000);
    const st = await (await fetch(`${SP_API_ENDPOINT}/reports/2021-06-30/reports/${create.reportId}`, { headers: H })).json();
    process.stdout.write(`  [amazon] report ${st.processingStatus}...   \r`);
    if (st.processingStatus === 'DONE') { docId = st.reportDocumentId; break; }
    if (st.processingStatus === 'FATAL' || st.processingStatus === 'CANCELLED') throw new Error('report ' + st.processingStatus);
  }
  if (!docId) throw new Error('report did not finish in time');

  const doc = await (await fetch(`${SP_API_ENDPOINT}/reports/2021-06-30/documents/${docId}`, { headers: H })).json();
  const buf = Buffer.from(await (await fetch(doc.url)).arrayBuffer());
  let text;
  try { text = zlib.gunzipSync(buf).toString('utf8'); } catch { text = buf.toString('utf8'); }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const sIdx = header.indexOf('seller-sku');
  if (sIdx < 0) throw new Error('seller-sku column not found in report');
  const skus = lines.slice(1).map((l) => (l.split('\t')[sIdx] || '').trim()).filter(Boolean);
  return [...new Set(skus)];
}

// ───────────────────────── Flipkart: Listing Search ─────────────────────────
async function pullFlipkart() {
  const { FLIPKART_CLIENT_ID, FLIPKART_CLIENT_SECRET, FLIPKART_API_BASE_URL } = E;
  if (!FLIPKART_CLIENT_ID || !FLIPKART_CLIENT_SECRET) { console.warn('  [flipkart] credentials missing — skipping'); return []; }
  const sellersBase = (FLIPKART_API_BASE_URL || 'https://seller.api.flipkart.net/sellers').replace(/\/$/, '');
  const root = sellersBase.replace(/\/sellers$/, '');

  const basic = Buffer.from(`${FLIPKART_CLIENT_ID}:${FLIPKART_CLIENT_SECRET}`).toString('base64');
  const tok = await (await fetch(`${root}/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api`, {
    method: 'GET', headers: { Authorization: `Basic ${basic}` },
  })).json();
  if (!tok.access_token) throw new Error('Flipkart token exchange failed');
  const H = { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' };

  const skus = new Set();
  let pageId = null, pages = 0;
  do {
    const res = await fetch(`${sellersBase}/listings/v3/search`, {
      method: 'POST', headers: H, body: JSON.stringify({ filters: {}, page_id: pageId }),
    });
    if (!res.ok) throw new Error(`listing search ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const l of data.listings || []) if (l.sku_id) skus.add(String(l.sku_id).trim());
    pageId = data.has_more ? data.next_page_id : null;
    pages++;
    process.stdout.write(`  [flipkart] ${skus.size} SKUs (${pages} page${pages > 1 ? 's' : ''})...   \r`);
  } while (pageId && pages < 200);
  return [...skus];
}

(async () => {
  console.log('Refreshing marketplace SKU list…');
  console.log('  credentials:', fs.existsSync(ENV_FILE) ? ENV_FILE : '(env vars / none)');

  let amazon = [], flipkart = [], amazonOk = false, flipkartOk = false;
  try { amazon = await pullAmazon(); amazonOk = true; console.log(`\n  [amazon]   ${amazon.length} SKUs`); }
  catch (e) { console.error('\n  [amazon]   FAILED —', e.message); }
  try { flipkart = await pullFlipkart(); flipkartOk = true; console.log(`\n  [flipkart] ${flipkart.length} SKUs`); }
  catch (e) { console.error('\n  [flipkart] FAILED —', e.message); }

  if (!amazonOk && !flipkartOk) { console.error('Both pulls failed — leaving the existing file untouched.'); process.exit(1); }

  const map = new Map();
  const add = (arr, src) => { for (const s of arr) { const e = map.get(s) || { sku: s, sources: [] }; if (!e.sources.includes(src)) e.sources.push(src); map.set(s, e); } };
  add(amazon, 'amazon'); add(flipkart, 'flipkart');

  // Never shrink the file because ONE source had a transient failure: keep the previous
  // entries for whichever source didn't come back this run.
  if (!amazonOk || !flipkartOk) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).skus || [];
      for (const p of prev) {
        const keep = (!amazonOk && (p.sources || []).includes('amazon')) || (!flipkartOk && (p.sources || []).includes('flipkart'));
        if (keep && !map.has(p.sku)) map.set(p.sku, p);
      }
      console.log('  (preserved prior SKUs for the failed source)');
    } catch { /* first run — nothing to preserve */ }
  }

  const list = [...map.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  fs.writeFileSync(OUT, JSON.stringify({ count: list.length, skus: list }));
  console.log(`\nWrote ${list.length} SKUs → data/marketplace_skus.json`);
  console.log(`  amazon ${amazon.length} · flipkart ${flipkart.length} · on both ${list.filter((x) => (x.sources || []).length > 1).length}`);
  console.log('\nNext: redeploy data/marketplace_skus.json to the Myntra server, then Refresh the Inventory page.');
})();
