const AppError = require('../errors/AppError');
const db = require('../db/mockDb');

// Inbound webhook: Myntra pushes a return (RTO / customer return). The spec requires
// idempotency ("repeated call gives same response"), so we never reject — duplicate
// pushes return the same success, and we accept the return even if we don't (yet) have
// the order/line stored.
function createReturn({ params, body }) {
  const id = params.id;
  const summary = (ret) => ({
    code: 1006,
    overrideMessage: 'Return Created Successfully',
    extraFields: { returnId: id, sellerOrderId: ret.sellerOrderId || null, status: ret.status || null, type: ret.type || null },
  });

  if (db.returns.has(id)) {
    return summary(db.returns.get(id)); // idempotent
  }

  const ret = {
    ...body,
    id,
    type: body.type || (id.startsWith('cou_') ? 'COURIER_RETURN' : id.startsWith('cus_') ? 'CUSTOMER_RETURN' : null),
    status: body.status || 'CONFIRMED',
    statusHistory: [body.status || 'CONFIRMED'],
  };
  db.returns.set(id, ret);
  return summary(ret);
}

function updateReturn({ params, body }) {
  const id = params.returnId;
  const existing = db.returns.get(id) || {
    id, sellerOrderId: body.sellerOrderId || null, type: body.type || null, statusHistory: [],
  };

  if (body.status) {
    existing.status = body.status;
    existing.statusHistory = existing.statusHistory || [];
    existing.statusHistory.push(body.status);
  }
  if (body.reason) existing.reason = body.reason;
  db.returns.set(id, existing);
  db.markDirty();

  return {
    code: 1000,
    overrideMessage: 'Return Updated Successfully',
    extraFields: { returnId: id, sellerOrderId: existing.sellerOrderId || null, status: existing.status || null, type: existing.type || null },
  };
}

module.exports = {
  createReturn,
  updateReturn,
};
