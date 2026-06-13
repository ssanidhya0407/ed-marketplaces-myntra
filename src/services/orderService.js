const AppError = require('../errors/AppError');
const db = require('../db/mockDb');
const { hashPayload } = require('../utils/hash');
const { buildPdf } = require('../utils/miniPdf');

// Internal status -> Myntra order search statusCode (per myntradeveloper.md)
const MYNTRA_STATUS_CODE_MAP = {
  CREATED: 'RFR',
  ACCEPTED: 'WP',
  ON_HOLD: 'WP',
  READY_TO_DISPATCH: 'PK',
  SHIPPED: 'SH',
  LOST: 'SH',
  DELIVERED: 'DL',
  CANCELLED: 'IC',
  REJECTED: 'IC',
};

function toMyntraStatusCode(status) {
  return MYNTRA_STATUS_CODE_MAP[status] || status;
}

function serializeOrder(order) {
  return {
    sellerOrderId: order.sellerOrderId,
    status: order.status,
    warehouse: order.warehouse,
    packetId: order.packetId,
    createdOn: order.createdOn || null,
    orderLines: Array.from(order.lineMap.values()).map((line) => ({
      orderLineId: String(line.orderLineId),
      sku: String(line.sku),
      quantity: Number(line.quantity),
      cancelled: Boolean(line.cancelled),
    })),
  };
}

function ensureValidSkus(orderLineEntries) {
  for (const line of orderLineEntries) {
    if (!db.supportedSkus.has(String(line.sku))) {
      throw new AppError(2007);
    }
  }
}

// Inbound webhook: Myntra pushes a (released) order to us. We accept the real payload as-is
// — no mock store/SKU validation — honour the pushed status, and treat duplicates as success
// (per Myntra spec: "Api will return success in case of duplicate order as well").
function createOrder({ params, body }) {
  const sellerOrderId = params.sellerOrderId;
  if (body.sellerOrderId && body.sellerOrderId !== sellerOrderId) {
    throw new AppError(2034);
  }

  const success = (order) => ({
    code: 1006,
    overrideMessage: 'Order created successfully.',
    extraFields: serializeOrder(order),
  });

  if (db.orders.has(sellerOrderId)) {
    return success(db.orders.get(sellerOrderId)); // duplicate push → SUCCESS
  }

  const lines = Array.isArray(body.orderLineEntries) ? body.orderLineEntries : [];
  const warehouse = body.warehouse || lines.find((l) => l.warehouse)?.warehouse || null;
  const packetId = body.packetId || lines.find((l) => l.packetId)?.packetId || `PKT-${sellerOrderId}`;

  // Map Myntra's pushed order status -> internal status. WORK_IN_PROGRESS = released, seller-actionable.
  const pushed = String(body.status || '').toUpperCase();
  const status = pushed === 'WORK_IN_PROGRESS' ? 'ACCEPTED'
    : pushed === 'CANCELLED' ? 'CANCELLED'
      : 'CREATED';

  const lineMap = new Map(
    lines.map((line) => [String(line.orderLineId), { ...line, quantity: line.quantity ?? 1, cancelled: false }]),
  );

  db.orders.set(sellerOrderId, {
    source: 'push',
    sellerOrderId,
    packetId,
    status,
    statusHistory: [status],
    warehouse,
    eventName: body.eventName || null,
    paymentMethod: body.paymentMethod || null,
    receiver: {
      receiverName: body.receiverName, address: body.address, locality: body.locality,
      city: body.city, state: body.state, stateName: body.stateName,
      zipcode: body.zipcode, country: body.country, mobile: body.mobile, email: body.email,
    },
    payloadHash: hashPayload(body),
    createdOn: new Date().toISOString(),
    lineMap,
  });
  db.packets.set(packetId, { sellerOrderId, packetId, invoiceReady: true });

  return success(db.orders.get(sellerOrderId));
}

