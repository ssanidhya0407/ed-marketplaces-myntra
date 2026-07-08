const { sendSuccess } = require('../services/responseService');
const orderService = require('../services/orderService');
const { notifyOrderEvent } = require('../services/dashboardNotify');

function createOrder(req, res, next) {
  try {
    const result = orderService.createOrder(req.validated);
    // A new order landed — nudge dashboardweb to deduct shared stock in real time
    // (fire-and-forget; never blocks or fails the ack we owe Myntra).
    notifyOrderEvent(req.params.sellerOrderId, 'create');
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  } catch (err) {
    return next(err);
  }
}

function updateOrder(req, res, next) {
  try {
    const result = orderService.updateOrder(req.validated);
    // Status change (incl. cancellations) — same real-time nudge; dashboardweb
    // re-reads the order and restores stock if it was cancelled.
    notifyOrderEvent(req.params.sellerOrderId, req.params.eventType || 'update');
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  } catch (err) {
    return next(err);
  }
}

function updatePacket(req, res, next) {
  try {
    const result = orderService.updatePacket(req.validated);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  } catch (err) {
    return next(err);
  }
}

function downloadInvoice(req, res, next) {
  try {
    const result = orderService.downloadInvoice(req.validated);
    if (result.pdf) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="invoice_${result.packetId}.pdf"`);
      return res.send(result.pdf);
    }
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  } catch (err) {
    return next(err);
  }
}

function getOrderById(req, res, next) {
  try {
    const result = orderService.getOrderById(req.validated);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  } catch (err) {
    return next(err);
  }
}

function getPacketById(req, res, next) {
  try {
    const result = orderService.getPacketById(req.validated);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createOrder,
  updateOrder,
  updatePacket,
  downloadInvoice,
  getOrderById,
  getPacketById,
};
