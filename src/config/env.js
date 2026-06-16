const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dependency). Loads <repo>/.env if present and only
// fills vars that aren't already set in the real environment (docker -e wins).
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (_error) {
    // A malformed .env must never crash the service; ignore and use real env.
  }
})();

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
  corsAllowOrigin: process.env.CORS_ALLOW_ORIGIN || '*',
  // Outbound PULL credentials for Myntra's real Seller API (api-integration.myntra.com).
  myntraApiBase: process.env.MYNTRA_API_BASE || 'https://api-integration.myntra.com',
  myntraMerchantId: process.env.MYNTRA_MERCHANT_ID || '',
  myntraSecretKey: process.env.MYNTRA_SECRET_KEY || '',
  myntraPartnerStore: process.env.MYNTRA_PARTNER_STORE || 'MYNTRA',
  // Optional shared key to gate the warehouse orders dashboard (empty = open access).
  dashboardKey: process.env.DASHBOARD_KEY || '',
  // Single shared email/password login for the dashboard. When all three are set,
  // the dashboard requires sign-in; the same secret is used by the frontend to
  // verify the session cookie. See src/middleware/dashboardAuth.js.
  sessionSecret: process.env.OMS_SESSION_SECRET || '',
  authEmail: process.env.OMS_AUTH_EMAIL || '',
  authPasswordHash: process.env.OMS_AUTH_PASSWORD_HASH || '',
  // Push target: dashboardweb's authenticated Myntra ingest endpoint. The OMS is
  // the only system that can talk to Myntra, so it pushes normalized orders/returns
  // to dashboardweb (stored alongside Amazon/Flipkart/Meesho).
  dashboardIngestUrl: process.env.DASHBOARDWEB_INGEST_URL || '',
  dashboardIngestKey: process.env.DASHBOARDWEB_INGEST_KEY || '',
};

module.exports = env;