// Inbound webhook: Myntra pushes order/packet updates. Event types (some PascalCase):
// ItemCancellation, onhold, unhold, shipped, delivered, trackingNumberUpdate,
// reassignReleaseUpdate, itemBlock, itemNsts, itemXPacked. The webhook must accept any
// event and ALWAYS acknowledge success — it never rejects Myntra's push.
function updateOrder({ params, body }) {
  const { sellerOrderId } = params;
  const ev = String(params.eventType || '').toLowerCase();
  const order = db.orders.get(sellerOrderId);

  // All Update Order success responses are statusCode 1008 per Myntra's spec.
  if (!order) {
    return { code: 1008, overrideMessage: 'Order updated successfully', extraFields: { sellerOrderId, eventType: params.eventType, applied: false } };
  }

  const setStatus = (s) => { if (order.status !== s) { order.status = s; order.statusHistory.push(s); } };
  const ok = () => { db.markDirty(); return { code: 1008, overrideMessage: 'Order updated successfully', extraFields: serializeOrder(order) }; };
  const cancelLines = (entries) => {
    for (const e of entries || []) {
      const line = order.lineMap.get(String(e.orderLineId));
      if (!line) continue;
      line.cancelled = true;
      if (e.cancellationReason || e.comment) line.cancellationReason = e.cancellationReason || e.comment;
      if (e.cancellationCode != null) line.cancellationCode = e.cancellationCode;
      // Stamp when it was cancelled — this is the authoritative "actually cancelled"
      // signal the dashboard relies on (vs a bare reason that was never actioned).
      line.cancelledOn = e.cancelledOn || body.eventTime || new Date().toISOString();
    }
    if (order.lineMap.size && Array.from(order.lineMap.values()).every((l) => l.cancelled)) setStatus('CANCELLED');
  };

  switch (ev) {
    case 'accept': setStatus('ACCEPTED'); return ok();
    case 'reject': setStatus('REJECTED'); return ok();
    case 'pack':
    case 'readytodispatch': setStatus('READY_TO_DISPATCH'); return ok();
    case 'shipped':
      if (body.trackingNumber) order.trackingNumber = String(body.trackingNumber);
      if (body.courier || body.courierCode) order.courier = String(body.courier || body.courierCode);
      setStatus('SHIPPED'); return ok();
    case 'delivered': setStatus('DELIVERED'); return ok();
    case 'lost': setStatus('LOST'); return ok();
    case 'onhold': setStatus('ON_HOLD'); return ok();
    case 'unhold': setStatus('ACCEPTED'); return ok();
    case 'trackingnumberupdate':
      if (body.trackingNumber) order.trackingNumber = String(body.trackingNumber);
      if (body.courier || body.courierCode) order.courier = String(body.courier || body.courierCode);
      return ok();
    case 'reassignreleaseupdate':
    case 'assignmentupdate':
      for (const e of body.orderLineEntries || []) { const line = order.lineMap.get(String(e.orderLineId)); if (line && e.warehouse) line.warehouse = String(e.warehouse); }
      if (body.warehouse) order.warehouse = String(body.warehouse);
      return ok();
    case 'repromise': // SLA times refreshed
      for (const e of body.orderLineEntries || []) {
        const line = order.lineMap.get(String(e.orderLineId));
        if (line) { ['packByTime', 'acceptByTime', 'processingStartTime', 'customerPromiseTime'].forEach((k) => { if (e[k]) line[k] = e[k]; }); }
      }
      return ok();
    case 'itemcancellation':
    case 'cancelitems':
    case 'vfs': // Vendor Failed to Supply
      cancelLines(body.orderLineEntries);
      return ok();
    // itemBlock / itemNsts / itemXPacked / anything else → acknowledge without failing.
    default: return ok();
  }
}

// Packet-level events (after RTD): shipped, delivered, lost — PUT /storefront/v4/packet/:packetId/:eventType.
function updatePacket({ params, body }) {
  const { packetId } = params;
  const ev = String(params.eventType || '').toLowerCase();
  let order = null;
  const p = db.packets.get(packetId);
  if (p) order = db.orders.get(p.sellerOrderId);
  if (!order) { for (const o of db.orders.values()) { if (o.packetId === packetId) { order = o; break; } } }

  if (!order) {
    return { code: 1008, overrideMessage: 'Order updated successfully', extraFields: { packetId, eventType: params.eventType, applied: false } };
  }
  const setStatus = (s) => { if (order.status !== s) { order.status = s; order.statusHistory.push(s); } };
  if (ev === 'shipped') {
    if (body.trackingNumber) order.trackingNumber = String(body.trackingNumber);
    if (body.courier || body.courierCode) order.courier = String(body.courier || body.courierCode);
    setStatus('SHIPPED');
  } else if (ev === 'delivered') setStatus('DELIVERED');
  else if (ev === 'lost') setStatus('LOST');
  db.markDirty();
  return { code: 1008, overrideMessage: 'Order updated successfully', extraFields: serializeOrder(order) };
}

