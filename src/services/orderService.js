const AppError = require('../errors/AppError');
const db = require('../db/mockDb');
const { hashPayload } = require('../utils/hash');

function serializeOrder(order) {
  return {
    sellerOrderId: order.sellerOrderId,
    status: order.status,
    warehouse: order.warehouse,
    packetId: order.packetId,
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

function createOrder({ params, body }) {
  const sellerOrderId = params.sellerOrderId;
  if (body.sellerOrderId && body.sellerOrderId !== sellerOrderId) {
    throw new AppError(2034);
  }

  if (!db.stores.has(body.warehouse)) {
    throw new AppError(2063);
  }

  ensureValidSkus(body.orderLineEntries);

  if (db.orders.has(sellerOrderId)) {
    throw new AppError(2005);
  }

  const packetId = body.packetId || `PKT-${sellerOrderId}`;
  const lineMap = new Map(body.orderLineEntries.map((line) => [String(line.orderLineId), { ...line, cancelled: false }]));

  db.orders.set(sellerOrderId, {
    sellerOrderId,
    packetId,
    status: 'CREATED',
    statusHistory: ['CREATED'],
    warehouse: body.warehouse,
    payloadHash: hashPayload(body),
    lineMap,
  });
  db.packets.set(packetId, {
    sellerOrderId,
    packetId,
    invoiceReady: true,
    fileUrl: `https://files.alyajewels.com/myntra/invoices/${packetId}.pdf`,
  });

  return {
    code: 1006,
    overrideMessage: 'Order created successfully.',
    extraFields: serializeOrder(db.orders.get(sellerOrderId)),
  };
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
  getPacketById,
};
