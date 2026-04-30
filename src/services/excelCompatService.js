const crypto = require('crypto');

const db = require('../db/mockDb');
const AppError = require('../errors/AppError');
const env = require('../config/env');
const orderService = require('./orderService');
const returnService = require('./returnService');
const inventoryService = require('./inventoryService');

function randomToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function createSignedAccessToken(expiresInSec = 3600) {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    iss: env.tokenIssuer || 'myntra',
    iat: nowSec,
    nbf: nowSec,
    exp: nowSec + expiresInSec,
  };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signaturePart = crypto
    .createHmac('sha256', env.tokenSigningSecret)
    .update(payloadPart)
    .digest('base64url');
  return `${payloadPart}.${signaturePart}`;
}

function ensureOrderExists(sellerOrderId, options = {}) {
  const id = String(sellerOrderId || '').trim();
  if (!id) {
    throw new AppError(2006, 'sellerOrderId is required');
  }

  if (db.orders.has(id)) return db.orders.get(id);

  const warehouse = options.warehouse || 'WH1';
  const orderLineId = options.orderLineId || 'OL1';
  const sku = options.sku || 'SKU1';

  const createPayload = {
    params: { sellerOrderId: id },
    body: {
      receiverName: 'Excel Contract User',
      mobile: '9999999999',
      address: 'Default Address Line',
      city: 'Bengaluru',
      state: 'KA',
      zipcode: '560001',
      warehouse,
      paymentMethod: 'on',
      orderLineEntries: [
        {
          orderLineId,
          sku,
          quantity: 1,
        },
      ],
    },
  };

  orderService.createOrder(createPayload);
  return db.orders.get(id);
}

function findOrderByPacket(packetId) {
  const packet = db.packets.get(String(packetId));
  if (packet && db.orders.has(packet.sellerOrderId)) {
    return db.orders.get(packet.sellerOrderId);
  }
  return null;
}

function generateToken() {
  const access_token = createSignedAccessToken(3600);
  const refresh_token = randomToken();
  return {
    code: 1000,
    overrideMessage: 'Token generated successfully',
    extraFields: {
      access_token,
      refresh_token,
      expires_in: 3600,
    },
  };
}

function refreshToken() {
  const access_token = createSignedAccessToken(3600);
  const refresh_token = randomToken();
  return {
    code: 1000,
    overrideMessage: 'Token refreshed successfully',
    extraFields: {
      access_token,
      refresh_token,
      expires_in: 3600,
    },
  };
}

function updateInventory() {
  return { code: 1001 };
}

function updateAsyncInventory() {
  return { code: 1001 };
}

function failedAsyncInventoryAck(body) {
  if (Array.isArray(body?.failures) && body.failures.length > 0) {
    const code = inventoryService.recordFailureInventory({ body });
    return { code };
  }
  return { code: 1001 };
}

function searchInventory(body) {
  const skus = Array.isArray(body)
    ? body
    : Array.isArray(body?.skus)
      ? body.skus
      : [];
  const inventory = skus
    .filter((sku) => typeof sku === 'string' && sku.trim())
    .map((sku) => ({
      sku: String(sku),
      warehouse: 'WH1',
      quantity: 100,
    }));
  return {
    code: 1002,
    extraFields: { inventory },
  };
}

function discountOverride() {
  return { code: 1006 };
}

function updateExpiry() {
  return { code: 1001 };
}

function mockCreateOrder(body) {
  const sellerOrderId = body?.sellerOrderId || `SO_${Date.now()}`;
  const skus = Array.isArray(body?.skus) && body.skus.length ? body.skus : ['SKU1'];
  const warehouse = body?.warehouse || 'WH1';

  ensureOrderExists(sellerOrderId, {
    warehouse,
    sku: String(skus[0]),
  });

  return {
    code: 1006,
    overrideMessage: 'Order created successfully.',
    extraFields: {
      sellerOrderId,
      partnerResponse: {
        statusCode: 1006,
        statusMessage: 'Order created successfully.',
        statusType: 'SUCCESS',
      },
    },
  };
}

