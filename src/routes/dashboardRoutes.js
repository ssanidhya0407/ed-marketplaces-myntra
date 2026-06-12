const express = require('express');
const path = require('path');

const env = require('../config/env');
const myntraClient = require('../services/myntraClient');

const router = express.Router();

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

module.exports = router;
