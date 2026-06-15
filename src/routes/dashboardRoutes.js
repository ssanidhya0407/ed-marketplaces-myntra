const express = require('express');
const path = require('path');

const env = require('../config/env');
const myntraClient = require('../services/myntraClient');
const db = require('../db/mockDb');
const { buildPdf } = require('../utils/miniPdf');

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

// Live summary status is blank for completed/closed orders; treat blank as "no live
// signal" and keep the cached value in that case.
const reconciled = (o, live, cached) => {
  const liveCode = live && live.get(String(o.sellerOrderId));
  return liveCode ? liveCode : cached;
};

// The Inbox only holds orders that are still in progress — newly pushed (RFR) or
// accepted/awaiting dispatch (WP). The moment an order moves out of that state
// (packed/shipped/delivered/cancelled/completed) it drops out of the Inbox.
const IN_PROGRESS = new Set(['RFR', 'WP']);
function isInboxInProgress(o, live) {
  if (lines(o).some((l) => l.cancelled)) return false;
  return IN_PROGRESS.has(reconciled(o, live, INTERNAL_TO_CODE[o.status] || o.status));
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

// Optional light gate: if DASHBOARD_KEY is set, the page/API require ?key=<value>.
// Left open by default so the warehouse team can just open the URL.
function dashboardGate(req, res, next) {
  if (!env.dashboardKey) return next();
  if (req.query.key && req.query.key === env.dashboardKey) return next();
  return res.status(401).json({ error: 'Unauthorized. Append ?key=<dashboard key> to the URL.' });
}

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
    let live = new Map();
    try { live = await liveStatusMap(); } catch { /* fall back to cached status */ }
    let inboxOrders = 0;
    for (const o of db.orders.values()) {
      if (isPush(o) && isInboxInProgress(o, live)) inboxOrders += 1;
    }
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
      returns.push({
        id: r.id, sellerOrderId: r.sellerOrderId || null,
        sku: line ? line.sku : null, category: line ? line.category : null,
        value: line ? round(line.gross) : 0, type: r.type || null,
        reason: r.reason || null, status: r.status || null, createdOn: r.createdOn || null,
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
      for (const l of o.lines) {
        const s = skuAgg[l.sku] || (skuAgg[l.sku] = { sku: l.sku, category: l.category, units: 0, revenue: 0, gross: 0, tax: 0, settlement: 0, cancelledUnits: 0, returnedUnits: 0, orders: new Set() });
        s.gross += l.gross;
        if (l.cancelled) s.cancelledUnits += l.qty;
        else { s.units += l.qty; s.revenue += l.gross; s.tax += l.tax; s.settlement += l.settlement; s.orders.add(o.sid); }
      }
    }
    for (const r of returns) if (r.sku && skuAgg[r.sku]) skuAgg[r.sku].returnedUnits += 1;

    const grossSales = orders.reduce((s, o) => s + sumBy(o, (l) => l.gross), 0);
    const cancelledValue = orders.reduce((s, o) => s + sumBy(o, (l) => l.gross, (l) => l.cancelled), 0);
    const returnValue = returns.reduce((s, r) => s + (r.value || 0), 0);
    const taxCollected = orders.reduce((s, o) => s + sumBy(o, (l) => l.tax, (l) => !l.cancelled), 0);
    const sellerSettlement = orders.reduce((s, o) => s + sumBy(o, (l) => l.settlement, (l) => !l.cancelled), 0);
    const unitsSold = orders.reduce((s, o) => s + sumBy(o, (l) => l.qty, (l) => !l.cancelled), 0);
    const netSales = grossSales - cancelledValue - returnValue;
    const ordersCount = orders.length;
    const cancelledOrders = orders.filter((o) => o.lines.length && o.lines.every((l) => l.cancelled)).length;
    const returnCount = returns.length;
    const totalCurrentStock = Object.values(stock).reduce((a, b) => a + b, 0);
    const totalRev = Object.values(skuAgg).reduce((a, s) => a + s.revenue, 0) || 1;

    const bySku = Object.values(skuAgg).map((s) => {
      const velocity = s.units / windowDays;
      const cur = stock[s.sku] != null ? stock[s.sku] : null;
      return {
        sku: s.sku, category: s.category, units: s.units, orders: s.orders.size,
        revenue: round(s.revenue), tax: round(s.tax), settlement: round(s.settlement),
        avgPrice: s.units ? round(s.revenue / s.units) : 0,
        contributionPct: round((s.revenue / totalRev) * 100, 1),
        cancelledUnits: s.cancelledUnits, returnedUnits: s.returnedUnits,
        returnRate: s.units ? round((s.returnedUnits / s.units) * 100, 1) : 0,
        currentStock: cur, velocity: round(velocity, 2),
        daysOfInventory: (cur != null && velocity > 0) ? round(cur / velocity, 1) : null,
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
    const revenueByMonth = bucket((d) => d.toISOString().slice(0, 7))
      .map((b, i, arr) => ({ ...b, growthPct: (i > 0 && arr[i - 1].revenue) ? round(((b.revenue - arr[i - 1].revenue) / arr[i - 1].revenue) * 100, 1) : null }));

    const sold = bySku.filter((s) => s.units > 0);
    const topSkus = sold.slice(0, 10);
    const bottomSkus = [...sold].sort((a, b) => a.revenue - b.revenue).slice(0, 10);
    const fastMoving = [...sold].sort((a, b) => b.velocity - a.velocity).slice(0, 10);
    const slowMoving = [...sold].sort((a, b) => a.velocity - b.velocity).slice(0, 10);
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
        ordersCount, unitsSold, aov: round(ordersCount ? netSales / ordersCount : 0),
        itemsPerOrder: round(ordersCount ? unitsSold / ordersCount : 0, 2),
        cancelledOrders, cancelRate: round(ordersCount ? (cancelledOrders / ordersCount) * 100 : 0, 1),
        returnCount, returnedUnits: returnCount, returnRate: round(unitsSold ? (returnCount / unitsSold) * 100 : 0, 1),
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
        'Order timestamps use Myntra’s ship-by time — the API returns no explicit order-creation field.',
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

// ───────── Inbox: orders & returns Myntra PUSHED to our webhook (local store) ─────────
// Real-time work queue, independent of getOrderList. Status-change actions still hit the
// live Myntra API (these are real Myntra orders) via /orders/api/action.
router.get('/orders/api/inbox/list', dashboardGate, async (req, res) => {
  const wanted = req.query.statusCode ? String(req.query.statusCode).toUpperCase() : null;
  let live = new Map();
  try { live = await liveStatusMap(); } catch { /* fall back to cached webhook status */ }
  const orders = [];
  for (const o of db.orders.values()) {
    if (!isPush(o)) continue;
    // Only keep orders that are still in progress; clear the rest from the Inbox.
    if (!isInboxInProgress(o, live)) continue;
    const s = inboxSummary(o, live);
    if (wanted && s.orderLines[0] && s.orderLines[0].status !== wanted) continue;
    orders.push(s);
  }
  res.json({ ok: true, page: 0, totalCount: orders.length, pages: 1, orders });
});

router.get('/orders/api/inbox/detail/:sellerOrderId', dashboardGate, async (req, res) => {
  const o = db.orders.get(req.params.sellerOrderId);
  if (!o || !isPush(o)) return res.json({ ok: false, error: 'Order not found in inbox' });
  let live = new Map();
  try { live = await liveStatusMap(); } catch { /* fall back to cached webhook status */ }
  res.json({ ok: true, detail: inboxDetail(o, live) });
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
