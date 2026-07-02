const express = require('express');
const path = require('path');
const fs = require('fs');

const env = require('../config/env');
const myntraClient = require('../services/myntraClient');
const db = require('../db/mockDb');
const { buildPdf } = require('../utils/miniPdf');
const auth = require('../middleware/dashboardAuth');

const router = express.Router();

// Internal order status -> Myntra order-list status code.
const INTERNAL_TO_CODE = {
  CREATED: 'RFR', ACCEPTED: 'WP', ON_HOLD: 'WP', READY_TO_DISPATCH: 'PK',
  SHIPPED: 'SH', LOST: 'SH', DELIVERED: 'DL', CANCELLED: 'IC', REJECTED: 'IC',
};
const isPush = (o) => o && o.source === 'push';
const lines = (o) => Array.from(o.lineMap.values());

// The Inbox stores the status from the last webhook Myntra pushed, which goes stale
// the moment we move an order forward (RTD/RTS) via the live API — Myntra doesn't
// always push a follow-up Update Order webhook. So we reconcile inbox rows against
// the authoritative live order list: sellerOrderId -> current summary status code.
async function liveStatusMap() {
  const map = new Map();
  const collect = (body) => {
    for (const o of (Array.isArray(body && body.data) ? body.data : [])) {
      for (const l of (o.orderLines || [])) {
        if (l.sellerOrderId) map.set(String(l.sellerOrderId), String(l.status || '').toUpperCase());
      }
    }
  };
  const first = (await myntraClient.fetchOrderList({ page: 0 })).body || {};
  collect(first);
  const pages = first.pages || 1;
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) => myntraClient.fetchOrderList({ page: i + 1 })),
    );
    rest.forEach((r) => collect(r.body || {}));
  }
  return map;
}

// Authoritative in-progress signal: the sellerOrderIds Myntra returns under the RFR (new)
// and WP (work-in-progress) status FILTERS — the same source the KPIs count. We trust this
// over the unfiltered list's summary status, which can go stale: an order that has since
// gone RTO/cancelled can still read 'WP' in the unfiltered list (Myntra doesn't re-stamp the
// summary), which used to keep dead orders stuck in the Inbox. Returns sellerOrderId -> code.
async function inProgressStatusMap() {
  const map = new Map();
  for (const code of ['RFR', 'WP']) {
    let page = 0;
    let pages = 1;
    do {
      const body = (await myntraClient.fetchOrderList({ page, statusCode: code })).body || {};
      for (const o of (Array.isArray(body.data) ? body.data : [])) {
        for (const l of (o.orderLines || [])) {
          if (l.sellerOrderId) map.set(String(l.sellerOrderId), code);
        }
      }
      pages = body.pages || 1;
      page += 1;
    } while (page < pages);
  }
  return map;
}

// Reconcile an order's status against the authoritative live order list.
// getOrderList returns completed/closed orders with a BLANK summary status, so a
// blank-but-PRESENT order means "completed" (code 'C') — NOT "no signal". Only
// when the order is entirely absent from the live list do we fall back to the
// cached webhook status. (Treating blank as no-signal kept finished orders stuck
// in the Inbox with their stale 'WP' webhook status.)
const reconciled = (o, live, cached) => {
  const sid = String(o.sellerOrderId);
  if (live && live.has(sid)) return live.get(sid) || 'C';
  return cached;
};

// Resolve which pushed orders are still actionable (RFR / WP) — authoritatively, so the
// Inbox matches the In-Progress KPI. Three cases, cheapest first:
//   1. in Myntra's RFR/WP FILTERED lists      -> keep (no detail call)
//   2. present in the unfiltered list, not 1  -> moved on (PK/SH/DL/IC/blank) -> drop
//   3. absent from the list entirely          -> ambiguous. Myntra drops terminal orders
//      (e.g. RTO) from the list, and doesn't always push a follow-up webhook, so the cached
//      webhook status can be a stale 'WP'. Only here do we spend an order-detail call to read
//      the true status, and keep it only if it's genuinely still RFR/WP.
// Returns [{ o, code }] for the kept orders. The verify set is tiny (only stale absentees).
const IN_PROGRESS = new Set(['RFR', 'WP']);
async function resolveInbox() {
  const [live, inProg] = await Promise.all([liveStatusMap(), inProgressStatusMap()]);
  const kept = [];
  const verify = [];
  for (const o of db.orders.values()) {
    if (!isPush(o) || lines(o).some((l) => l.cancelled)) continue;
    const sid = String(o.sellerOrderId);
    if (inProg.has(sid)) { kept.push({ o, code: inProg.get(sid) }); continue; }
    if (live.has(sid)) continue; // present but past RFR/WP
    if (IN_PROGRESS.has(String(INTERNAL_TO_CODE[o.status] || o.status || '').toUpperCase())) verify.push(o);
  }
  if (verify.length) {
    await mapLimit(verify, 6, async (o) => {
      try {
        const det = (await myntraClient.fetchOrderById(o.sellerOrderId)).body || {};
        const code = String((det.orderLineEntries || [])[0]?.status_code || '').toUpperCase();
        if (IN_PROGRESS.has(code)) kept.push({ o, code });
      } catch { /* on error, leave it out — safer than showing a stale order */ }
    });
  }
  return kept;
}

function inboxSummary(o, live) {
  return {
    orderId: o.sellerOrderId,
    orderLines: lines(o).map((l) => ({
      orderLineId: String(l.orderLineId),
      sellerOrderId: o.sellerOrderId,
      status: l.cancelled ? 'IC' : reconciled(o, live, INTERNAL_TO_CODE[o.status] || o.status),
    })),
  };
}
function inboxDetail(o, live) {
  const code = reconciled(o, live, INTERNAL_TO_CODE[o.status] || o.status);
  const r = o.receiver || {};
  return {
    statusCode: 1005, statusMessage: 'Order retrieved successfully', statusType: 'SUCCESS',
    sellerOrderId: o.sellerOrderId,
    receiverName: r.receiverName, address: r.address, locality: r.locality, city: r.city,
    state: r.state, stateName: r.stateName, zipcode: r.zipcode, country: r.country,
    mobile: r.mobile, email: r.email, paymentMethod: o.paymentMethod, warehouse: o.warehouse,
    trackingNumber: o.trackingNumber || null,
    orderLineEntries: lines(o).map((l) => ({
      orderLineId: String(l.orderLineId), sku: l.sku, warehouse: l.warehouse || o.warehouse,
      mrp: l.mrp, lineFinalAmount: l.lineFinalAmount,
      status_code: l.cancelled ? 'IC' : code,
      packetId: ['PK', 'SH', 'DL'].includes(code) ? o.packetId : (l.packetId || null),
      invoiceNumber: l.invoiceNumber || null, invoiceDate: l.invoiceDate || null,
      trackingNumber: o.trackingNumber || null, taxEntries: l.taxEntries || [],
      shipByTime: l.shipByTime, packByTime: l.packByTime, customerPromiseTime: l.customerPromiseTime,
      cancellationReason: l.cancellationReason || null,
      cancellationCode: l.cancellationCode ?? null, cancelledOn: l.cancelledOn || null,
    })),
  };
}

// Gate for every dashboard data route. A valid signed session cookie (set by the
// /orders/api/auth/login flow below) is the primary credential. The legacy
// DASHBOARD_KEY query param still works as a fallback. If neither sign-in nor a
// key is configured on the server, the dashboard stays open (original behaviour).
function dashboardGate(req, res, next) {
  if (auth.getSession(req)) return next();
  if (env.dashboardKey && req.query.key === env.dashboardKey) return next();
  if (!auth.authConfigured() && !env.dashboardKey) return next();
  return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
}

// ── Auth: single shared email/password login (no gate — these issue the session) ──
router.post('/orders/api/auth/login', (req, res) => {
  if (!auth.authConfigured()) {
    return res.status(503).json({ ok: false, error: 'Login is not configured on the server.' });
  }
  const { email, password } = req.body || {};
  const emailOk = String(email || '').trim().toLowerCase() === env.authEmail.toLowerCase();
  const passOk = auth.verifyPassword(password, env.authPasswordHash);
  if (!emailOk || !passOk) {
    return res.status(401).json({ ok: false, error: 'Invalid email or password.' });
  }
  auth.setSessionCookie(res, auth.signSession(env.authEmail));
  return res.json({ ok: true, email: env.authEmail });
});

router.post('/orders/api/auth/logout', (_req, res) => {
  auth.clearSessionCookie(res);
  return res.json({ ok: true });
});

router.get('/orders/api/auth/me', (req, res) => {
  const session = auth.getSession(req);
  return res.json({
    ok: true,
    configured: auth.authConfigured(),
    authenticated: Boolean(session),
    email: session ? session.sub : null,
  });
});

// Human-friendly labels for Myntra order status codes.
const STATUS_LABELS = {
  RFR: 'New (Ready for Review)',
  WP: 'In Progress',
  PK: 'Packed',
  SH: 'Shipped',
  DL: 'Delivered',
  IC: 'Cancelled',
};

// Serve the warehouse dashboard page.
router.get('/orders', dashboardGate, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'orders.html'));
});

