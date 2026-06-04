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
  return { status: response.status, body };
}

async function generateToken() {
  assertConfigured();
  const { status, body } = await requestJson(`${env.myntraApiBase}/authorization/generate_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      secret_key: env.myntraSecretKey,
    },
    body: JSON.stringify({ merchant_id: env.myntraMerchantId }),
  });

  if (status !== 200 || !body.access_token) {
    throw new AppError(2006, `Myntra token generation failed (HTTP ${status}): ${body.statusMessage || body.message || 'unknown error'}`);
  }

  cachedToken = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    // Refresh 60s before expiry; default to 55 minutes when expires_in is absent.
    expiresAtMs: Date.now() + (Number(body.expires_in) || 3300) * 1000 - 60 * 1000,
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
      'x-partner-store': 'MYNTRA',
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
        'x-partner-store': 'MYNTRA',
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
