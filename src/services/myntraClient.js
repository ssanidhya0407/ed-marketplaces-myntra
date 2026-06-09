const AppError = require('../errors/AppError');
const env = require('../config/env');

// Client for Myntra's real Seller API (api-integration.myntra.com).
// Auth flow per myntradeveloper.md: generate_token with secret_key + merchant_id,
// then send access_token + x-partner-store headers on every call.

let cachedToken = null; // { accessToken, refreshToken, expiresAtMs }

function assertConfigured() {
  if (!env.myntraMerchantId || !env.myntraSecretKey) {
    throw new AppError(
      2006,
      'Myntra credentials not configured. Set MYNTRA_MERCHANT_ID and MYNTRA_SECRET_KEY.',
    );
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_error) {
    body = { raw: text };
  }
  return { status: response.status, body, headers: response.headers };
}

// JWT exp claim (seconds) -> ms, so we can refresh just before Myntra expires the token.
function jwtExpiryMs(token) {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (payload && Number.isFinite(Number(json.exp))) return Number(json.exp) * 1000;
  } catch (_error) {
    // fall through to default below
  }
  return null;
}

async function generateToken() {
  assertConfigured();
  const { status, body, headers } = await requestJson(`${env.myntraApiBase}/authorization/generate_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      secret_key: env.myntraSecretKey,
    },
    body: JSON.stringify({ merchant_id: env.myntraMerchantId }),
  });

  // Myntra returns the JWT in the access_token RESPONSE HEADER, not the body.
  const accessToken = headers.get('access_token');
  const refreshToken = headers.get('refresh_token');

  if (status !== 200 || !accessToken) {
    throw new AppError(2006, `Myntra token generation failed (HTTP ${status}): ${body.statusMessage || body.message || 'unknown error'}`);
  }

  const expFromJwt = jwtExpiryMs(accessToken);
  cachedToken = {
    accessToken,
    refreshToken: refreshToken || null,
    // Refresh 60s before the JWT's own expiry; default to 55 minutes if it can't be read.
    expiresAtMs: (expFromJwt || Date.now() + 3300 * 1000) - 60 * 1000,
  };
  return cachedToken;
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs) {
    return cachedToken.accessToken;
  }
  const token = await generateToken();
  return token.accessToken;
}

async function myntraGet(path, query) {
  const accessToken = await getAccessToken();
  const url = new URL(`${env.myntraApiBase}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const { status, body } = await requestJson(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      access_token: accessToken,
      'x-partner-store': env.myntraPartnerStore,
    },
  });

  if (status === 401) {
    // Token may have been revoked server-side; force one refresh and retry.
    cachedToken = null;
    const retryToken = await getAccessToken();
    const retry = await requestJson(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        access_token: retryToken,
        'x-partner-store': env.myntraPartnerStore,
      },
    });
    return retry;
  }

  return { status, body };
}

// Order Search (myntradeveloper.md): GET /partner/v4/order/getOrderList
function fetchOrderList({ page = 0, statusCode, startDate, endDate } = {}) {
  return myntraGet('/partner/v4/order/getOrderList', { page, statusCode, startDate, endDate });
}

function fetchOrderById(sellerOrderId) {
  return myntraGet(`/partner/v4/order/${encodeURIComponent(sellerOrderId)}`);
}

module.exports = {
  generateToken,
  fetchOrderList,
  fetchOrderById,
};
