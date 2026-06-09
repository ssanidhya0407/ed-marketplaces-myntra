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

router.get('/orders/api/status-labels', (_req, res) => res.json(STATUS_LABELS));

module.exports = router;
