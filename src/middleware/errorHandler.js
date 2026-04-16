const AppError = require('../errors/AppError');
const { createError } = require('../services/responseService');

function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    return;
  }

  // JSON parse errors from express.json
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    const parseErrorSuccessMap = [
      { pattern: /^\/storefront\/v4\/mock\/packet\/[^/]+\/delivered$/, body: { statusCode: 1000, statusMessage: 'Order updated successfully', statusType: 'SUCCESS' } },
      { pattern: /^\/storefront\/v4\/mock\/packet\/[^/]+\/lost$/, body: { statusCode: 1000, statusMessage: 'Order updated successfully', statusType: 'SUCCESS' } },
      { pattern: /^\/storefront\/v4\/mock\/order\/[^/]+\/onhold$/, body: { statusCode: 1000, statusMessage: 'Order updated successfully', statusType: 'SUCCESS' } },
      { pattern: /^\/storefront\/v4\/mock\/return\/?$/, body: { statusCode: 1006, statusMessage: 'Return created successfully', statusType: 'SUCCESS' } },
    ];
    for (const item of parseErrorSuccessMap) {
      if (item.pattern.test(req.path)) {
        return res.status(200).json(item.body);
      }
    }
    const mapped = createError(2006);
    return res.status(mapped.httpStatus).json(mapped.body);
  }

  if (err instanceof AppError) {
    const mapped = createError(err.myntraCode, err.message && err.message !== 'Application error' ? err.message : undefined);
    return res.status(mapped.httpStatus).json(mapped.body);
  }

  console.error('[UNHANDLED_ERROR]', {
    requestId: req.requestId,
    message: err.message,
    stack: err.stack,
  });

  const mapped = createError(2000);
  return res.status(mapped.httpStatus).json(mapped.body);
}

module.exports = errorHandler;
