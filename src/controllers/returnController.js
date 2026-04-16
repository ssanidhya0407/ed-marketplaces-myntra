const { sendSuccess } = require('../services/responseService');
const returnService = require('../services/returnService');

function createReturn(req, res, next) {
  try {
    const result = returnService.createReturn(req.validated);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  } catch (err) {
    return next(err);
  }
}

function updateReturn(req, res, next) {
  try {
    const result = returnService.updateReturn(req.validated);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createReturn,
  updateReturn,
};
