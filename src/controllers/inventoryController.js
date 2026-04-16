const { sendSuccess } = require('../services/responseService');
const inventoryService = require('../services/inventoryService');

function failureInventoryUpdate(req, res, next) {
  try {
    const code = inventoryService.recordFailureInventory(req.validated);
    return sendSuccess(req, res, code);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  failureInventoryUpdate,
};
