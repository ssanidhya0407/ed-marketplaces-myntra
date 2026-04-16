const { hashPayload } = require('../utils/hash');

function cleanupExpired(store, ttlMs) {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (now - value.storedAt > ttlMs) {
      store.delete(key);
    }
  }
}

function idempotencyMiddleware(store, ttlMs) {
  return (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    cleanupExpired(store, ttlMs);

    const headerKey = req.headers['x-idempotency-key'];
    const fallbackKey = `${req.method}:${req.originalUrl}:${hashPayload(req.body || {})}`;
    const key = headerKey || fallbackKey;

    req.idempotencyKey = key;
    req.idempotencyStore = store;

    const cached = store.get(key);
    if (cached) {
      res.setHeader('x-idempotency-replay', 'true');
      return res.status(cached.status).json(cached.body);
    }

    return next();
  };
}

module.exports = idempotencyMiddleware;
