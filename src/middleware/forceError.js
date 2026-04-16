const AppError = require('../errors/AppError');

function forceErrorMiddleware(req, _res, next) {
  const code = Number(req.query.errorCode || req.headers['x-force-error-code']);
  if (Number.isFinite(code) && code > 0) {
    return next(new AppError(code));
  }
  return next();
}

module.exports = forceErrorMiddleware;
