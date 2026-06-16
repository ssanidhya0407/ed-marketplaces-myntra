// Pushes normalized Myntra orders + returns to dashboardweb's authenticated
// ingest endpoint (/api/myntra/ingest). The OMS is the only system authorized to
// talk to Myntra (it holds the creds and is the registered webhook domain), so it
// is the single integration boundary: it pulls live from Myntra and pushes a
// clean, normalized copy to dashboardweb, which stores it next to Amazon/Flipkart/
// Meesho. Mirrors the normalization used by the Sales Report.

const env = require('../config/env');
const myntraClient = require('./myntraClient');
const db = require('../db/mockDb');

// Best-effort SKU→image map (same static catalog the dashboard UI uses). Optional:
// if it can't be loaded, images are simply omitted from the push.
let SKU_IMAGES = {};
try { SKU_IMAGES = require('../../oms-dashboard/src/data/skuImages.json'); } catch (_e) { SKU_IMAGES = {}; }
const normSku = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const IMG_INDEX = {};
for (const [k, v] of Object.entries(SKU_IMAGES)) { const n = normSku(k); if (!(n in IMG_INDEX)) IMG_INDEX[n] = v; }
const skuImage = (sku) => SKU_IMAGES[sku] || IMG_INDEX[normSku(sku)] || null;

// Myntra dates are "dd-MM-yyyy HH:mm:ss"; return YYYY-MM-DD (or null).
function toIsoDay(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
const pickDay = (line, det) => toIsoDay(
  (line && (line.shipByTime || line.invoiceDate || line.packedOn || line.packByTime || line.customerPromiseTime))
  || (det && det.expectedDeliveryTime),
);

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i; i += 1; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// Pull every order summary, then its live detail, and normalize into the ingest
// payload shape. Also returns detailBySid so returns can be resolved to SKUs.
async function collectOrders() {
  const first = (await myntraClient.fetchOrderList({ page: 0 })).body || {};
  let items = Array.isArray(first.data) ? first.data : [];
  const pages = first.pages || 1;
  for (let p = 1; p < pages; p += 1) {
    const r = await myntraClient.fetchOrderList({ page: p });
    if (r.body && Array.isArray(r.body.data)) items = items.concat(r.body.data);
  }
  const byId = new Map();
  for (const it of items) {
    const sid = (it.orderLines || []).map((l) => l.sellerOrderId).find(Boolean);
    if (sid && !byId.has(sid)) byId.set(sid, { status: String((it.orderLines[0] && it.orderLines[0].status) || '').toUpperCase() });
  }
  const sids = [...byId.keys()];

  const details = await mapLimit(sids, 8, async (sid) => {
    try { return { sid, body: (await myntraClient.fetchOrderById(sid)).body || {} }; }
    catch { return { sid, body: null }; }
  });

  const orders = [];
  const detailBySid = new Map();
  for (const { sid, body } of details) {
    const det = body || {};
    const entries = Array.isArray(det.orderLineEntries) ? det.orderLineEntries : [];
    const meta = byId.get(sid) || {};
    const status = meta.status || (entries[0] && entries[0].status_code) || '';
    const payment = ['on', 'prepaid'].includes(String(det.paymentMethod || '').toLowerCase())
      ? 'Prepaid' : (det.paymentMethod ? 'COD' : 'Unknown');
    const lines = entries.map((l) => {
      const qty = Number(l.quantity) > 0 ? Number(l.quantity) : 1;
      const sku = l.sku ? String(l.sku) : null;
      const tax = (Array.isArray(l.taxEntries) ? l.taxEntries.reduce((t, e) => t + (Number(e.unitTaxAmount) || 0), 0) : 0) * qty;
      return {
        orderLineId: String(l.orderLineId || ''),
        sku,
        productName: sku,
        quantity: qty,
        mrp: Number(l.mrp) || null,
        customerPrice: Number(l.lineFinalAmount) || Number(l.mrp) || null,
        sellerSettlement: Number(l.lineSellerFinalAmount) || null,
        tax,
        status: l.status_code || null,
        cancelled: String(l.status_code || '').toUpperCase() === 'IC' || !!l.cancelledOn,
        packetId: l.packetId || null,
        invoiceNumber: l.invoiceNumber || null,
        imageUrl: sku ? skuImage(sku) : null,
      };
    });
    const order = {
      sellerOrderId: sid,
      orderDate: pickDay(entries[0], det),
      state: det.stateName || det.state || null,
      city: det.city || null,
      paymentMethod: payment,
      status,
      lines,
    };
    orders.push(order);
    detailBySid.set(sid, order);
  }
  return { orders, detailBySid };
}

function collectReturns(detailBySid) {
  const out = [];
  for (const r of db.returns.values()) {
    const ord = r.sellerOrderId ? detailBySid.get(r.sellerOrderId) : null;
    const line = ord
      ? (ord.lines.find((x) => x.orderLineId && String(x.orderLineId) === String(r.orderLineId)) || ord.lines[0])
      : null;
    out.push({
      id: r.id,
      sellerOrderId: r.sellerOrderId || null,
      orderLineId: r.orderLineId || null,
      sku: line ? line.sku : null,
      value: line ? line.customerPrice : null,
      type: r.type || null,
      reason: r.reason || null,
      status: r.status || null,
      createdOn: toIsoDay(r.createdOn) || r.createdOn || null,
    });
  }
  return out;
}

// Collect + POST to dashboardweb. Returns a summary (never throws on a non-2xx;
// surfaces the status so the caller can report it).
async function pushToDashboard(opts = {}) {
  const baseUrl = (opts.baseUrl || env.dashboardIngestUrl || '').replace(/\/+$/, '');
  const key = opts.key || env.dashboardIngestKey || '';
  if (!baseUrl) throw new Error('DASHBOARDWEB_INGEST_URL is not configured');
  if (!key) throw new Error('DASHBOARDWEB_INGEST_KEY is not configured');

  const { orders, detailBySid } = await collectOrders();
  const returns = collectReturns(detailBySid);
  const payload = { source: 'oms-push', orders, returns };

  const url = `${baseUrl}/api/myntra/ingest`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return {
    ok: res.ok && body.ok !== false,
    httpStatus: res.status,
    target: url,
    sent: { orders: orders.length, lines: orders.reduce((a, o) => a + o.lines.length, 0), returns: returns.length },
    response: body,
  };
}

module.exports = { pushToDashboard, collectOrders, collectReturns };