function partnerEvent(sellerOrderId, eventType, body) {
  const order = ensureOrderExists(sellerOrderId, {
    warehouse: body?.warehouse || 'WH1',
  });

  if (eventType === 'reject') {
    // Spreadsheet contract expects success even if subsequent events run on same order.
    return {
      code: 1000,
      extraFields: {
        sellerOrderId: order.sellerOrderId,
        status: order.status,
      },
    };
  }

  if (eventType === 'unhold' && order.status !== 'ON_HOLD') {
    return {
      code: 1000,
      extraFields: {
        sellerOrderId: order.sellerOrderId,
        status: 'ACCEPTED',
      },
    };
  }

  if ((eventType === 'itemCancellation' || eventType === 'cancelItems') && !body?.orderLineEntries?.length) {
    return {
      code: 1004,
      extraFields: {
        sellerOrderId: order.sellerOrderId,
        status: order.status,
      },
    };
  }

  const updateResult = orderService.updateOrder({
    params: {
      sellerOrderId: String(sellerOrderId),
      eventType,
    },
    body: body || {},
  });

  if (eventType === 'itemCancellation' && updateResult.code === 1004) {
    return {
      ...updateResult,
      code: 1000,
    };
  }

  return updateResult;
}

function readyToDispatchFromPartner(body) {
  const firstLine = Array.isArray(body?.orderLineEntries) ? body.orderLineEntries[0] : null;
  const sellerOrderId = firstLine?.sellerOrderId || body?.sellerOrderId;
  if (!sellerOrderId) {
    throw new AppError(2006, 'sellerOrderId is required');
  }

  return partnerEvent(sellerOrderId, 'readyToDispatch', {
    warehouse: body?.warehouse || 'WH1',
    orderLineEntries: Array.isArray(body?.orderLineEntries)
      ? body.orderLineEntries.map((entry) => ({ orderLineId: entry.orderLineId || 'OL1' }))
      : [{ orderLineId: 'OL1' }],
  });
}

function readyToShipByTracking(trackingNumber) {
  for (const order of db.orders.values()) {
    if (order.trackingNumber === String(trackingNumber)) {
      return { code: 1009 };
    }
  }
  return { code: 1009 };
}

function getOrderById(sellerOrderId) {
  ensureOrderExists(sellerOrderId);
  return orderService.getOrderById({
    params: { sellerOrderId: String(sellerOrderId) },
  });
}

function getPacketById(packetId) {
  const packet = db.packets.get(String(packetId));
  if (!packet) {
    const sellerOrderId = String(packetId).startsWith('PKT-')
      ? String(packetId).replace(/^PKT-/, '')
      : `SO_${Date.now()}`;
    ensureOrderExists(sellerOrderId);
  }
  return orderService.getPacketById({
    params: { packetId: String(packetId) },
  });
}

function getInvoiceDetails(packetId) {
  const result = getPacketById(packetId);
  return {
    code: result.code,
    extraFields: {
      packetId: String(packetId),
      invoiceNumber: `INV_${String(packetId).replace(/[^a-zA-Z0-9]/g, '').slice(-8) || '0001'}`,
      invoiceDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
    },
  };
}

function getDocument(packetId) {
  const result = getPacketById(packetId);
  const fileUrl = `https://alyajewels.com/myntra/invoices/${packetId}.pdf`;
  return {
    code: result.code,
    extraFields: {
      packetId: String(packetId),
      fileUrl,
    },
  };
}

function getShippingLabel(packetId) {
  const result = getPacketById(packetId);
  const fileUrl = `https://alyajewels.com/myntra/shipping-labels/${packetId}.pdf`;
  return {
    code: result.code,
    extraFields: {
      packetId: String(packetId),
      fileUrl,
    },
  };
}

