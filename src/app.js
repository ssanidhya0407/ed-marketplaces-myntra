const express = require('express');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const routes = require('./routes');
const db = require('./db/mockDb');
const authMiddleware = require('./middleware/auth');
const loggingMiddleware = require('./middleware/logging');
const idempotencyMiddleware = require('./middleware/idempotency');
const forceErrorMiddleware = require('./middleware/forceError');
const notFoundHandler = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const partnerStoreHeaderMiddleware = require('./middleware/partnerStore');
const requestTimeoutMiddleware = require('./middleware/requestTimeout');

const app = express();
const AUTH_BYPASS_PATHS = new Set(['/health', '/authorization/generate_token', '/authorization/refresh_token']);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(requestTimeoutMiddleware(env.requestTimeoutMs));

app.use(loggingMiddleware(env));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

const auth = authMiddleware(env);
app.use((req, res, next) => {
  if (AUTH_BYPASS_PATHS.has(req.path)) return next();
  return auth(req, res, next);
});
app.use((req, res, next) => {
  if (AUTH_BYPASS_PATHS.has(req.path)) return next();
  return partnerStoreHeaderMiddleware(req, res, next);
});

app.use(idempotencyMiddleware(db.idempotency, env.idempotencyTtlMs));

app.use(forceErrorMiddleware);
app.use(routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
