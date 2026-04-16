const AppError = require('../errors/AppError');

function partnerStoreHeaderMiddleware(req, _res, next) {
  const partnerStore = req.headers['x-partner-store'];
  if (!partnerStore || typeof partnerStore !== 'string' || !partnerStore.trim()) {
    return next(new AppError(2006, 'x-partner-store header is required'));
  }
  req.partnerStore = partnerStore.trim();
  return next();
}

module.exports = partnerStoreHeaderMiddleware;
