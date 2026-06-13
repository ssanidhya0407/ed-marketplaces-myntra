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

function inboxSummary(o) {
  return {
    orderId: o.sellerOrderId,
    orderLines: lines(o).map((l) => ({
      orderLineId: String(l.orderLineId),
      sellerOrderId: o.sellerOrderId,
      status: l.cancelled ? 'IC' : (INTERNAL_TO_CODE[o.status] || o.status),
    })),
  };
}
function inboxDetail(o) {
  const code = INTERNAL_TO_CODE[o.status] || o.status;
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
    return res.json({
      ok: true,
      total,
      byStatus,
      inboxOrders: db.orders.size,
      returns: db.returns.size,
    });
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
router.get('/orders/api/inbox/list', dashboardGate, (req, res) => {
  const wanted = req.query.statusCode ? String(req.query.statusCode).toUpperCase() : null;
  const orders = [];
  for (const o of db.orders.values()) {
    if (!isPush(o)) continue;
    const s = inboxSummary(o);
    if (wanted && s.orderLines[0] && s.orderLines[0].status !== wanted) continue;
    orders.push(s);
  }
  res.json({ ok: true, page: 0, totalCount: orders.length, pages: 1, orders });
});

router.get('/orders/api/inbox/detail/:sellerOrderId', dashboardGate, (req, res) => {
  const o = db.orders.get(req.params.sellerOrderId);
  if (!o || !isPush(o)) return res.json({ ok: false, error: 'Order not found in inbox' });
  res.json({ ok: true, detail: inboxDetail(o) });
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
