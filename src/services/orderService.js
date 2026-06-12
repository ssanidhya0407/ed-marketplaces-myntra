const AppError = require('../errors/AppError');
const db = require('../db/mockDb');
const { hashPayload } = require('../utils/hash');

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

function updateOrder({ params, body }) {
  const { sellerOrderId, eventType } = params;
  const order = db.orders.get(sellerOrderId);
  if (!order) throw new AppError(2008);

  if (body.warehouse && body.warehouse !== order.warehouse) {
    throw new AppError(2063);
  }

  if (body.orderLineEntries && body.orderLineEntries.length) {
    for (const line of body.orderLineEntries) {
      if (!order.lineMap.has(String(line.orderLineId))) {
        throw new AppError(2031);
      }
    }
  }

  if (eventType === 'accept') {
    if (order.status === 'CANCELLED') throw new AppError(2061);
    if (order.status !== 'CREATED') throw new AppError(2033);
    order.status = 'ACCEPTED';
    order.statusHistory.push('ACCEPTED');
    db.markDirty();
    return { code: 1000, extraFields: serializeOrder(order) };
  }

  if (eventType === 'reject') {
    order.status = 'REJECTED';
    order.statusHistory.push('REJECTED');
    db.markDirty();
    return { code: 1000, extraFields: serializeOrder(order) };
  }

  if (eventType === 'pack' || eventType === 'readyToDispatch') {
    if (!['ACCEPTED', 'READY_TO_DISPATCH'].includes(order.status)) throw new AppError(8247);
    order.status = 'READY_TO_DISPATCH';
    order.statusHistory.push('READY_TO_DISPATCH');
    db.markDirty();
    return { code: 1000, extraFields: serializeOrder(order) };
  }

  if (eventType === 'shipped') {
    if (!body.trackingNumber || !body.courier || !body.warehouse) {
      throw new AppError(2006, 'trackingNumber, courier and warehouse are required for shipped event');
    }
    if (!['READY_TO_DISPATCH', 'SHIPPED'].includes(order.status)) throw new AppError(8247);
    order.status = 'SHIPPED';
    order.statusHistory.push('SHIPPED');
    order.trackingNumber = String(body.trackingNumber);
    order.courier = String(body.courier);
    db.markDirty();
    return { code: 1009, extraFields: serializeOrder(order) };
  }

  if (eventType === 'delivered') {
    if (!['SHIPPED', 'DELIVERED'].includes(order.status)) throw new AppError(8247);
    order.status = 'DELIVERED';
    order.statusHistory.push('DELIVERED');
    db.markDirty();
    return { code: 1000, extraFields: serializeOrder(order) };
  }

  if (eventType === 'onhold') {
    if (order.status === 'ON_HOLD') throw new AppError(2062);
    order.status = 'ON_HOLD';
    order.statusHistory.push('ON_HOLD');
    db.markDirty();
    return { code: 1000, extraFields: serializeOrder(order) };
  }

  if (eventType === 'unhold') {
    if (order.status !== 'ON_HOLD') throw new AppError(2062);
    order.status = 'ACCEPTED';
    order.statusHistory.push('ACCEPTED');
    db.markDirty();
    return { code: 1000, extraFields: serializeOrder(order) };
  }

  if (eventType === 'itemCancellation' || eventType === 'cancelItems') {
    if (!body.orderLineEntries?.length) throw new AppError(2006, 'orderLineEntries required for cancellation');
    for (const entry of body.orderLineEntries) {
      const line = order.lineMap.get(String(entry.orderLineId));
      if (line.cancelled) throw new AppError(2061);
      line.cancelled = true;
    }
    const allCancelled = Array.from(order.lineMap.values()).every((line) => line.cancelled);
    if (allCancelled) {
      order.status = 'CANCELLED';
      order.statusHistory.push('CANCELLED');
    }
    db.markDirty();
    return { code: 1004, extraFields: serializeOrder(order) };
  }

  if (eventType === 'lost') {
    order.status = 'LOST';
    order.statusHistory.push('LOST');
    db.markDirty();
    return { code: 1000, extraFields: serializeOrder(order) };
  }

  throw new AppError(2006, 'Unsupported eventType');
}

function downloadInvoice({ params }) {
  const packet = db.packets.get(params.packetId);
  if (!packet) throw new AppError(2020);
  const order = db.orders.get(packet.sellerOrderId);
  return {
    code: 1005,
    extraFields: {
      packetId: params.packetId,
      sellerOrderId: packet.sellerOrderId,
      fileUrl: packet.fileUrl,
      orderLines: order
        ? Array.from(order.lineMap.values()).map((line) => ({
            orderLineId: String(line.orderLineId),
            sku: String(line.sku),
            quantity: Number(line.quantity),
          }))
        : [],
    },
  };
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
  downloadInvoice,
  getOrderById,
  getOrderList,
  getPacketById,
};