// Myntra fetches the seller-generated invoice here and expects a PDF byte stream.
function downloadInvoice({ params }) {
  const packet = db.packets.get(params.packetId);
  if (!packet) throw new AppError(2020);
  const order = db.orders.get(packet.sellerOrderId);
  const r = (order && order.receiver) || {};
  const line = order ? Array.from(order.lineMap.values())[0] : {};
  const pdf = buildPdf('Tax Invoice', [
    `Packet: ${params.packetId}`,
    `Order: ${packet.sellerOrderId}`,
    `Invoice No: ${(line && line.invoiceNumber) || '-'}    Date: ${(line && line.invoiceDate) || '-'}`,
    '',
    `Customer: ${r.receiverName || '-'}`,
    `Item: ${(line && line.sku) || '-'}    Qty: ${(line && (line.quantity ?? 1)) || '-'}`,
    `Amount: INR ${(line && line.lineFinalAmount) ?? '-'}`,
    '',
    'Seller: EXPERIENCES.DIGITAL PRIVATE LIMITED',
  ]);
  return { pdf, packetId: params.packetId };
}

function parseDateBoundary(value, endOfDay) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : raw);
  if (Number.isNaN(parsed)) {
    throw new AppError(2006, `Invalid date: ${raw}. Expected YYYY-MM-DD`);
  }
  return parsed;
}

function getOrderList({ query }) {
  const page = Math.max(0, Number.parseInt(query?.page, 10) || 0);
  const requestedPageSize = Number.parseInt(query?.pageSize, 10);
  const pageSize = Math.min(100, Math.max(1, Number.isFinite(requestedPageSize) ? requestedPageSize : 20));
  const startMs = parseDateBoundary(query?.startDate, false);
  const endMs = parseDateBoundary(query?.endDate, true);
  const statusCodes = String(query?.statusCode || '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);

  const matches = [];
  for (const order of db.orders.values()) {
    if (statusCodes.length && !statusCodes.includes(toMyntraStatusCode(order.status))) continue;
    if (startMs !== null || endMs !== null) {
      // Orders persisted before createdOn existed stay visible in date queries.
      const createdMs = order.createdOn ? Date.parse(order.createdOn) : null;
      if (createdMs !== null) {
        if (startMs !== null && createdMs < startMs) continue;
        if (endMs !== null && createdMs > endMs) continue;
      }
    }
    matches.push(order);
  }

  matches.sort((a, b) => String(b.createdOn || '').localeCompare(String(a.createdOn || '')));

  const totalCount = matches.length;
  const orders = matches.slice(page * pageSize, page * pageSize + pageSize).map((order) => ({
    ...serializeOrder(order),
    statusCode: toMyntraStatusCode(order.status),
  }));

  return {
    code: 1005,
    overrideMessage: 'Orders retrieved successfully',
    extraFields: {
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      orders,
    },
  };
}

function getOrderById({ params }) {
  const order = db.orders.get(params.sellerOrderId);
  if (!order) throw new AppError(2020);
  return {
    code: 1005,
    extraFields: serializeOrder(order),
  };
}

function getPacketById({ params }) {
  const packet = db.packets.get(params.packetId);
  if (!packet) throw new AppError(2020);
  const order = db.orders.get(packet.sellerOrderId);
  if (!order) throw new AppError(2020);
  return {
    code: 1005,
    extraFields: {
      packetId: packet.packetId,
      ...serializeOrder(order),
      fileUrl: packet.fileUrl,
    },
  };
}

module.exports = {
  createOrder,
  updateOrder,
  updatePacket,
  downloadInvoice,
  getOrderById,
  getOrderList,
  getPacketById,
};
