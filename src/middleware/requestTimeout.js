const { createError } = require('../services/responseService');

function requestTimeoutMiddleware(timeoutMs) {
  return (req, res, next) => {
    // The warehouse dashboard proxies live Myntra calls (token-gen + fetch can
    // exceed the tight inbound SLA), so it manages its own latency budget.
    if (req.path.startsWith('/orders')) return next();

    const timer = setTimeout(() => {
      if (res.headersSent) return;
      const mapped = createError(2000, 'Request timeout');
      res.status(mapped.httpStatus).json(mapped.body);
    }, timeoutMs);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    return next();
  };
}

module.exports = requestTimeoutMiddleware;
