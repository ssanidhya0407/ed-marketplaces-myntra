const AppError = require('../errors/AppError');
const db = require('../db/mockDb');

function createReturn({ params, body }) {
  const id = params.id;

  if (id !== body.id) {
    throw new AppError(2006, 'Return id mismatch between path and body');
  }

  if (id.startsWith('cou_') && body.type !== 'COURIER_RETURN') {
    throw new AppError(2006, 'RTO return must use COURIER_RETURN type');
  }

  if (id.startsWith('cus_') && body.type !== 'CUSTOMER_RETURN') {
    throw new AppError(2006, 'Customer return must use CUSTOMER_RETURN type');
  }

  if (!id.startsWith('cou_') && !id.startsWith('cus_')) {
    throw new AppError(2006, 'Return id must start with cou_ or cus_');
  }

  if (!db.orders.has(body.sellerOrderId)) {
    throw new AppError(2008);
  }
  const order = db.orders.get(body.sellerOrderId);
  if (!order.lineMap.has(String(body.orderLineId))) {
    throw new AppError(2031);
  }

  if (db.returns.has(id)) {
    throw new AppError(2005);
  }

  db.returns.set(id, {
    ...body,
    statusHistory: [body.status],
  });

  return {
    code: 1006,
    overrideMessage: 'Return created successfully',
    extraFields: {
      returnId: id,
      sellerOrderId: body.sellerOrderId,
      orderLineId: String(body.orderLineId),
      status: body.status,
      type: body.type,
    },
  };
}

function updateReturn({ params, body }) {
  const id = params.returnId;
  if (id !== body.id) {
    throw new AppError(2006, 'Return id mismatch between path and body');
  }

  const existing = db.returns.get(id);
  if (!existing) {
    throw new AppError(3002);
  }

  existing.status = body.status;
  existing.statusHistory.push(body.status);
  existing.reason = body.reason;
  db.markDirty();

  return {
    code: 1000,
    overrideMessage: 'Return updated successfully',
    extraFields: {
      returnId: id,
      sellerOrderId: existing.sellerOrderId,
      orderLineId: String(existing.orderLineId),
      status: existing.status,
      type: existing.type,
    },
  };
}

module.exports = {
  createReturn,
  updateReturn,
};
