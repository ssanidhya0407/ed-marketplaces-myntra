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

// GET returning the raw bytes (for PDF documents like labels / invoices).
async function myntraRaw(path) {
  const accessToken = await getAccessToken();
  const doFetch = (token) =>
    fetch(`${env.myntraApiBase}${path}`, {
      method: 'GET',
      headers: { access_token: token, 'x-partner-store': env.myntraPartnerStore },
    });

  let response = await doFetch(accessToken);
  if (response.status === 401) {
    cachedToken = null;
    response = await doFetch(await getAccessToken());
  }
  const contentType = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, contentType, buffer };
}

// Generic mutating call (PUT/POST) with JSON body + one 401 refresh+retry.
async function myntraSend(method, path, jsonBody) {
  const accessToken = await getAccessToken();
  const opts = (token) => ({
    method,
    headers: {
      'Content-Type': 'application/json',
      access_token: token,
      'x-partner-store': env.myntraPartnerStore,
    },
    body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
  });

  let res = await requestJson(`${env.myntraApiBase}${path}`, opts(accessToken));
  if (res.status === 401) {
    cachedToken = null;
    res = await requestJson(`${env.myntraApiBase}${path}`, opts(await getAccessToken()));
  }
  return { status: res.status, body: res.body };
}

// ---- Reads ----
// Order Search (myntradeveloper.md): GET /partner/v4/order/getOrderList
function fetchOrderList({ page = 0, statusCode, startDate, endDate } = {}) {
  return myntraGet('/partner/v4/order/getOrderList', { page, statusCode, startDate, endDate });
}

function fetchOrderById(sellerOrderId) {
  return myntraGet(`/partner/v4/order/${encodeURIComponent(sellerOrderId)}`);
}

function fetchPacketById(packetId) {
  return myntraGet(`/partner/v4/packet/${encodeURIComponent(packetId)}`);
}

// Invoice details (JSON, not the PDF): GET /partner/v4/packet/:packetId/getInvoiceDetails/
// Returns 2050 "Order is not marked RTD yet" until the packet has been dispatched.
function fetchInvoiceDetails(packetId) {
  return myntraGet(`/partner/v4/packet/${encodeURIComponent(packetId)}/getInvoiceDetails/`);
}

// Returns Recon: POST /partner/v4/returns/returnRecon. Same endpoint serves both a
// date-range search and a single-return detail (just send { id }).
function searchReturns({ startDate, endDate, destinationWarehouseIds, page = 0, returnType } = {}) {
  return myntraSend('POST', '/partner/v4/returns/returnRecon', {
    startDate, endDate, destinationWarehouseIds, page, returnType,
  });
}

function fetchReturnDetails(id) {
  return myntraSend('POST', '/partner/v4/returns/returnRecon', { id });
}

// ---- Documents (raw PDF) ----
function fetchShippingLabel(packetId) {
  return myntraRaw(`/partner/v4/packet/${encodeURIComponent(packetId)}/shippingLabel/`);
}

function fetchInvoice(packetId) {
  return myntraRaw(`/partner/v4/packet/${encodeURIComponent(packetId)}/getDocument/?type=invoice`);
}

// ---- Status changes (mutating) ----
// Accept / Reject order lines: PUT /partner/v4/order/:sellerOrderId/:EventType
function updateOrderEvent(sellerOrderId, eventType, { warehouse, orderLineIds = [], eventTime } = {}) {
  const ev = String(eventType || '').toLowerCase();
  if (ev !== 'accept' && ev !== 'reject') throw new AppError(2006, 'eventType must be accept or reject');
  return myntraSend('PUT', `/partner/v4/order/${encodeURIComponent(sellerOrderId)}/${ev}`, {
    eventTime: eventTime || new Date().toISOString().replace('T', ' ').slice(0, 19),
    warehouse: warehouse || undefined,
    orderLineEntries: orderLineIds.map((orderLineId) => ({ orderLineId })),
  });
}

// Cancel order lines: PUT /partner/v4/order/:sellerOrderId/cancelItems  body=[{orderLineId, comment}]
function cancelOrderItems(sellerOrderId, { orderLineIds = [], comment = 'Cancelled via OMS' } = {}) {
  if (!orderLineIds.length) throw new AppError(2006, 'At least one orderLineId is required');
  return myntraSend(
    'PUT',
    `/partner/v4/order/${encodeURIComponent(sellerOrderId)}/cancelItems`,
    orderLineIds.map((orderLineId) => ({ orderLineId, comment })),
  );
}

// Ready To Ship: PUT /partner/v4/trackingNumber/:trackingNo/readyToShip
// Send an empty JSON body so a Content-Length is always set — a bodyless PUT is
// rejected by Myntra's Akamai edge with 411 Length Required before it reaches the app.
function markReadyToShip(trackingNo) {
  if (!trackingNo) throw new AppError(2006, 'trackingNumber is required');
  return myntraSend('PUT', `/partner/v4/trackingNumber/${encodeURIComponent(trackingNo)}/readyToShip`, {});
}

// Ready To Dispatch: PUT /partner/v4/order/readyToDispatch  body={warehouse, orderLineEntries:[...]}
function markReadyToDispatch({ warehouse, orderLineEntries = [] } = {}) {
  if (!orderLineEntries.length) throw new AppError(2006, 'orderLineEntries is required');
  return myntraSend('PUT', '/partner/v4/order/readyToDispatch/', { warehouse, orderLineEntries });
}

// Update Inventory: PUT /partner/v4/inventory/update — array of up to 10 SKUs.
// Each item: { quantity, sku, processingSla, store_code }. Returns 1001 on success.
function updateInventory(items = []) {
  if (!items.length) throw new AppError(2006, 'At least one inventory item is required');
  if (items.length > 10) throw new AppError(2006, 'Max 10 SKUs per inventory update call');
  return myntraSend('PUT', '/partner/v4/inventory/update', items);
}

// Search Inventory: POST /partner/v4/inventory/search — body is a raw array of SKU strings.
// Returns { inventoryDetails:[{sku, stores:[{stores_code, inventoryCount}]}], failedEntries:[] }.
function searchInventory(skus = []) {
  if (!skus.length) throw new AppError(2006, 'At least one SKU is required');
  return myntraSend('POST', '/partner/v4/inventory/search', skus);
}

module.exports = {
  generateToken,
  fetchOrderList,
  fetchOrderById,
  fetchPacketById,
  fetchInvoiceDetails,
  searchReturns,
  fetchReturnDetails,
  fetchShippingLabel,
  fetchInvoice,
  updateOrderEvent,
  cancelOrderItems,
  markReadyToShip,
  markReadyToDispatch,
  updateInventory,
  searchInventory,
};