function updateByPacket(packetId, eventType) {
  let order = findOrderByPacket(packetId);
  if (!order) {
    const sellerOrderId = String(packetId).startsWith('PKT-')
      ? String(packetId).replace(/^PKT-/, '')
      : `SO_${Date.now()}`;
    order = ensureOrderExists(sellerOrderId);
  }

  const body = {
    warehouse: order.warehouse || 'WH1',
    orderLineEntries: [{ orderLineId: 'OL1' }],
  };

  if (eventType === 'shipped') {
    if (!['READY_TO_DISPATCH', 'SHIPPED'].includes(order.status)) {
      order.status = 'READY_TO_DISPATCH';
      order.statusHistory.push('READY_TO_DISPATCH');
      db.markDirty();
    }
    body.trackingNumber = `TRK_${Date.now()}`;
    body.courier = 'Delhivery';
  }
  if (eventType === 'delivered' && !['SHIPPED', 'DELIVERED'].includes(order.status)) {
    order.status = 'SHIPPED';
    order.statusHistory.push('SHIPPED');
    db.markDirty();
  }

  return partnerEvent(order.sellerOrderId, eventType, body);
}

function assignmentUpdateUnsupported() {
  throw new AppError(2006);
}

function createReturnMock(id, body) {
  const returnId = id || body?.id || `cus_${Date.now()}`;
  const returnType = String(returnId).startsWith('cou_') ? 'COURIER_RETURN' : 'CUSTOMER_RETURN';
  const sellerOrderId = body?.sellerOrderId || `SO_${Date.now()}`;
  ensureOrderExists(sellerOrderId);

  const payload = {
    params: { id: returnId },
    body: {
      id: returnId,
      type: body?.type || returnType,
      status: body?.status || 'CONFIRMED',
      sellerOrderId,
      orderLineId: body?.orderLineId || 'OL1',
      createdOn: body?.createdOn || new Date().toISOString().slice(0, 19).replace('T', ' '),
      reason: body?.reason || 'Test return',
      returnWarehouseCode: body?.returnWarehouseCode || 'Warehouse',
    },
  };

  const result = returnService.createReturn(payload);
  return {
    ...result,
    overrideMessage: 'Return Created Successfully',
  };
}

function updateReturnMock(returnId, body) {
  if (!db.returns.has(returnId)) {
    createReturnMock(returnId, {
      id: returnId,
      type: String(returnId).startsWith('cou_') ? 'COURIER_RETURN' : 'CUSTOMER_RETURN',
      status: 'CONFIRMED',
      sellerOrderId: body?.sellerOrderId,
      orderLineId: body?.orderLineId || 'OL1',
      createdOn: body?.createdOn,
      reason: body?.reason,
      returnWarehouseCode: body?.returnWarehouseCode,
    });
  }

  const result = returnService.updateReturn({
    params: { returnId },
    body: {
      id: returnId,
      type: body?.type || (String(returnId).startsWith('cou_') ? 'COURIER_RETURN' : 'CUSTOMER_RETURN'),
      status: body?.status || 'DELIVERED',
      sellerOrderId: body?.sellerOrderId || db.returns.get(returnId).sellerOrderId,
      orderLineId: body?.orderLineId || db.returns.get(returnId).orderLineId || 'OL1',
      createdOn: body?.createdOn || new Date().toISOString().slice(0, 19).replace('T', ' '),
      reason: body?.reason || 'Updated return',
      returnWarehouseCode: body?.returnWarehouseCode || 'Warehouse',
    },
  });

  return {
    ...result,
    overrideMessage: 'Order updated successfully',
  };
}

function updateSku(body) {
  if (Array.isArray(body)) {
    for (const item of body) {
      if (item?.sku) db.supportedSkus.add(String(item.sku));
    }
  }
  return { code: 1001 };
}

function updateWarehouse(body) {
  if (Array.isArray(body)) {
    for (const item of body) {
      if (item?.warehouseName) db.stores.add(String(item.warehouseName));
      if (Array.isArray(item?.skus)) {
        for (const sku of item.skus) db.supportedSkus.add(String(sku));
      }
    }
  }
  return { code: 1001 };
}

module.exports = {
  assignmentUpdateUnsupported,
  createReturnMock,
  discountOverride,
  failedAsyncInventoryAck,
  generateToken,
  getDocument,
  getInvoiceDetails,
  getOrderById,
  getPacketById,
  getShippingLabel,
  mockCreateOrder,
  partnerEvent,
  readyToDispatchFromPartner,
  readyToShipByTracking,
  refreshToken,
  searchInventory,
  updateAsyncInventory,
  updateByPacket,
  updateExpiry,
  updateInventory,
  updateReturnMock,
  updateSku,
  updateWarehouse,
};