// JSON: live order list straight from Myntra (paginated, optional status filter).
router.get('/orders/api/list', dashboardGate, async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page, 10) || 0;
    const { statusCode, startDate, endDate } = req.query;
    const result = await myntraClient.fetchOrderList({ page, statusCode, startDate, endDate });
    const body = result.body || {};
    return res.status(result.status === 200 ? 200 : 502).json({
      ok: result.status === 200,
      page,
      totalCount: body.totalCount ?? null,
      pages: body.pages ?? null,
      statusMessage: body.statusMessage || body.message || null,
      orders: Array.isArray(body.data) ? body.data : [],
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// JSON: full detail for a single order (receiver, address, SKUs, amounts).
router.get('/orders/api/detail/:sellerOrderId', dashboardGate, async (req, res) => {
  try {
    const result = await myntraClient.fetchOrderById(req.params.sellerOrderId);
    return res.status(result.status === 200 ? 200 : 502).json({
      ok: result.status === 200,
      detail: result.body || {},
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Myntra returns documents as a multipart/related envelope wrapping the raw PDF.
// Pull the PDF bytes out: from the first "%PDF" to the final "%%EOF".
function extractPdf(buffer) {
  const start = buffer.indexOf('%PDF');
  if (start === -1) return null;
  const eof = buffer.lastIndexOf('%%EOF');
  const end = eof === -1 ? buffer.length : eof + 5;
  return buffer.subarray(start, end);
}

function streamDocument(res, kind, packetId, status, buffer) {
  const pdf = buffer && extractPdf(buffer);
  if (status !== 200 || !pdf) {
    const detail = buffer ? buffer.toString('utf8').slice(0, 500) : '';
    return res.status(status === 200 ? 502 : status).json({
      ok: false,
      error: detail || `Myntra returned HTTP ${status}`,
    });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${kind}_${packetId}.pdf"`);
  return res.send(pdf);
}

// PDF: stream a packet's shipping label straight from Myntra to the browser.
router.get('/orders/api/label/:packetId', dashboardGate, async (req, res) => {
  try {
    const { status, buffer } = await myntraClient.fetchShippingLabel(req.params.packetId);
    return streamDocument(res, 'label', req.params.packetId, status, buffer);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// PDF: stream a packet's invoice.
router.get('/orders/api/invoice/:packetId', dashboardGate, async (req, res) => {
  try {
    const { status, buffer } = await myntraClient.fetchInvoice(req.params.packetId);
    return streamDocument(res, 'invoice', req.params.packetId, status, buffer);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Invoice DETAILS (JSON, not the PDF). Myntra returns 2050 until the packet is RTD'd;
// we surface Myntra's real status/code so the UI can show "not dispatched yet".
router.get('/orders/api/invoice-details/:packetId', dashboardGate, async (req, res) => {
  try {
    const { status, body } = await myntraClient.fetchInvoiceDetails(req.params.packetId);
    return res.status(200).json({
      ok: status === 200 && body.statusType !== 'ERROR',
      httpStatus: status,
      statusCode: body.statusCode ?? null,
      message: body.statusMessage || body.message || null,
      details: body,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Status change: accept | reject | cancel | ready_to_ship | ready_to_dispatch.
// Mutates the live Myntra account — the UI confirms before calling this.
router.post('/orders/api/action/:sellerOrderId', dashboardGate, async (req, res) => {
  const sellerOrderId = req.params.sellerOrderId;
  const { action, orderLineIds, warehouse, comment, trackingNo, orderLineEntries } = req.body || {};
  try {
    let result;
    switch (String(action || '').toLowerCase()) {
      case 'accept':
        result = await myntraClient.updateOrderEvent(sellerOrderId, 'ACCEPT', { warehouse, orderLineIds });
        break;
      case 'reject':
        result = await myntraClient.updateOrderEvent(sellerOrderId, 'REJECT', { warehouse, orderLineIds });
        break;
      case 'cancel':
        result = await myntraClient.cancelOrderItems(sellerOrderId, { orderLineIds, comment });
        break;
      case 'ready_to_ship':
        result = await myntraClient.markReadyToShip(trackingNo);
        break;
      case 'ready_to_dispatch':
        result = await myntraClient.markReadyToDispatch({ warehouse, orderLineEntries });
        break;
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
    const body = result.body || {};
    // Always answer 200 to the dashboard with an explicit ok flag, and surface
    // Myntra's REAL http status + code + message (don't mask a 403 as a 502).
    return res.status(200).json({
      ok: result.status === 200 && body.statusType !== 'ERROR',
      httpStatus: result.status,
      statusCode: body.statusCode ?? null,
      message: body.statusMessage || body.message || null,
      raw: body,
    });
  } catch (error) {
    return res.status(error.statusCode && error.statusCode < 600 ? 400 : 500)
      .json({ ok: false, error: error.message });
  }
});

router.get('/orders/api/status-labels', (_req, res) => res.json(STATUS_LABELS));

// Dashboard overview stats. Uses getOrderList's totalCount per status (one light call
// each, no detail fetches) + local inbox/returns counts.
router.get('/orders/api/stats', dashboardGate, async (_req, res) => {
  try {
    const codes = ['RFR', 'WP', 'PK', 'SH', 'DL', 'IC'];
    const counts = await Promise.all(codes.map((c) =>
      myntraClient.fetchOrderList({ page: 0, statusCode: c })
        .then((r) => [c, (r.body && r.body.totalCount) ?? 0])
        .catch(() => [c, 0]),
    ));
    const byStatus = Object.fromEntries(counts);
    const total = await myntraClient.fetchOrderList({ page: 0 })
      .then((r) => (r.body && r.body.totalCount) ?? 0).catch(() => 0);
    // Myntra's list filter doesn't accept 'C', so derive Completed/closed as the
    // remainder (these come back with a blank summary status from getOrderList).
    const counted = Object.values(byStatus).reduce((a, b) => a + (b || 0), 0);
    // Inbox count mirrors the list: only orders still in progress.
    let inboxOrders = 0;
    try { inboxOrders = (await resolveInbox()).length; } catch { /* best-effort count */ }
    return res.json({
      ok: true,
      total,
      byStatus,
      completed: Math.max(0, total - counted),
      inboxOrders,
      returns: db.returns.size,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// ── 360° Sales Report ──────────────────────────────────────────────────────────
// Aggregates every order's live detail (+ current inventory + local returns) into a
// detailed, exportable sales report: SKU-wise, category-wise, region-wise, payment,
// time-series, returns and inventory health. Cached briefly since it fans out one
// detail call per order.
const round = (n, d = 0) => { const f = 10 ** d; return Math.round((Number(n) || 0) * f) / f; };
const REPORT_STATUS_LABEL = {
  RFR: 'New', WP: 'In Progress', PK: 'Packed', SH: 'Shipped', S: 'Shipped',
  DL: 'Delivered', D: 'Delivered', C: 'Completed', IC: 'Cancelled', '': 'Completed',
};
// SKUs here read like "Earrings359" / "Necklace707"; the leading word is the category.
const categoryOf = (sku) => {
  const m = String(sku || '').match(/^([A-Za-z][A-Za-z\s&-]*?)\s*\d*$/);
  const base = (m ? m[1] : '').trim();
  return base || 'Other';
};
// Myntra returns dates as "dd-MM-yyyy HH:mm:ss" (e.g. "14-06-2026 12:15:25"),
// which Date.parse can't read. Parse that explicitly, falling back to ISO.
function parseMyntraDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})[-/](\d{2})[-/](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const t = Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return Number.isNaN(t) ? null : new Date(t);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}
// No explicit order-creation field exists; ship-by time is the earliest universal
// timestamp (set at order placement as the SLA deadline), so it proxies the order date.
const REPORT_DATE_KEYS = ['createdOn', 'orderCreatedTime', 'orderDate', 'shipByTime', 'invoiceDate', 'packedOn', 'packByTime', 'customerPromiseTime', 'expectedDeliveryTime'];
function pickDate(...objs) {
  for (const o of objs) {
    if (!o) continue;
    for (const k of REPORT_DATE_KEYS) {
      if (o[k]) { const d = parseMyntraDate(o[k]); if (d) return d; }
    }
  }
  return null;
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i; i += 1; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}
let reportCache = null; // { at, data }
const REPORT_TTL_MS = 5 * 60 * 1000;

router.get('/orders/api/report', dashboardGate, async (req, res) => {
  try {
    if (String(req.query.refresh || '') !== '1' && reportCache && (Date.now() - reportCache.at) < REPORT_TTL_MS) {
      return res.json({ ok: true, cached: true, ...reportCache.data });
    }

    // 1) Every order summary (all pages, unfiltered).
    const first = (await myntraClient.fetchOrderList({ page: 0 })).body || {};
    let items = Array.isArray(first.data) ? first.data : [];
    const pages = first.pages || 1;
    for (let p = 1; p < pages; p += 1) {
      const r = await myntraClient.fetchOrderList({ page: p });
      if (r.body && Array.isArray(r.body.data)) items = items.concat(r.body.data);
    }
    const summaryById = new Map();
    for (const it of items) {
      const sid = (it.orderLines || []).map((l) => l.sellerOrderId).find(Boolean);
      if (sid && !summaryById.has(sid)) {
        summaryById.set(sid, { status: String((it.orderLines[0] && it.orderLines[0].status) || '').toUpperCase(), listItem: it });
      }
    }
    const sids = [...summaryById.keys()];

    // 2) Live detail per order (concurrency-limited fan-out).
    const details = await mapLimit(sids, 8, async (sid) => {
      try { return { sid, body: (await myntraClient.fetchOrderById(sid)).body || {} }; }
      catch { return { sid, body: null }; }
    });

    // 3) Normalize into order + line records.
    const orders = [];
    const skuSet = new Set();
    for (const { sid, body } of details) {
      const meta = summaryById.get(sid) || {};
      const det = body || {};
      const entries = Array.isArray(det.orderLineEntries) ? det.orderLineEntries : [];
      const date = pickDate(entries[0], det, meta.listItem);
      const region = det.stateName || det.state || 'Unknown';
      const payment = ['on', 'prepaid'].includes(String(det.paymentMethod || '').toLowerCase())
        ? 'Prepaid' : (det.paymentMethod ? 'COD' : 'Unknown');
      const status = meta.status || (entries[0] && entries[0].status_code) || '';
      const lineRecs = entries.map((l) => {
        const qty = Number(l.quantity) > 0 ? Number(l.quantity) : 1;
        const gross = Number(l.lineFinalAmount) || Number(l.mrp) || 0;
        const tax = (Array.isArray(l.taxEntries) ? l.taxEntries.reduce((t, e) => t + (Number(e.unitTaxAmount) || 0), 0) : 0) * qty;
        const skuStr = String(l.sku || '—');
        if (l.sku) skuSet.add(skuStr);
        return {
          orderLineId: String(l.orderLineId || ''), sku: skuStr, category: categoryOf(skuStr),
          qty, gross, tax, settlement: (Number(l.lineSellerFinalAmount) || 0) * qty,
          cancelled: String(l.status_code || '').toUpperCase() === 'IC' || !!l.cancelledOn,
        };
      });
      orders.push({ sid, date: date ? date.toISOString() : null, status, region, city: det.city || null, payment, lines: lineRecs });
    }
    const detailBySid = new Map(orders.map((o) => [o.sid, o]));

    // 4) Current inventory per SKU (Search Inventory, 10/call).
    const skus = [...skuSet];
    const stock = {};
    const stockFailed = [];
    for (let k = 0; k < skus.length; k += 10) {
      const chunk = skus.slice(k, k + 10);
      try {
        const r = await myntraClient.searchInventory(chunk);
        const b = r.body || {};
        if (r.status === 200 && b.statusType !== 'ERROR') {
          for (const d of b.inventoryDetails || []) {
            stock[d.sku] = (d.stores || []).reduce((s, st) => s + (Number(st.inventoryCount) || 0), 0);
          }
          for (const f of b.failedEntries || []) stockFailed.push(f);
        } else { stockFailed.push(...chunk); }
      } catch { stockFailed.push(...chunk); }
    }

    // 5) Returns mapped to SKU/category/value (via the order detail we already have).
    const returns = [];
    for (const r of db.returns.values()) {
      const ord = r.sellerOrderId ? detailBySid.get(r.sellerOrderId) : null;
      const line = ord
        ? (ord.lines.find((x) => x.orderLineId && String(x.orderLineId) === String(r.orderLineId)) || ord.lines[0])
        : null;
      // Post-delivery return: the order completed its forward journey (shipped → delivered
      // → completed) and then reversed — i.e. the underlying line was NOT cancelled. This
      // separates genuine buyer returns on completed sales from RTO/courier returns whose
      // order is cancelled (IC) and already counted under Cancellations.
      const postDelivery = line ? !line.cancelled : (r.type === 'CUSTOMER_RETURN');
      returns.push({
        id: r.id, sellerOrderId: r.sellerOrderId || null,
        sku: line ? line.sku : null, category: line ? line.category : null,
        value: line ? round(line.gross) : 0, type: r.type || null,
        reason: r.reason || null, status: r.status || null, createdOn: r.createdOn || null,
        postDelivery,
      });
    }

    // 6) Aggregate.
    const activeLines = (o) => o.lines.filter((l) => !l.cancelled);
    const sumBy = (o, sel, pred = () => true) => o.lines.filter(pred).reduce((a, l) => a + sel(l), 0);

    const dts = orders.map((o) => o.date).filter(Boolean).map((d) => new Date(d).getTime());
    const minD = dts.length ? new Date(Math.min(...dts)) : null;
    const maxD = dts.length ? new Date(Math.max(...dts)) : null;
    const windowDays = (minD && maxD) ? Math.max(1, Math.round((maxD - minD) / 86400000) + 1) : 1;

    const hasStock = Object.keys(stock).length > 0;
    const skuAgg = {};
    for (const o of orders) {
      const day = o.date ? o.date.slice(0, 10) : null;
      for (const l of o.lines) {
        const s = skuAgg[l.sku] || (skuAgg[l.sku] = { sku: l.sku, category: l.category, units: 0, revenue: 0, gross: 0, tax: 0, settlement: 0, cancelledUnits: 0, returnedUnits: 0, orders: new Set(), saleDays: new Set() });
        s.gross += l.gross;
        if (l.cancelled) s.cancelledUnits += l.qty;
        else { s.units += l.qty; s.revenue += l.gross; s.tax += l.tax; s.settlement += l.settlement; s.orders.add(o.sid); if (day) s.saleDays.add(day); }
      }
    }
    for (const r of returns) if (r.sku && skuAgg[r.sku]) skuAgg[r.sku].returnedUnits += 1;

    // Mirrors dashboardweb: cancelled orders are excluded from the gross/order/unit
    // cohort entirely (GMV = non-cancelled shipped value); returns are deducted to
    // reach Net. Cancellations are surfaced separately as their own metric.
    const totalOrdersAll = orders.length;
    const cancelledOrders = orders.filter((o) => o.lines.length && o.lines.every((l) => l.cancelled)).length;
    const ordersCount = totalOrdersAll - cancelledOrders; // non-cancelled order cohort
    const grossSales = orders.reduce((s, o) => s + sumBy(o, (l) => l.gross, (l) => !l.cancelled), 0);
    const cancelledValue = orders.reduce((s, o) => s + sumBy(o, (l) => l.gross, (l) => l.cancelled), 0);
    const returnValue = returns.reduce((s, r) => s + (r.value || 0), 0);
    const postDeliveryReturnsList = returns.filter((r) => r.postDelivery);
    const postDeliveryReturns = postDeliveryReturnsList.length;
    const postDeliveryReturnValue = postDeliveryReturnsList.reduce((s, r) => s + (r.value || 0), 0);
    const taxCollected = orders.reduce((s, o) => s + sumBy(o, (l) => l.tax, (l) => !l.cancelled), 0);
    const sellerSettlement = orders.reduce((s, o) => s + sumBy(o, (l) => l.settlement, (l) => !l.cancelled), 0);
    const unitsSold = orders.reduce((s, o) => s + sumBy(o, (l) => l.qty, (l) => !l.cancelled), 0);
    const netSales = grossSales - returnValue;
    const returnCount = returns.length;
    const totalCurrentStock = Object.values(stock).reduce((a, b) => a + b, 0);
    const totalRev = Object.values(skuAgg).reduce((a, s) => a + s.revenue, 0) || 1;

    // dashboardweb fast/slow thresholds: 28 units / 30 days (~0.93/day) high,
    // 10 units / 30 days (~0.33/day) low — compared against per-day velocity.
    const HIGH_VELOCITY = 28 / 30;
    const LOW_VELOCITY = 10 / 30;
    const bySku = Object.values(skuAgg).map((s) => {
      const velocity = s.units / windowDays; // units/day over the order window (for movers)
      const cur = stock[s.sku] != null ? stock[s.sku] : null;
      // Days-of-inventory uses velocity over days WITH sales (dashboardweb), and the
      // 9999 "never sells out" sentinel when there's stock but no recorded sales.
      const saleVelocity = s.saleDays.size ? s.units / s.saleDays.size : 0;
      let daysOfInventory = null;
      if (cur != null) daysOfInventory = saleVelocity > 0 ? round(cur / saleVelocity, 1) : (cur > 0 ? 9999 : 0);
      return {
        sku: s.sku, category: s.category, units: s.units, orders: s.orders.size,
        revenue: round(s.revenue), tax: round(s.tax), settlement: round(s.settlement),
        avgPrice: s.units ? round(s.revenue / s.units) : 0,
        contributionPct: round((s.revenue / totalRev) * 100, 1),
        cancelledUnits: s.cancelledUnits, returnedUnits: s.returnedUnits,
        returnRate: s.units ? round((s.returnedUnits / s.units) * 100, 1) : 0,
        currentStock: cur, velocity: round(velocity, 2), daysOfInventory,
        movement: velocity >= HIGH_VELOCITY ? 'fast' : (s.units > 0 && velocity < LOW_VELOCITY ? 'slow' : 'medium'),
        sellThrough: (cur != null) ? round((s.units / ((s.units + cur) || 1)) * 100, 1) : null,
      };
    }).sort((a, b) => b.revenue - a.revenue).map((s, i) => ({ ...s, rank: i + 1 }));

    const catAgg = {};
    for (const s of Object.values(skuAgg)) {
      const c = catAgg[s.category] || (catAgg[s.category] = { category: s.category, units: 0, revenue: 0, returnedUnits: 0, currentStock: 0, skus: 0 });
      c.units += s.units; c.revenue += s.revenue; c.returnedUnits += s.returnedUnits;
      c.currentStock += (stock[s.sku] || 0); c.skus += 1;
    }
    const byCategory = Object.values(catAgg).map((c) => ({
      ...c, revenue: round(c.revenue), contributionPct: round((c.revenue / totalRev) * 100, 1),
      returnRate: c.units ? round((c.returnedUnits / c.units) * 100, 1) : 0,
    })).sort((a, b) => b.revenue - a.revenue);

    const regAgg = {};
    for (const o of orders) {
      const r = regAgg[o.region] || (regAgg[o.region] = { region: o.region, orders: 0, units: 0, revenue: 0 });
      r.orders += 1; r.units += sumBy(o, (l) => l.qty, (l) => !l.cancelled); r.revenue += sumBy(o, (l) => l.gross, (l) => !l.cancelled);
    }
    const byRegion = Object.values(regAgg).map((r) => ({ ...r, revenue: round(r.revenue) })).sort((a, b) => b.revenue - a.revenue);

    const payAgg = {};
    for (const o of orders) {
      const p = payAgg[o.payment] || (payAgg[o.payment] = { method: o.payment, orders: 0, revenue: 0 });
      p.orders += 1; p.revenue += sumBy(o, (l) => l.gross, (l) => !l.cancelled);
    }
    const byPayment = Object.values(payAgg).map((p) => ({ ...p, revenue: round(p.revenue) })).sort((a, b) => b.revenue - a.revenue);

    const statAgg = {};
    for (const o of orders) {
      const label = REPORT_STATUS_LABEL[o.status] != null ? REPORT_STATUS_LABEL[o.status] : (o.status || 'Completed');
      const s = statAgg[label] || (statAgg[label] = { status: label, orders: 0, units: 0, revenue: 0 });
      s.orders += 1; s.units += sumBy(o, (l) => l.qty); s.revenue += sumBy(o, (l) => l.gross);
    }
    const byStatus = Object.values(statAgg).map((s) => ({ ...s, revenue: round(s.revenue) })).sort((a, b) => b.revenue - a.revenue);

    const isoWeek = (d) => {
      const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const day = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
      const wk = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
      return `${dt.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
    };
    const bucket = (keyFn) => {
      const m = {};
      for (const o of orders) {
        if (!o.date) continue;
        const k = keyFn(new Date(o.date));
        const b = m[k] || (m[k] = { key: k, revenue: 0, orders: 0, units: 0 });
        b.orders += 1; b.units += sumBy(o, (l) => l.qty, (l) => !l.cancelled); b.revenue += sumBy(o, (l) => l.gross, (l) => !l.cancelled);
      }
      return Object.values(m).sort((a, b) => a.key.localeCompare(b.key)).map((b) => ({ ...b, revenue: round(b.revenue) }));
    };
    const revenueByDay = bucket((d) => d.toISOString().slice(0, 10));
    const revenueByWeek = bucket(isoWeek);
    // Growth %: ((curr − prev) / |prev|) × 100; prev == 0 → 100 if curr > 0 else 0 (dashboardweb).
    const growth = (curr, prev) => (prev ? round(((curr - prev) / Math.abs(prev)) * 100, 1) : (curr > 0 ? 100 : 0));
    const revenueByMonth = bucket((d) => d.toISOString().slice(0, 7))
      .map((b, i, arr) => ({ ...b, growthPct: i === 0 ? null : growth(b.revenue, arr[i - 1].revenue) }));

    const sold = bySku.filter((s) => s.units > 0);
    const topSkus = sold.slice(0, 10);
    const bottomSkus = [...sold].sort((a, b) => a.revenue - b.revenue).slice(0, 10);
    // Fast/slow are threshold-based (velocity vs 0.93 / 0.33 units-per-day), like dashboardweb.
    const fastMoving = sold.filter((s) => s.movement === 'fast').sort((a, b) => b.velocity - a.velocity);
    const slowMoving = sold.filter((s) => s.movement === 'slow').sort((a, b) => a.velocity - b.velocity).slice(0, 12);
    const outOfStock = bySku.filter((s) => s.currentStock === 0);

    const orderRows = orders.map((o) => ({
      sellerOrderId: o.sid, date: o.date,
      status: REPORT_STATUS_LABEL[o.status] != null ? REPORT_STATUS_LABEL[o.status] : (o.status || 'Completed'),
      region: o.region, city: o.city, payment: o.payment,
      units: sumBy(o, (l) => l.qty), gross: round(sumBy(o, (l) => l.gross)),
      net: round(sumBy(o, (l) => l.gross, (l) => !l.cancelled)),
      skus: o.lines.map((l) => l.sku).join(', '),
    })).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const data = {
      generatedAt: new Date().toISOString(),
      window: {
        from: minD ? minD.toISOString().slice(0, 10) : null,
        to: maxD ? maxD.toISOString().slice(0, 10) : null,
        days: windowDays, hasDates: dts.length > 0,
      },
      summary: {
        grossSales: round(grossSales), netSales: round(netSales), cancelledValue: round(cancelledValue),
        returnValue: round(returnValue), taxCollected: round(taxCollected), sellerSettlement: round(sellerSettlement),
        ordersCount, unitsSold, aov: round(ordersCount ? grossSales / ordersCount : 0),
        itemsPerOrder: round(ordersCount ? unitsSold / ordersCount : 0, 2),
        cancelledOrders, cancelRate: round(totalOrdersAll ? (cancelledOrders / totalOrdersAll) * 100 : 0, 1),
        returnCount, returnedUnits: returnCount, returnRate: round(unitsSold ? (returnCount / unitsSold) * 100 : 0, 1),
        postDeliveryReturns, postDeliveryReturnValue: round(postDeliveryReturnValue),
        postDeliveryReturnRate: round(ordersCount ? (postDeliveryReturns / ordersCount) * 100 : 0, 1),
        totalCurrentStock: hasStock ? totalCurrentStock : null,
        outOfStockCount: hasStock ? outOfStock.length : null,
        sellThroughRate: hasStock ? round((unitsSold + totalCurrentStock) ? (unitsSold / (unitsSold + totalCurrentStock)) * 100 : 0, 1) : null,
        inventoryTurnover: (hasStock && totalCurrentStock) ? round(unitsSold / totalCurrentStock, 2) : null,
        revenueGrowthPct: revenueByMonth.length >= 2 ? revenueByMonth[revenueByMonth.length - 1].growthPct : null,
        skuCount: skus.length,
      },
      byStatus, bySku, byCategory, byRegion, byPayment,
      revenueByDay, revenueByWeek, revenueByMonth,
      topSkus, bottomSkus, fastMoving, slowMoving, outOfStock,
      returns, orders: orderRows,
      notes: [
        `GMV, orders, units & AOV use the non-cancelled cohort (dashboardweb parity); ${cancelledOrders} cancelled order(s) worth ₹${round(cancelledValue).toLocaleString('en-IN')} are excluded and shown separately. Net = GMV − returns.`,
        'Order timestamps use Myntra’s ship-by time — the API returns no explicit order-creation field.',
        'Fast/slow movers use velocity thresholds of 0.93 / 0.33 units-per-day; days-of-inventory uses velocity over days with sales.',
        hasStock
          ? 'Reserved stock isn’t exposed by Myntra’s inventory API, so “Available” equals current stock.'
          : 'Live inventory was unavailable for these SKUs (Myntra’s search returned none), so stock-based metrics are omitted.',
      ].filter(Boolean),
    };
    reportCache = { at: Date.now(), data };
    return res.json({ ok: true, cached: false, ...data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Update inventory on Myntra (the M-Direct panel is closed for OMS sellers, so this is
// the in-OMS replacement). Myntra's API caps at 10 SKUs/call, so we chunk and aggregate.
router.post('/orders/api/inventory/update', dashboardGate, async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = raw
      .map((i) => ({
        sku: String(i.sku ?? '').trim(),
        quantity: Number(i.quantity),
        processingSla: i.processingSla === '' || i.processingSla == null ? 5 : Number(i.processingSla),
        store_code: String(i.store_code ?? i.storeCode ?? '').trim(),
      }))
      .filter((i) => i.sku);

    if (!items.length) return res.status(400).json({ ok: false, error: 'No valid SKU rows provided.' });
    const bad = items.find((i) => !Number.isFinite(i.quantity) || i.quantity < 0 || !i.store_code);
    if (bad) return res.status(400).json({ ok: false, error: `Each row needs a SKU, a non-negative quantity, and a store code (check "${bad.sku}").` });

    const failed = [];
    const chunkErrors = [];
    for (let k = 0; k < items.length; k += 10) {
      const chunk = items.slice(k, k + 10);
      const r = await myntraClient.updateInventory(chunk);
      const body = r.body || {};
      if (r.status !== 200 || body.statusType === 'ERROR') {
        chunkErrors.push({ httpStatus: r.status, statusCode: body.statusCode ?? null, message: body.statusMessage || body.message || 'Update failed', skus: chunk.map((c) => c.sku) });
      } else if (Array.isArray(body.failedEntries)) {
        failed.push(...body.failedEntries);
      }
    }
    const failedSkus = new Set([...failed.map((f) => f.sku), ...chunkErrors.flatMap((e) => e.skus)]);
    return res.json({
      ok: true,
      submitted: items.length,
      succeeded: items.length - failedSkus.size,
      failed,        // per-SKU rejections with remarks
      chunkErrors,   // whole-batch failures (rare)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Override discounts on Myntra (PUT /partner/v4/discount/override), chunked to 100/call.
// discount 0 removes the discount. Returns per-SKU status (e.g. "Invalid SKU").
router.post('/orders/api/discount/override', dashboardGate, async (req, res) => {
  try {
    const { startDate, endDate, discountType = 'FlatPercent' } = req.body || {};
    if (!startDate || !endDate) return res.status(400).json({ ok: false, error: 'Start and end date are required.' });
    const items = (Array.isArray(req.body?.items) ? req.body.items : [])
      .map((i) => ({ sku: String(i.sku ?? '').trim(), discount: Number(i.discount) }))
      .filter((i) => i.sku);
    if (!items.length) return res.status(400).json({ ok: false, error: 'No valid SKU rows provided.' });
    const bad = items.find((i) => !Number.isFinite(i.discount) || i.discount < 0);
    if (bad) return res.status(400).json({ ok: false, error: `Discount must be a non-negative number (check "${bad.sku}").` });

    const results = [];
    const chunkErrors = [];
    for (let k = 0; k < items.length; k += 100) {
      const chunk = items.slice(k, k + 100);
      const r = await myntraClient.overrideDiscount({ startDate, endDate, discountType, discountEntries: chunk });
      const body = r.body || {};
      if (r.status !== 200 || body.statusType === 'ERROR') {
        chunkErrors.push({ httpStatus: r.status, statusCode: body.statusCode ?? null, message: body.statusMessage || body.message || 'Failed', skus: chunk.map((c) => c.sku) });
      } else if (Array.isArray(body.discountEntries)) {
        results.push(...body.discountEntries);
      } else {
        results.push(...chunk.map((c) => ({ ...c, status: 'Processed' })));
      }
    }
    const failed = results.filter((e) => e.status && /invalid|error|fail/i.test(String(e.status)));
    const failedFromChunks = chunkErrors.flatMap((e) => e.skus);
    return res.json({
      ok: true,
      submitted: items.length,
      succeeded: items.length - failed.length - failedFromChunks.length,
      results,
      chunkErrors,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Current inventory for given SKUs (Search Inventory), chunked to 10/call.
// Returns sku -> [{ store_code, count }] plus any SKUs Myntra couldn't find.
router.post('/orders/api/inventory/search', dashboardGate, async (req, res) => {
  try {
    const skus = (Array.isArray(req.body?.skus) ? req.body.skus : []).map((s) => String(s).trim()).filter(Boolean);
    if (!skus.length) return res.status(400).json({ ok: false, error: 'No SKUs provided.' });
    const inventory = {};
    const failed = [];
    const blocked = [];
    for (let k = 0; k < skus.length; k += 10) {
      const chunk = skus.slice(k, k + 10);
      const r = await myntraClient.searchInventory(chunk);
      const body = r.body || {};
      if (r.status !== 200 || body.statusType === 'ERROR') {
        // e.g. Myntra's WAF 403s certain exact SKU strings — surface, don't drop silently.
        blocked.push(...chunk);
        continue;
      }
      for (const d of body.inventoryDetails || []) {
        inventory[d.sku] = (d.stores || []).map((s) => ({ store_code: s.stores_code ?? s.store_code ?? null, count: s.inventoryCount }));
      }
      for (const f of body.failedEntries || []) failed.push(f);
    }
    return res.json({ ok: true, inventory, failed, blocked });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Distinct seller SKUs seen across this account's orders (best-effort discovery,
// since there's no catalog API). Bounded so it can't run away.
router.get('/orders/api/skus', dashboardGate, async (_req, res) => {
  try {
    const first = await myntraClient.fetchOrderList({ page: 0 });
    const fb = first.body || {};
    let orders = Array.isArray(fb.data) ? fb.data : [];
    const pages = Math.min(fb.pages || 1, 6);
    for (let p = 1; p < pages; p++) {
      const r = await myntraClient.fetchOrderList({ page: p });
      if (r.body && Array.isArray(r.body.data)) orders = orders.concat(r.body.data);
    }
    const sids = [...new Set(orders.flatMap((o) => (o.orderLines || []).map((l) => l.sellerOrderId)).filter(Boolean))].slice(0, 80);
    const skus = new Set();
    for (const sid of sids) {
      try {
        const d = await myntraClient.fetchOrderById(sid);
        for (const l of d.body?.orderLineEntries || []) if (l.sku) skus.add(String(l.sku));
      } catch (_e) { /* skip */ }
    }
    return res.json({ ok: true, skus: [...skus].sort() });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// ───────── Catalog Stock: Amazon∪Flipkart SKUs probed against Myntra inventory ─────────
// Myntra exposes no "list all inventory" API, so we take the Amazon∪Flipkart catalog
// (pulled from those marketplace APIs, cached in data/marketplace_skus.json) as the SKU
// universe and hit Search Inventory (10 SKUs/call) for each. ~1.3k SKUs ≈ 133 calls, so
// it runs as a background job the page polls; the result is cached in memory (15-min TTL).
let catalogStockJob = null;

function loadMasterSkus() {
  const file = path.join(__dirname, '../../data/marketplace_skus.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw.skus) ? raw.skus : [];
}

// SKUs seen in Myntra orders the OMS has recorded locally (webhook pushes + processed
// orders, persisted in db.orders). Free + instant — no API calls. Lets a newly-ordered
// SKU surface on the Inventory page without regenerating the catalog file.
function localOrderSkus() {
  const out = new Set();
  try {
    for (const order of db.orders.values()) {
      const lm = order && order.lineMap;
      if (!lm || typeof lm.values !== 'function') continue;
      for (const line of lm.values()) {
        const s = line && line.sku != null ? String(line.sku).trim() : '';
        if (s) out.add(s);
      }
    }
  } catch { /* order store is best-effort; never fail the build over it */ }
  return out;
}

async function buildCatalogStock(job) {
  const master = loadMasterSkus();
  const sourceMap = new Map(master.map((m) => [m.sku, m.sources || []]));
  const all = master.map((m) => m.sku);

  // Auto-merge: fold in any SKU Myntra has actually ordered from us that isn't already
  // in the Amazon∪Flipkart catalog file, so new SKUs appear as soon as they sell.
  const seen = new Set(all);
  for (const sku of localOrderSkus()) {
    if (!seen.has(sku)) { seen.add(sku); all.push(sku); sourceMap.set(sku, ['myntra']); }
  }

  job.total = all.length;
  const stock = new Map(); // sku -> { byStore, total, onMyntra } | { blocked } | { error }
  for (let k = 0; k < all.length; k += 10) {
    const chunk = all.slice(k, k + 10);
    try {
      const r = await myntraClient.searchInventory(chunk);
      const b = r.body || {};
      if (r.status === 200 && b.statusType !== 'ERROR') {
        for (const d of b.inventoryDetails || []) {
          const byStore = {};
          let total = 0;
          for (const st of d.stores || []) {
            const code = String(st.stores_code ?? st.store_code ?? '');
            const c = Number(st.inventoryCount) || 0;
            byStore[code] = c; total += c;
          }
          stock.set(d.sku, { byStore, total, onMyntra: true });
        }
        // Anything not returned in inventoryDetails simply isn't catalogued on Myntra —
        // that's expected (a SKU can be Amazon/Flipkart-only), not an error.
      } else {
        // e.g. Myntra's WAF 403s certain exact SKU strings — flag, don't silently drop.
        for (const s of chunk) if (!stock.has(s)) stock.set(s, { blocked: true });
      }
    } catch {
      for (const s of chunk) if (!stock.has(s)) stock.set(s, { error: true });
    }
    job.done = Math.min(k + 10, all.length);
  }
  return all.map((sku) => {
    const st = stock.get(sku) || {};
    return {
      sku,
      sources: sourceMap.get(sku) || [],
      onMyntra: !!st.onMyntra,
      total: st.onMyntra ? st.total : null,
      active: st.byStore ? (st.byStore['84502'] ?? 0) : null, // 84502 = the push warehouse
      other: st.byStore ? (st.byStore['80176'] ?? 0) : null,
      blocked: !!st.blocked,
      error: !!st.error,
    };
  });
}

function summarizeCatalog(items) {
  const onMyntra = items.filter((i) => i.onMyntra);
  const inStock = onMyntra.filter((i) => (i.total || 0) > 0);
  return {
    totalSkus: items.length,
    amazon: items.filter((i) => i.sources.includes('amazon')).length,
    flipkart: items.filter((i) => i.sources.includes('flipkart')).length,
    both: items.filter((i) => (i.sources || []).length > 1).length,
    onMyntra: onMyntra.length,
    inStock: inStock.length,
    outOfStock: onMyntra.length - inStock.length,
    notOnMyntra: items.length - onMyntra.length,
    blocked: items.filter((i) => i.blocked).length,
    totalUnits: onMyntra.reduce((a, i) => a + (i.total || 0), 0),
  };
}

router.get('/orders/api/catalog-stock', dashboardGate, (req, res) => {
  const refresh = req.query.refresh === '1';
  const TTL = 15 * 60 * 1000;
  const j = catalogStockJob;
  if (j && j.status === 'done' && !refresh && Date.now() - j.finishedAt < TTL) {
    return res.json({ status: 'done', generatedAt: new Date(j.finishedAt).toISOString(), summary: summarizeCatalog(j.items), items: j.items });
  }
  if (j && j.status === 'running') {
    return res.json({ status: 'running', done: j.done, total: j.total });
  }
  const job = (catalogStockJob = { status: 'running', done: 0, total: 0, startedAt: Date.now() });
  buildCatalogStock(job)
    .then((items) => { job.items = items; job.status = 'done'; job.finishedAt = Date.now(); })
    .catch((e) => { job.status = 'error'; job.error = e.message; });
  return res.json({ status: 'running', done: 0, total: job.total });
});

// ───────── Payments: payouts (Payment History) + settlement reports (Invoice Reports) ─────────
// Parse one CSV line, honouring double-quoted fields (the settlement reports quote names
// and can contain commas inside quotes).
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripQuote = (s) => String(s == null ? '' : s).replace(/^'/, '').trim();
// Normalise any date-ish string to YYYY-MM-DD (handles ISO, "YYYY-MM-DD HH:MM", and DD-MM-YYYY).
const toISODate = (x) => { const s = String(x == null ? '' : x); let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = s.match(/(\d{2})-(\d{2})-(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`; return ''; };
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;

// Download a signed report/blob URL and parse it into { columns, rows }. Gunzips if needed.
async function fetchCsvUrl(url) {
  const dl = await fetch(url);
  const buf = Buffer.from(await dl.arrayBuffer());
  let text;
  try { text = require('zlib').gunzipSync(buf).toString('utf8'); } catch { text = buf.toString('utf8'); }
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { columns: [], rows: [] };
  return { columns: splitCsvLine(lines[0]), rows: lines.slice(1).map(splitCsvLine) };
}

// Every (year, month) touched by a yyyy-MM-dd..yyyy-MM-dd range (capped, for safety).
function monthsInRange(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out = [];
  let y = fy, m = fm;
  while ((y < ty || (y === ty && m <= tm)) && out.length < 36) {
    out.push({ year: String(y), month: String(m).padStart(2, '0') });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// All payouts for the window across the requested methods, all pages. Myntra intermittently
// returns payments:[] even when totalElements>0, so we retry a page until it yields (or is
// genuinely empty). Returns { payments, totals } or throws.
async function collectPayouts(fromDate, toDate, methods) {
  const payments = [];
  const totals = { totalAmount: 0, prepaidAmount: 0, postpaidAmount: 0 };
  for (const m of methods) {
    let pageNo = 0, totalPages = 1;
    do {
      let d = {};
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await myntraClient.fetchPaymentHistory({ paymentMethod: m, fromDate, toDate, pageNo, pageSize: 100 });
        const b = r.body || {};
        if (r.status !== 200 || b.statusType === 'ERROR') throw new Error(b.statusMessage || `Myntra returned ${r.status}.`);
        d = b.data || {};
        totalPages = d.totalPages || 1;
        if ((d.payments || []).length || !(d.totalElements > 0)) break;
        await sleep(1500); // transient empty page — back off and retry
      }
      if (pageNo === 0) {
        totals.totalAmount += toNum(d.totalAmount);
        totals.prepaidAmount += toNum(d.prepaidAmount);
        totals.postpaidAmount += toNum(d.postpaidAmount);
      }
      for (const p of d.payments || []) payments.push(p);
      pageNo++;
    } while (pageNo < totalPages);
  }
  payments.sort((a, b) => String(b.paymentDate || '').localeCompare(String(a.paymentDate || '')));
  return { payments, totals };
}

// Payouts: what Myntra actually paid, POSTPAID + PREPAID, across the date window.
router.get('/orders/api/payments/history', dashboardGate, async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const want = String(req.query.method || 'ALL').toUpperCase();
    if (!fromDate || !toDate) return res.status(400).json({ ok: false, error: 'fromDate and toDate (yyyy-MM-dd) are required.' });
    const methods = want === 'ALL' ? ['POSTPAID', 'PREPAID'] : [want];
    const { payments, totals } = await collectPayouts(fromDate, toDate, methods);
    return res.json({ ok: true, payments, summary: { ...totals, count: payments.length } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Settlement report: resolve the signed report URL, download the CSV, and return it parsed
// into { columns, rows } (plus the raw URL for a full download).
router.post('/orders/api/payments/report', dashboardGate, async (req, res) => {
  try {
    const { reportType = 'MONTHLY_REPORTS', year, month, reportName } = req.body || {};
    if (!year || !reportName) return res.status(400).json({ ok: false, error: 'year and reportName are required.' });
    const r = await myntraClient.fetchInvoiceReport({ reportType, year, month, reportName });
    const b = r.body || {};
    const entry = (b.data || [])[0];
    if (b.statusCode === 204 || !entry || !entry.reportPath) {
      return res.json({ ok: true, found: false, message: b.statusMessage || 'No report found for this selection.' });
    }
    const reportPath = entry.reportPath;
    let columns = [];
    let rows = [];
    let truncated = false;
    try {
      const dl = await fetch(reportPath);
      const buf = Buffer.from(await dl.arrayBuffer());
      let text;
      try { text = require('zlib').gunzipSync(buf).toString('utf8'); } catch { text = buf.toString('utf8'); }
      const lines = text.split(/\r?\n/).filter((l) => l.length);
      if (lines.length) {
        columns = splitCsvLine(lines[0]);
        const dataLines = lines.slice(1);
        const MAX = 1000; // cap in-app render; the raw URL has the full file
        truncated = dataLines.length > MAX;
        rows = dataLines.slice(0, MAX).map(splitCsvLine);
      }
    } catch { /* still return the URL so the user can download it */ }
    return res.json({ ok: true, found: true, reportName, reportPath, columns, rows, rowCount: rows.length, truncated });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Reconciliation: for a date window, join what Myntra ACTUALLY paid (per-order settlement
// from each payout's detail report) against what it SOLD (Sales_Revenue), to show — per
// order — the sale value, the full deduction breakdown, the net settled, and the effective
// take-rate; plus orders that sold but haven't hit a payout yet (pending money) and the GST.
router.get('/orders/api/payments/reconciliation', dashboardGate, async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) return res.status(400).json({ ok: false, error: 'fromDate and toDate (yyyy-MM-dd) are required.' });

    // 1) Actual per-order settlement from every payout's detail report.
    const { payments } = await collectPayouts(fromDate, toDate, ['POSTPAID', 'PREPAID']);
    const orders = new Map();
    let detailErrors = 0;
    for (const p of payments) {
      if (!p.utrDetailsLink) continue;
      let csv;
      try { csv = await fetchCsvUrl(p.utrDetailsLink); } catch { detailErrors++; continue; }
      const idx = {}; csv.columns.forEach((c, i) => { idx[c] = i; });
      const g = (row, name) => (idx[name] != null ? row[idx[name]] : '');
      for (const row of csv.rows) {
        const id = stripQuote(g(row, 'seller_order_id')) || stripQuote(g(row, 'order_release_id'));
        if (!id) continue;
        let rec = orders.get(id);
        if (!rec) {
          rec = {
            orderId: id, storeOrderId: stripQuote(g(row, 'Store_Order_id')),
            type: stripQuote(g(row, 'Order_Type')), paymentType: stripQuote(g(row, 'Payment_Type')),
            date: stripQuote(g(row, 'Payment_Date')), utr: stripQuote(g(row, 'NEFT_Ref')),
            customerPaid: 0, settled: 0, commission: 0, logistics: 0, fees: 0, tds: 0, marketing: 0, other: 0, gst: 0,
          };
          orders.set(id, rec);
        }
        rec.customerPaid += toNum(g(row, 'customer_paid_amt'));
        rec.settled += toNum(g(row, 'Settled_Amount'));
        rec.commission += toNum(g(row, 'Commission'));
        rec.logistics += toNum(g(row, 'Logistics_Commission'));
        rec.fees += toNum(g(row, 'fixed_fee')) + toNum(g(row, 'pick_and_pack_fee')) + toNum(g(row, 'Shipping_Fee')) + toNum(g(row, 'Payment_Gateway_Fee'));
        rec.tds += toNum(g(row, 'TDS'));
        rec.marketing += toNum(g(row, 'marketingCharges'));
        rec.other += toNum(g(row, 'techEnablement')) + toNum(g(row, 'airLogistics')) + toNum(g(row, 'royaltyCharges')) + toNum(g(row, 'fwdAdditionalCharges')) + toNum(g(row, 'rvsAdditionalCharges'));
        rec.gst += toNum(g(row, 'igst_amount')) + toNum(g(row, 'cgst_amount')) + toNum(g(row, 'sgst_amount'));
      }
    }
    const settled = [...orders.values()].map((o) => ({
      ...o,
      customerPaid: round2(o.customerPaid), settled: round2(o.settled), gst: round2(o.gst),
      commission: round2(o.commission), logistics: round2(o.logistics), fees: round2(o.fees),
      tds: round2(o.tds), marketing: round2(o.marketing), other: round2(o.other),
      deductions: round2(o.customerPaid - o.settled),
      takeRate: o.customerPaid > 0 ? round2((o.customerPaid - o.settled) / o.customerPaid * 100) : 0,
    })).sort((a, b) => b.settled - a.settled);

    const sum = (f) => settled.reduce((a, o) => a + f(o), 0);
    const gross = sum((o) => o.customerPaid);
    const summary = {
      ordersSettled: settled.length,
      grossCustomerPaid: round2(gross),
      netSettled: round2(sum((o) => o.settled)),
      totalDeductions: round2(sum((o) => o.deductions)),
      gst: round2(sum((o) => o.gst)),
      effectiveTakeRate: gross > 0 ? round2(sum((o) => o.deductions) / gross * 100) : 0,
      breakdown: {
        commission: round2(sum((o) => o.commission)), logistics: round2(sum((o) => o.logistics)),
        fees: round2(sum((o) => o.fees)), tds: round2(sum((o) => o.tds)),
        marketing: round2(sum((o) => o.marketing)), other: round2(sum((o) => o.other)),
      },
    };

    // 2) Pending: orders in Sales_Revenue for the covered months that never appear in a
    // payout yet (settlement lags, so recent sales legitimately show here).
    const settledIds = new Set(settled.flatMap((o) => [o.orderId, o.storeOrderId].filter(Boolean)));
    const pendMap = new Map();
    let salesReportMonths = 0;
    for (const { year, month } of monthsInRange(fromDate, toDate)) {
      try {
        const rep = await myntraClient.fetchInvoiceReport({ reportType: 'MONTHLY_REPORTS', year, month, reportName: 'Sales_Revenue_Packed_B2C' });
        const entry = (rep.body && rep.body.data || [])[0];
        if (!entry || !entry.reportPath) continue;
        const csv = await fetchCsvUrl(entry.reportPath);
        const idx = {}; csv.columns.forEach((c, i) => { idx[c] = i; });
        const g = (row, name) => (idx[name] != null ? row[idx[name]] : '');
        salesReportMonths++;
        for (const row of csv.rows) {
          const code = stripQuote(g(row, 'Sale_Order_Code'));
          const oc = stripQuote(g(row, 'Order_Code'));
          const key = code || oc;
          if (!key || settledIds.has(code) || settledIds.has(oc)) continue;
          const e = pendMap.get(key) || { orderCode: key, amount: 0, month: `${year}-${month}` };
          e.amount += toNum(g(row, 'Total_Amount'));
          pendMap.set(key, e);
        }
      } catch { /* pending is best-effort per month */ }
    }
    const pending = [...pendMap.values()].map((p) => ({ ...p, amount: round2(p.amount) })).sort((a, b) => b.amount - a.amount);
    const pendingAmount = round2(pending.reduce((a, p) => a + p.amount, 0));

    return res.json({ ok: true, summary, settled, pending, pendingAmount, notes: { detailErrors, salesReportMonths } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// The settlement reports only carry Myntra's vendor code (ALJE…); the friendly seller SKU
// (e.g. Earrings565 — which has a product image) lives on the live order, reachable via the
// row's seller_order_id (a UUID). Resolve + cache it so the financial rows can show thumbnails.
const sellerSkuCache = new Map();
// Myntra vendor SKU (e.g. ALJEAEARR132726470) → friendly seller SKU (Earrings675). Built from
// any order that resolves both; lets completed orders (whose live detail is empty) still show a
// friendly SKU + image by reusing the mapping from another order of the same style.
const vendorToFriendly = new Map();
async function resolveSellerSkus(ids) {
  const todo = [...new Set(ids)].filter((id) => id && !sellerSkuCache.has(id));
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async (id) => {
      try {
        const d = await myntraClient.fetchOrderById(id);
        const lines = (d.body && (d.body.orderLineEntries || d.body.orderLines)) || [];
        sellerSkuCache.set(id, lines[0] && lines[0].sku ? String(lines[0].sku) : '');
      } catch { sellerSkuCache.set(id, ''); }
    }));
  }
}

// COGS (cost per seller SKU) is the one thing the marketplace feed can't give us — the
// seller enters it, exactly like Amazon/Flipkart in SmartCommerce. Persisted to a file.
const COGS_FILE = path.join(__dirname, '../../data/sku_cogs.json');
function loadCogs() { try { return JSON.parse(fs.readFileSync(COGS_FILE, 'utf8')) || {}; } catch { return {}; } }

router.get('/orders/api/financials/cogs', dashboardGate, (_req, res) => res.json({ ok: true, cogs: loadCogs() }));
router.post('/orders/api/financials/cogs', dashboardGate, (req, res) => {
  try {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    const map = loadCogs();
    let updated = 0;
    for (const it of items) {
      const sku = String(it.sku || '').trim();
      const cost = Number(it.cost);
      if (sku && Number.isFinite(cost) && cost >= 0) { map[sku] = round2(cost); updated++; }
    }
    fs.writeFileSync(COGS_FILE, JSON.stringify(map));
    return res.json({ ok: true, updated, count: Object.keys(map).length });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message }); }
});

// Pull COGS from Alya's own price API into the COGS file (defensive — parses common
// JSON shapes). Shared by the scheduled auto-sync below and the manual sync route.
// Returns { ok, synced, count } or { ok:false, error }; never throws on bad payloads.
async function syncAlyaCogs() {
  const r = await fetch('https://alyajewels.com/api/get-all-product-prices', { headers: { Accept: 'application/json' } });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { return { ok: false, error: 'Alya API is not returning JSON right now (server error on alyajewels.com).' }; }
  // Reject Laravel/error payloads outright so we never parse "line: 281" as a price.
  if (json && !Array.isArray(json) && (json.exception || json.trace || json.message || json.error)) {
    return { ok: false, error: 'Alya API returned an error: ' + String(json.message || json.error || 'server error').slice(0, 120) };
  }
  const map = {};
  const addByKey = (key, price) => { const k = String(key == null ? '' : key).trim(); const c = Number(price); if (k && Number.isFinite(c) && c >= 0) map[k] = round2(c); };
  // Only trust explicit array/container shapes — never a bare object (could be an error).
  let items = null;
  if (Array.isArray(json)) items = json;
  else if (json && Array.isArray(json.data)) items = json.data;
  else if (json && Array.isArray(json.prices)) items = json.prices;
  else if (json && Array.isArray(json.products)) items = json.products;
  // Alya keys each cost by the SKU number (its `id`) — e.g. Earrings632 → id 632. Store it
  // by that number; the financials match by stripping the prefix off the seller SKU. If the
  // API ever adds a `sku` field, we prefer that.
  if (items) for (const it of items) { if (it && typeof it === 'object') { const sku = it.sku ?? it.SKU ?? it.product_sku ?? it.code; addByKey((sku != null && String(sku).trim()) ? sku : it.id, it.cost ?? it.cost_price ?? it.costPrice ?? it.price ?? it.mrp); } }
  if (!Object.keys(map).length) {
    const fields = items && items[0] && typeof items[0] === 'object' ? Object.keys(items[0]).join(', ') : '';
    const msg = items && items.length
      ? `Alya returned ${items.length} costs but no SKU to map them to (fields: ${fields}). Ask Alya to add the seller SKU (e.g. Earrings632) to each item.`
      : 'No usable prices in the Alya response.';
    return { ok: false, error: msg };
  }
  const merged = { ...loadCogs(), ...map };
  fs.writeFileSync(COGS_FILE, JSON.stringify(merged));
  return { ok: true, synced: Object.keys(map).length, count: Object.keys(merged).length };
}

// Manual trigger kept for debugging/ops; the UI no longer surfaces it (auto-synced instead).
router.post('/orders/api/financials/cogs/sync-alya', dashboardGate, async (_req, res) => {
  try {
    const out = await syncAlyaCogs();
    return res.status(out.ok ? 200 : 502).json(out);
  } catch (error) { return res.status(502).json({ ok: false, error: 'Could not reach Alya API: ' + error.message }); }
});

// Automatic COGS sync — pull cost prices from Alya on boot and on a fixed interval, so
// profit/margin stay current with no manual action. Interval configurable (default 6h).
const COGS_SYNC_INTERVAL_MS = Number(process.env.COGS_SYNC_INTERVAL_MS) || 6 * 60 * 60 * 1000;
function startCogsAutoSync() {
  const run = async () => {
    try {
      const out = await syncAlyaCogs();
      if (out.ok) console.log(`[COGS_SYNC] pulled ${out.synced} SKU costs from Alya (${out.count} total).`);
      else console.warn('[COGS_SYNC] skipped: ' + out.error);
    } catch (error) { console.warn('[COGS_SYNC] failed: ' + error.message); }
  };
  run(); // once on boot
  const timer = setInterval(run, COGS_SYNC_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref(); // don't hold the event loop open
  return timer;
}
router.startCogsAutoSync = startCogsAutoSync;

// Which recent months actually have a settlement report (so the UI can land on real data).
let finMonthsCache = null;
router.get('/orders/api/financials/months', dashboardGate, async (_req, res) => {
  try {
    if (finMonthsCache && Date.now() - finMonthsCache.at < 10 * 60 * 1000) return res.json({ ok: true, months: finMonthsCache.months });
    const list = [];
    let y = new Date().getFullYear(), m = new Date().getMonth() + 1;
    for (let i = 0; i < 12; i++) { list.push({ year: String(y), month: String(m).padStart(2, '0') }); if (--m < 1) { m = 12; y--; } }
    const found = [];
    for (let i = 0; i < list.length; i += 6) {
      await Promise.all(list.slice(i, i + 6).map(async ({ year, month }) => {
        try { const r = await myntraClient.fetchInvoiceReport({ reportType: 'MONTHLY_REPORTS', year, month, reportName: 'PG_Forward_Settled' }); if ((r.body && r.body.data || [])[0] && r.body.data[0].reportPath) found.push(`${year}-${month}`); } catch { /* skip */ }
      }));
    }
    found.sort().reverse();
    finMonthsCache = { at: Date.now(), months: found };
    return res.json({ ok: true, months: found });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message }); }
});

// Map of seller_order_id → delivery date (YYYY-MM-DD) for every order in ANY forward-
// settlement report (last 12 months). The keys double as the "is settled?" set.
let settledIdsCache = null;
async function settledSellerOrderIds() {
  if (settledIdsCache && Date.now() - settledIdsCache.at < 10 * 60 * 1000) return settledIdsCache.map;
  const map = new Map();
  let y = new Date().getFullYear(), m = new Date().getMonth() + 1;
  const list = [];
  for (let i = 0; i < 12; i++) { list.push([String(y), String(m).padStart(2, '0')]); if (--m < 1) { m = 12; y--; } }
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async ([yy, mm]) => {
      try {
        const r = await myntraClient.fetchInvoiceReport({ reportType: 'MONTHLY_REPORTS', year: yy, month: mm, reportName: 'PG_Forward_Settled' });
        const d = (r.body && r.body.data || [])[0]; if (!d || !d.reportPath) return;
        const csv = await fetchCsvUrl(d.reportPath);
        const iSid = csv.columns.indexOf('seller_order_id');
        const iDel = csv.columns.indexOf('delivery_date');
        const iPack = csv.columns.indexOf('packing_date');
        if (iSid >= 0) for (const row of csv.rows) { const v = stripQuote(row[iSid]); if (v && !map.has(v)) map.set(v, toISODate(row[iDel] || row[iPack])); }
      } catch { /* skip month */ }
    }));
  }
  if (map.size) settledIdsCache = { at: Date.now(), map }; // never cache a failed/empty fetch
  return map;
}

// Date + value + SKU for EVERY packed order (settled or not), from the Sales report —
// the only live source that dates completed orders, whose order-detail comes back empty.
// Lets "settled through / next awaiting" work once delivered orders age into Completed.
let packedMetaCache = null;
async function packedOrderMeta() {
  if (packedMetaCache && Date.now() - packedMetaCache.at < 10 * 60 * 1000) return packedMetaCache.map;
  const map = new Map();
  let y = new Date().getFullYear(), m = new Date().getMonth() + 1;
  const list = [];
  for (let i = 0; i < 12; i++) { list.push([String(y), String(m).padStart(2, '0')]); if (--m < 1) { m = 12; y--; } }
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async ([yy, mm]) => {
      try {
        const r = await myntraClient.fetchInvoiceReport({ reportType: 'MONTHLY_REPORTS', year: yy, month: mm, reportName: 'Sales_Revenue_Packed_B2C' });
        const d = (r.body && r.body.data || [])[0]; if (!d || !d.reportPath) return;
        const csv = await fetchCsvUrl(d.reportPath);
        const iSid = csv.columns.indexOf('Seller_Order_Id');
        const iDate = csv.columns.indexOf('Order_Created_Date');
        const iPack = csv.columns.indexOf('Packing_Date');
        const iAmt = csv.columns.indexOf('Total_Amount');
        const iSku = csv.columns.indexOf('SKU_Code');
        if (iSid >= 0) for (const row of csv.rows) { const v = stripQuote(row[iSid]); if (v && !map.has(v)) map.set(v, { date: toISODate(row[iDate] || row[iPack]), value: round2(Number(stripQuote(row[iAmt])) || 0), sku: stripQuote(row[iSku]) || '' }); }
      } catch { /* skip month */ }
    }));
  }
  if (map.size) packedMetaCache = { at: Date.now(), map }; // never cache a failed/empty fetch
  return map;
}

// Awaiting settlement — the Amazon "delivered, pending settlement" model, driven by the
// LIVE order list (same source as the Orders page). Delivered/completed orders that don't
// yet appear in any settlement report = money owed but not paid. Cached (it's expensive).
let awaitingCache = null;
router.get('/orders/api/financials/awaiting', dashboardGate, async (_req, res) => {
  try {
    if (awaitingCache && Date.now() - awaitingCache.at < 10 * 60 * 1000) return res.json({ ok: true, ...awaitingCache.data });
    // 1) All live orders (dedupe by sellerOrderId).
    const bySid = new Map();
    const collect = (body) => { for (const o of (body && body.data || [])) for (const l of (o.orderLines || [])) { const sid = l.sellerOrderId && String(l.sellerOrderId); if (sid && !bySid.has(sid)) { const dt = pickDate(l, o); bySid.set(sid, { sid, status: String(l.status || '').toUpperCase(), orderId: o.orderId, date: dt ? dt.toISOString().slice(0, 10) : null }); } } };
    const first = await myntraClient.fetchOrderList({ page: 0 });
    collect(first.body);
    const pages = Math.min((first.body && first.body.pages) || 1, 15);
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => myntraClient.fetchOrderList({ page: i + 1 })));
    rest.forEach((r) => collect(r.body));
    // Delivered/completed candidates (blank status = completed); exclude cancelled + in-progress.
    const done = [...bySid.values()].filter((l) => l.status === 'DL' || l.status === '' || l.status === 'C');
    // 2) Drop anything already in a settlement report.
    const [settled, packed] = await Promise.all([settledSellerOrderIds(), packedOrderMeta()]);
    const awaitingSids = done.filter((l) => !settled.has(l.sid));
    // Seed vendor→friendly from settled orders (their live detail usually still resolves), so a
    // completed awaiting order of the same style can be back-filled from its vendor code.
    await resolveSellerSkus([...settled.keys()]);
    for (const sid of settled.keys()) { const f = sellerSkuCache.get(sid); const m = packed.get(sid); if (f && m && m.sku) vendorToFriendly.set(m.sku, f); }
    // 3) Fetch detail (bounded) for value + SKU.
    const CAP = 120;
    const slice = awaitingSids.slice(0, CAP);
    const detailed = [];
    for (let i = 0; i < slice.length; i += 8) {
      await Promise.all(slice.slice(i, i + 8).map(async (l) => {
        const meta = packed.get(l.sid) || {};
        try {
          const d = await myntraClient.fetchOrderById(l.sid);
          const les = (d.body && d.body.orderLineEntries) || [];
          const value = les.reduce((s, x) => s + (Number(x.lineSellerFinalAmount) || 0), 0);
          const friendly = (les[0] && les[0].sku) || '';
          if (friendly && meta.sku) vendorToFriendly.set(meta.sku, friendly); // learn the mapping
          // Completed orders come back empty — fall back to the Sales report for date/value/SKU.
          detailed.push({ sellerOrderId: l.sid, orderId: String(l.orderId || ''), sku: friendly || meta.sku || '', vendorSku: meta.sku || '', value: round2(value > 0 ? value : (meta.value || 0)), status: l.status || 'C', invoiceDate: toISODate(les[0] && les[0].invoiceDate) || meta.date || l.date || null });
        } catch { detailed.push({ sellerOrderId: l.sid, orderId: String(l.orderId || ''), sku: meta.sku || '', vendorSku: meta.sku || '', value: meta.value || 0, status: l.status || 'C', invoiceDate: meta.date || l.date || null }); }
      }));
    }
    // Backfill vendor-code SKUs (completed orders) with the friendly name from any order of the
    // same style that resolved — this run or a prior month statement.
    for (const o of detailed) { if (o.sku && o.vendorSku && o.sku === o.vendorSku) { const f = vendorToFriendly.get(o.vendorSku); if (f) o.sku = f; } }
    detailed.sort((a, b) => b.value - a.value);
    // finalized-through = the boundary before the FIRST unsettled order (dashboardweb's
    // finalized_till_date rule: settled up to the day before the earliest still-open order).
    // Completed orders return no line detail, so their date comes from the live order LIST
    // (shipByTime/createdOn via pickDate) — without that fallback the boundary would wrongly
    // read "up to date" the moment delivered orders age into the Completed state.
    const awaitDates = detailed.map((x) => x.invoiceDate).filter((v) => v && /^\d{4}-\d{2}-\d{2}$/.test(v)).sort();
    const firstUnsettled = awaitDates[0] || null;
    let finalizedThrough = null;
    if (firstUnsettled) { const dt = new Date(firstUnsettled + 'T00:00:00'); if (!Number.isNaN(dt.getTime())) { dt.setDate(dt.getDate() - 1); finalizedThrough = dt.toISOString().slice(0, 10); } }

    // Per-month order lifecycle keyed by the order's OWN (delivery/invoice) date, not the
    // disbursement month — so "May" = every order from May with a settled/not-settled split.
    const byMonth = {};
    const bump = (mo, key, val) => { if (!/^\d{4}-\d{2}$/.test(mo || '')) return; const b = byMonth[mo] || (byMonth[mo] = { total: 0, settled: 0, awaiting: 0, awaitingValue: 0 }); b.total++; b[key]++; if (key === 'awaiting') b.awaitingValue = round2(b.awaitingValue + (val || 0)); };
    for (const [, dstr] of settled.entries()) bump((dstr || '').slice(0, 7), 'settled');
    for (const o of detailed) bump((o.invoiceDate || '').slice(0, 7), 'awaiting', o.value);

    const data = { awaiting: detailed, count: awaitingSids.length, shown: detailed.length, totalValue: round2(detailed.reduce((s, x) => s + x.value, 0)), settledOrders: settled.size, firstUnsettled, finalizedThrough, byMonth };
    if (settled.size) awaitingCache = { at: Date.now(), data }; // don't cache a run where the settled fetch failed
    return res.json({ ok: true, ...data });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message }); }
});

// Full monthly financial statement, built from the settlement reports: forward
// (PG_Forward_Settled — per order-line sales settlement with every fee, tax, and the
// expected/actual/pending split), reverse (PG_Reverse_Settled — returns), and
// Non_Order_Deduction_Settled. One call → the whole P&L for a month.
router.get('/orders/api/financials', dashboardGate, async (req, res) => {
  try {
    const year = String(req.query.year || '');
    const month = String(req.query.month || '');
    // month=all → aggregate every settlement month into one statement (rolling 12 months).
    const ALL = month === 'all';
    if (!ALL && (!/^\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month))) {
      return res.status(400).json({ ok: false, error: 'year (YYYY) and month (MM) are required.' });
    }
    const abs = (v) => Math.abs(toNum(v));
    const fetchReport = async (yy, mm, name) => {
      const r = await myntraClient.fetchInvoiceReport({ reportType: 'MONTHLY_REPORTS', year: yy, month: mm, reportName: name });
      const entry = (r.body && r.body.data || [])[0];
      if (!entry || !entry.reportPath) return { columns: [], rows: [], found: false };
      try { return { ...(await fetchCsvUrl(entry.reportPath)), found: true }; } catch { return { columns: [], rows: [], found: false }; }
    };
    async function loadReport(name) {
      if (!ALL) return fetchReport(year, month, name);
      // Concatenate rows across the rolling 12-month window — same columns each month, so the
      // rest of the handler aggregates the combined set exactly like a single month.
      let yy = new Date().getFullYear(), mm = new Date().getMonth() + 1;
      const months = [];
      for (let i = 0; i < 12; i++) { months.push([String(yy), String(mm).padStart(2, '0')]); if (--mm < 1) { mm = 12; yy--; } }
      const parts = await Promise.all(months.map(([y2, m2]) => fetchReport(y2, m2, name)));
      const hit = parts.filter((p) => p.found);
      if (!hit.length) return { columns: [], rows: [], found: false };
      return { columns: hit[0].columns, rows: hit.flatMap((p) => p.rows), found: true };
    }
    const mkGet = (cols) => { const idx = {}; cols.forEach((c, i) => { idx[String(c).trim()] = i; }); return (row, name) => (idx[name] != null ? row[idx[name]] : ''); };

    const [fwd, rev, nod] = await Promise.all([loadReport('PG_Forward_Settled'), loadReport('PG_Reverse_Settled'), loadReport('Non_Order_Deduction_Settled')]);

    // Forward settlement — per order line.
    const fg = mkGet(fwd.columns);
    const orders = fwd.rows.map((r) => {
      const sellerAmount = toNum(fg(r, 'seller_product_amount'));
      const netSettled = toNum(fg(r, 'total_actual_settlement'));
      return {
        orderId: stripQuote(fg(r, 'order_release_id')), sellerOrderId: stripQuote(fg(r, 'seller_order_id')),
        sku: stripQuote(fg(r, 'sku_code')), sellerSku: '',
        article: stripQuote(fg(r, 'article_type')) || 'Other', brand: stripQuote(fg(r, 'brand')),
        category: stripQuote(fg(r, 'product_tax_category')),
        customerPaid: round2(toNum(fg(r, 'customer_paid_amt'))),
        sellerAmount: round2(sellerAmount),
        commission: round2(abs(fg(r, 'total_commission_plus_tcs_tds_deduction'))),
        commissionBase: round2(abs(fg(r, 'total_commission'))),
        logistics: round2(abs(fg(r, 'total_logistics_deduction'))),
        shippingFee: round2(abs(fg(r, 'shipping_fee'))), fixedFee: round2(abs(fg(r, 'fixed_fee'))),
        pickPackFee: round2(abs(fg(r, 'pick_and_pack_fee'))), pgFee: round2(abs(fg(r, 'payment_gateway_fee'))),
        platformFees: round2(abs(fg(r, 'platform_fees'))),
        marketing: round2(abs(fg(r, 'marketingCharges_prepaid')) + abs(fg(r, 'marketingCharges_postpaid'))),
        tcs: round2(abs(fg(r, 'tcs_amount'))), tds: round2(abs(fg(r, 'tds_amount'))),
        igst: toNum(fg(r, 'igst_amount')), cgst: toNum(fg(r, 'cgst_amount')), sgst: toNum(fg(r, 'sgst_amount')),
        gst: round2(toNum(fg(r, 'igst_amount')) + toNum(fg(r, 'cgst_amount')) + toNum(fg(r, 'sgst_amount'))),
        taxable: round2(toNum(fg(r, 'taxable_amount'))),
        netSettled: round2(netSettled), pending: round2(toNum(fg(r, 'amount_pending_settlement'))),
        deliveredDate: stripQuote(fg(r, 'delivery_date')).slice(0, 10),
        packetId: stripQuote(fg(r, 'packet_id')), invoiceNumber: stripQuote(fg(r, 'invoice_number')),
        settlementUtr: stripQuote(fg(r, 'bank_utr_no_postpaid_payment')) || stripQuote(fg(r, 'bank_utr_no_prepaid_payment')),
        settlementDate: (stripQuote(fg(r, 'settlement_date_postpaid_payment')) || stripQuote(fg(r, 'settlement_date_prepaid_payment'))).slice(0, 10),
        cogs: 0, profit: 0, margin: 0,
      };
    });

    // Reverse settlement — returns.
    const rg = mkGet(rev.columns);
    const returns = rev.rows.map((r) => ({
      orderId: stripQuote(rg(r, 'order_release_id')), sellerOrderId: stripQuote(rg(r, 'seller_order_id')),
      sku: stripQuote(rg(r, 'sku_code')), sellerSku: '',
      article: stripQuote(rg(r, 'article_type')) || 'Other', returnType: stripQuote(rg(r, 'return_type')),
      returnDate: stripQuote(rg(r, 'return_date')).slice(0, 10),
      reverseAmount: round2(toNum(rg(r, 'total_actual_settlement'))),
      commission: round2(abs(rg(r, 'total_commission_plus_tcs_tds_deduction'))),
      logistics: round2(abs(rg(r, 'total_logistics_deduction'))),
    }));

    // Non-order deductions.
    const ng = mkGet(nod.columns);
    const nonOrder = nod.rows.map((r) => ({
      type: stripQuote(ng(r, 'Settlement_Type')), amount: round2(toNum(ng(r, 'Settlement_Amount'))),
      description: stripQuote(ng(r, 'Settlement_Description')), utr: stripQuote(ng(r, 'UTR')), date: stripQuote(ng(r, 'Settlement_Date')).slice(0, 10),
    }));

    // Attach friendly seller SKUs (for thumbnails) from the live orders, and COGS/profit.
    await resolveSellerSkus([...orders.map((o) => o.sellerOrderId), ...returns.map((r) => r.sellerOrderId)]);
    const cogsMap = loadCogs();
    const skuNum = (sku) => { const m = String(sku).match(/(\d+)\s*$/); return m ? m[1] : ''; };
    for (const o of orders) {
      o.sellerSku = sellerSkuCache.get(o.sellerOrderId) || '';
      if (o.sku && o.sellerSku) vendorToFriendly.set(o.sku, o.sellerSku); // learn vendor→friendly
      const cost = Number(cogsMap[o.sellerSku] ?? cogsMap[skuNum(o.sellerSku)]) || 0;
      o.cogs = round2(cost); o.profit = round2(o.netSettled - cost);
      o.margin = o.sellerAmount > 0 ? round2(o.profit / o.sellerAmount * 100) : 0;
    }
    for (const r of returns) r.sellerSku = sellerSkuCache.get(r.sellerOrderId) || '';

    const sum = (arr, f) => round2(arr.reduce((a, x) => a + f(x), 0));
    const sellerValue = sum(orders, (o) => o.sellerAmount);
    const netForward = sum(orders, (o) => o.netSettled);
    const grossCustomerPaid = sum(orders, (o) => o.customerPaid);
    const returnsAbs = sum(returns, (r) => Math.abs(r.reverseAmount));
    const nonOrderNet = sum(nonOrder, (n) => n.amount);
    const totalDeductions = round2(sellerValue - netForward);

    const byArticle = [...orders.reduce((m, o) => {
      const a = m.get(o.article) || { article: o.article, units: 0, sales: 0, netSettled: 0, deductions: 0 };
      a.units += 1; a.sales += o.sellerAmount; a.netSettled += o.netSettled; a.deductions += (o.sellerAmount - o.netSettled);
      return m.set(o.article, a), m;
    }, new Map()).values()].map((a) => ({
      ...a, sales: round2(a.sales), netSettled: round2(a.netSettled), deductions: round2(a.deductions),
      takeRate: a.sales > 0 ? round2((a.sales - a.netSettled) / a.sales * 100) : 0,
    })).sort((x, y) => y.sales - x.sales);

    const totalCogs = sum(orders, (o) => o.cogs);
    const cogsKnown = orders.some((o) => o.cogs > 0);
    const summary = {
      grossCustomerPaid, sellerValue, netForward,
      pending: sum(orders, (o) => o.pending),
      returns: returnsAbs, nonOrder: nonOrderNet,
      netReceivable: round2(netForward - returnsAbs + nonOrderNet),
      totalDeductions, takeRate: sellerValue > 0 ? round2(totalDeductions / sellerValue * 100) : 0,
      orderCount: orders.length, returnCount: returns.length,
      gst: sum(orders, (o) => o.gst), taxable: sum(orders, (o) => o.taxable),
      cogs: totalCogs, cogsKnown,
      grossProfit: round2(netForward - totalCogs),
      marginPct: sellerValue > 0 ? round2((netForward - totalCogs) / sellerValue * 100) : 0,
    };

    // Settlements grouped by the paying bank UTR (the "settlements timeline").
    const utrMap = new Map();
    for (const o of orders) {
      if (!o.settlementUtr) continue;
      const a = utrMap.get(o.settlementUtr) || { utr: o.settlementUtr, date: o.settlementDate, orders: 0, netSettled: 0 };
      a.orders += 1; a.netSettled += o.netSettled;
      utrMap.set(o.settlementUtr, a);
    }
    const settlements = [...utrMap.values()].map((a) => ({ ...a, netSettled: round2(a.netSettled) })).sort((x, y) => String(y.date).localeCompare(String(x.date)));
    const deductions = {
      commission: sum(orders, (o) => o.commissionBase),
      logistics: sum(orders, (o) => o.logistics),
      platformFees: sum(orders, (o) => o.platformFees),
      marketing: sum(orders, (o) => o.marketing),
      tcs: sum(orders, (o) => o.tcs), tds: sum(orders, (o) => o.tds),
    };
    const gstBreakdown = { igst: sum(orders, (o) => o.igst), cgst: sum(orders, (o) => o.cgst), sgst: sum(orders, (o) => o.sgst), tcs: sum(orders, (o) => o.tcs) };

    // Fee-type breakdown (for the % bars).
    const feeBreakdown = [
      { key: 'commission', label: 'Commission', amount: sum(orders, (o) => o.commissionBase) },
      { key: 'logistics', label: 'Logistics (total)', amount: sum(orders, (o) => o.logistics) },
      { key: 'shipping', label: '— Shipping fee', amount: sum(orders, (o) => o.shippingFee), sub: true },
      { key: 'fixed', label: '— Fixed fee', amount: sum(orders, (o) => o.fixedFee), sub: true },
      { key: 'pickpack', label: '— Pick & pack', amount: sum(orders, (o) => o.pickPackFee), sub: true },
      { key: 'pg', label: '— Payment gateway', amount: sum(orders, (o) => o.pgFee), sub: true },
      { key: 'platform', label: 'Platform fees', amount: sum(orders, (o) => o.platformFees) },
      { key: 'marketing', label: 'Marketing', amount: sum(orders, (o) => o.marketing) },
      { key: 'tcs', label: 'TCS', amount: sum(orders, (o) => o.tcs) },
      { key: 'tds', label: 'TDS', amount: sum(orders, (o) => o.tds) },
    ].filter((f) => f.amount > 0);

    // Per-SKU performance (join returns by SKU).
    const skuMap = new Map();
    for (const o of orders) {
      const key = o.sellerSku || o.sku;
      const a = skuMap.get(key) || { sku: key, vendorSku: o.sku, article: o.article, units: 0, sales: 0, netSettled: 0, deductions: 0, cogs: 0, profit: 0, returns: 0, returnUnits: 0 };
      a.units += 1; a.sales += o.sellerAmount; a.netSettled += o.netSettled; a.deductions += (o.sellerAmount - o.netSettled); a.cogs += o.cogs; a.profit += o.profit;
      skuMap.set(key, a);
    }
    for (const r of returns) { const a = skuMap.get(r.sellerSku || r.sku); if (a) { a.returns += Math.abs(r.reverseAmount); a.returnUnits += 1; } }
    const bySku = [...skuMap.values()].map((a) => ({
      ...a, sales: round2(a.sales), netSettled: round2(a.netSettled), deductions: round2(a.deductions), cogs: round2(a.cogs), profit: round2(a.profit), returns: round2(a.returns),
      takeRate: a.sales > 0 ? round2(a.deductions / a.sales * 100) : 0,
      margin: a.sales > 0 ? round2(a.profit / a.sales * 100) : 0,
      returnRate: a.units > 0 ? round2(a.returnUnits / a.units * 100) : 0,
    })).sort((x, y) => y.netSettled - x.netSettled);

    // Settled vs pending lifecycle.
    const settledO = orders.filter((o) => o.pending <= 0);
    const pendingO = orders.filter((o) => o.pending > 0);
    const lifecycle = {
      settledCount: settledO.length, pendingCount: pendingO.length,
      settledAmount: sum(settledO, (o) => o.netSettled), pendingAmount: sum(pendingO, (o) => o.pending),
      settledRate: orders.length ? round2(settledO.length / orders.length * 100) : 0,
    };

    // Daily series (by delivery / return date).
    const dayMap = new Map();
    const dayOf = (d) => { const a = dayMap.get(d) || { date: d, sales: 0, deductions: 0, net: 0, returns: 0 }; dayMap.set(d, a); return a; };
    for (const o of orders) { if (!o.deliveredDate) continue; const a = dayOf(o.deliveredDate); a.sales += o.sellerAmount; a.deductions += (o.sellerAmount - o.netSettled); a.net += o.netSettled; }
    for (const r of returns) { if (!r.returnDate) continue; dayOf(r.returnDate).returns += Math.abs(r.reverseAmount); }
    const daily = [...dayMap.values()].map((a) => ({ date: a.date, sales: round2(a.sales), deductions: round2(a.deductions), net: round2(a.net), returns: round2(a.returns) })).sort((x, y) => x.date.localeCompare(y.date));

    // Root-cause insights (SmartCommerce parity).
    const insights = [];
    if (summary.takeRate > 25) insights.push({ tone: 'warning', title: 'High marketplace take-rate', detail: `Myntra kept ${summary.takeRate}% of sales value this month.` });
    if (summary.orderCount > 0) { const rr = round2(summary.returnCount / summary.orderCount * 100); if (rr >= 15) insights.push({ tone: 'warning', title: 'Elevated returns', detail: `${rr}% of orders returned (${summary.returnCount}/${summary.orderCount}).` }); }
    if (summary.pending > 0) insights.push({ tone: 'info', title: 'Money awaiting disbursal', detail: `Rs ${summary.pending} is settled but not yet paid out.` });
    if (!cogsKnown) insights.push({ tone: 'info', title: 'COGS not set', detail: 'Enter cost per SKU to unlock real profit & margin.' });
    else { const loss = bySku.filter((sk) => sk.profit < 0).sort((a, b) => a.profit - b.profit)[0]; if (loss) insights.push({ tone: 'critical', title: `Loss-making: ${loss.sku}`, detail: `Net Rs ${loss.netSettled} vs COGS Rs ${loss.cogs} = Rs ${loss.profit}.` }); }

    return res.json({
      ok: true, year, month,
      found: { forward: fwd.found, reverse: rev.found, nonOrder: nod.found },
      summary, deductions, gstBreakdown, feeBreakdown, lifecycle, daily, settlements, insights, byArticle, bySku,
      orders: orders.sort((a, b) => b.netSettled - a.netSettled),
      returns, nonOrder,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// ───────── Inbox: orders & returns Myntra PUSHED to our webhook (local store) ─────────
// Real-time work queue, independent of getOrderList. Status-change actions still hit the
// live Myntra API (these are real Myntra orders) via /orders/api/action.
router.get('/orders/api/inbox/list', dashboardGate, async (req, res) => {
  const wanted = req.query.statusCode ? String(req.query.statusCode).toUpperCase() : null;
  let kept = [];
  try { kept = await resolveInbox(); } catch { /* fall back to an empty inbox on error */ }
  // Map of the resolved (authoritative) status per kept order, for display.
  const codeMap = new Map(kept.map((k) => [String(k.o.sellerOrderId), k.code]));
  const orders = [];
  for (const { o } of kept) {
    const s = inboxSummary(o, codeMap);
    if (wanted && s.orderLines[0] && s.orderLines[0].status !== wanted) continue;
    orders.push(s);
  }
  res.json({ ok: true, page: 0, totalCount: orders.length, pages: 1, orders });
});

router.get('/orders/api/inbox/detail/:sellerOrderId', dashboardGate, async (req, res) => {
  const o = db.orders.get(req.params.sellerOrderId);
  if (!o || !isPush(o)) return res.json({ ok: false, error: 'Order not found in inbox' });
  let inProg = new Map();
  try { inProg = await inProgressStatusMap(); } catch { /* fall back to cached webhook status */ }
  res.json({ ok: true, detail: inboxDetail(o, inProg) });
});

// Inbox documents are served from the LOCAL store (these packets aren't in Myntra).
function findByPacket(packetId) {
  const p = db.packets.get(packetId);
  if (p && db.orders.has(p.sellerOrderId)) { const o = db.orders.get(p.sellerOrderId); if (isPush(o)) return o; }
  for (const o of db.orders.values()) { if (isPush(o) && o.packetId === packetId) return o; }
  return null;
}
function sendInboxPdf(res, kind, packetId) {
  const o = findByPacket(packetId);
  if (!o) return res.status(404).json({ ok: false, error: 'No packet for this order in inbox' });
  const r = o.receiver || {};
  const l = lines(o)[0] || {};
  const tax = (l.taxEntries && l.taxEntries[0]) || {};
  const pdf = kind === 'label'
    ? buildPdf('MYNTRA — Shipping Label', [
      `Packet: ${o.packetId}`, `Tracking: ${o.trackingNumber || '—'}  (${o.courier || '—'})`,
      `Order: ${o.sellerOrderId}`, '',
      `Deliver to: ${r.receiverName || '—'}`, `${r.address || ''}, ${r.locality || ''}`,
      `${r.city || ''}, ${r.stateName || r.state || ''} ${r.zipcode || ''}`, `${r.country || ''}   Ph: ${r.mobile || ''}`,
      '', `SKU: ${l.sku || '—'}   Qty: ${l.quantity ?? 1}`, `Warehouse: ${l.warehouse || o.warehouse || '—'}`,
    ])
    : buildPdf('Tax Invoice', [
      `Invoice No: ${l.invoiceNumber || '—'}    Date: ${l.invoiceDate || '—'}`,
      `Order: ${o.sellerOrderId}    Packet: ${o.packetId}`, '',
      `Item: ${l.sku || '—'}`, `Amount: INR ${l.lineFinalAmount ?? '—'}`,
      `${tax.taxType || 'GST'} @ ${tax.taxRate || 0}%: INR ${tax.unitTaxAmount ?? '—'}`,
      '', 'Seller: EXPERIENCES.DIGITAL PRIVATE LIMITED',
    ]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${kind}_${packetId}.pdf"`);
  return res.send(pdf);
}
router.get('/orders/api/inbox/label/:packetId', dashboardGate, (req, res) => sendInboxPdf(res, 'label', req.params.packetId));
router.get('/orders/api/inbox/invoice/:packetId', dashboardGate, (req, res) => sendInboxPdf(res, 'invoice', req.params.packetId));

router.get('/orders/api/inbox/returns', dashboardGate, (_req, res) => {
  const returns = [];
  for (const r of db.returns.values()) {
    returns.push({
      id: r.id, type: r.type || null, status: r.status || null,
      sellerOrderId: r.sellerOrderId || null, orderLineId: r.orderLineId || null,
      trackingNumber: r.trackingNumber || null, reason: r.reason || null,
      returnWarehouseCode: r.returnWarehouseCode || null, createdOn: r.createdOn || null,
    });
  }
  res.json({ ok: true, totalCount: returns.length, returns });
});

// Full detail for one pushed return (everything Myntra sent + our status history).
router.get('/orders/api/inbox/return/:id', dashboardGate, (req, res) => {
  const r = db.returns.get(req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: 'Return not found' });
  res.json({ ok: true, return: r });
});

// Live return detail from Myntra (Returns Recon by id). Surfaces Myntra's real status.
router.get('/orders/api/return-details/:id', dashboardGate, async (req, res) => {
  try {
    const { status, body } = await myntraClient.fetchReturnDetails(req.params.id);
    const data = Array.isArray(body.data) ? body.data : [];
    return res.status(200).json({
      ok: status === 200 && body.statusType !== 'ERROR',
      httpStatus: status,
      statusCode: body.statusCode ?? null,
      message: body.statusMessage || body.message || null,
      detail: data[0] || null,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;
