const env = {
  port: Number(process.env.PORT || 3000),
  idempotencyTtlMs: Number(process.env.IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000),
  logBody: process.env.LOG_BODY === 'true',
  webhookToken: process.env.MYNTRA_WEBHOOK_TOKEN || '',
  webhookTokenExpiry: process.env.MYNTRA_WEBHOOK_TOKEN_EXPIRY || '',
  tokenAllowlistJson: process.env.MYNTRA_ACCESS_TOKENS_JSON || '',
  tokenSigningSecret: process.env.MYNTRA_TOKEN_SIGNING_SECRET || 'change-me-in-prod-signing-secret',
  tokenIssuer: process.env.MYNTRA_TOKEN_ISSUER || 'myntra',
  tokenClockSkewSec: Number(process.env.MYNTRA_TOKEN_CLOCK_SKEW_SEC || 30),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 1900),
};

module.exports = env;
