const { sendSuccess } = require('../services/responseService');
const orderService = require('../services/orderService');

function createOrder(req, res, next) {
  try {
    const result = orderService.createOrder(req.validated);
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
  downloadInvoice,
  getOrderById,
  getPacketById,
};
