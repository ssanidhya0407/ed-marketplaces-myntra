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
  let accessToken = headers.get('access_token');
  const refreshToken = headers.get('refresh_token');

  if (status !== 200 || !accessToken) {
    throw new AppError(2006, `Myntra token generation failed (HTTP ${status}): ${body.statusMessage || body.message || 'unknown error'}`);
  }

  // Myntra's generate_token mints the token with a fixed ~30-day window and can
  // hand back one that is ALREADY expired. When that happens (and a refresh_token
  // was returned), exchange it for a fresh access_token via refresh_token — this
  // is the only way to get a usable token without re-issuing credentials.
  let expFromJwt = jwtExpiryMs(accessToken);
  if (refreshToken && (!expFromJwt || expFromJwt <= Date.now())) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed) {
      accessToken = refreshed;
      expFromJwt = jwtExpiryMs(accessToken);
    }
  }

  cachedToken = {
    accessToken,
    refreshToken: refreshToken || null,
    // Refresh 60s before the JWT's own expiry; default to 55 minutes if it can't be read.
    expiresAtMs: (expFromJwt || Date.now() + 3300 * 1000) - 60 * 1000,
  };
  return cachedToken;
}

// Exchange a refresh_token for a fresh access_token (returned in the response
// HEADER, like generate_token). merchant_id must be in the body or Myntra replies
// "Merchant Id required". Returns the new token, or null on any failure.
async function refreshAccessToken(refreshToken) {
  try {
    const { status, headers } = await requestJson(`${env.myntraApiBase}/authorization/refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        refresh_token: refreshToken,
        'x-partner-store': env.myntraPartnerStore,
      },
      body: JSON.stringify({ merchant_id: env.myntraMerchantId }),
    });
    const at = headers.get('access_token');
    return status === 200 && at ? at : null;
  } catch (_error) {
    return null;
  }
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs) {
    return cachedToken.accessToken;
  }
  const token = await generateToken();
  return token.accessToken;
}

// Myntra doesn't always use HTTP 401 for an expired/revoked token — it can return
// the error inside a 200/4xx envelope like { statusMessage: 'access_token has expired' }.
// If we only retried on 401 we'd keep serving the dead cached token (until its
// JWT-derived expiry passes), blanking every Myntra-backed view. Detect both.
function isTokenExpired(status, body) {
  if (status === 401) return true;
  const msg = String((body && (body.statusMessage || body.message || body.error)) || '').toLowerCase();
  return (
    msg.includes('access_token has expired') ||
    msg.includes('token has expired') ||
    msg.includes('token is expired') ||
    msg.includes('invalid access_token') ||
    msg.includes('invalid_token')
  );
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

  if (isTokenExpired(status, body)) {
    // Token expired/revoked server-side; force one refresh and retry.
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
    return { status: retry.status, body: retry.body };
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
  if (isTokenExpired(res.status, res.body)) {
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

// Discount Override: PUT /partner/v4/discount/override — set a FlatPercent/RupeeOff
// discount per SKU for a date range (max 100 SKUs/call; discount 0 removes it).
// Dates are "dd-MM-yyyy HH:mm:ss". Returns 2000 with per-SKU status in discountEntries.
function overrideDiscount({ startDate, endDate, discountType = 'FlatPercent', discountEntries = [] } = {}) {
  if (!discountEntries.length) throw new AppError(2006, 'At least one discount entry is required');
  if (discountEntries.length > 100) throw new AppError(2006, 'Max 100 SKUs per discount call');
  return myntraSend('PUT', '/partner/v4/discount/override', { startDate, endDate, discountType, discountEntries });
}

// Payment History: GET /partner/v4/payments/history/{POSTPAID|PREPAID} — paginated
// payment records between fromDate and toDate. Returns the raw Myntra { status, body }.
function fetchPaymentHistory({ paymentMethod = 'POSTPAID', fromDate, toDate, pageNo = 1, pageSize = 20 } = {}) {
  const method = String(paymentMethod).toUpperCase() === 'PREPAID' ? 'PREPAID' : 'POSTPAID';
  return myntraGet(`/partner/v4/payments/history/${method}`, { fromDate, toDate, pageNo, pageSize });
}

// Invoice/Settlement Reports: POST /partner/v4/payments/reports/{MONTHLY_REPORTS|ONE_TIME_REPORTS}
// Body { year, month?, reportName }. month is required only for MONTHLY_REPORTS. Returns
// { data:[{ blobReportType, reportName, reportPath }], totalCount } — reportPath is a signed
// URL to the downloadable report (CSV/Excel).
function fetchInvoiceReport({ reportType = 'MONTHLY_REPORTS', year, month, reportName } = {}) {
  const type = String(reportType).toUpperCase() === 'ONE_TIME_REPORTS' ? 'ONE_TIME_REPORTS' : 'MONTHLY_REPORTS';
  const body = { year: String(year), reportName };
  if (type === 'MONTHLY_REPORTS' && month != null && month !== '') body.month = String(month).padStart(2, '0');
  return myntraSend('POST', `/partner/v4/payments/reports/${type}`, body);
}

module.exports = {
  generateToken,
  fetchPaymentHistory,
  fetchInvoiceReport,
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
  overrideDiscount,
};
