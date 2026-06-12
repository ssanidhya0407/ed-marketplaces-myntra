const db = require('../db/mockDb');

// Inbound return webhooks (Myntra -> seller), all trusted & idempotent:
//   POST /storefront/v4/return/:id          Create Return RTO (cou_) / Customer (cus_)
//   PUT  /storefront/v4/return/:id/update   Update Return (status transitions)
// Myntra sends a full object on every push with many null fields; we merge it into the
// stored return without overwriting known values with nulls, and keep a status history.

function inferType(id, body) {
  if (body && body.type) return body.type;
  if (typeof id === 'string') {
    if (id.startsWith('cou_')) return 'COURIER_RETURN';
    if (id.startsWith('cus_')) return 'CUSTOMER_RETURN';
  }
  return null;
}

// Copy non-empty body fields onto target. Never clobber an existing value with a null/blank,
// and leave status/statusHistory to the caller (they drive the state machine).
function mergeFields(target, body) {
  for (const [key, value] of Object.entries(body || {})) {
    if (key === 'status' || key === 'statusHistory') continue;
    if (value !== null && value !== undefined && value !== '') target[key] = value;
  }
  return target;
}

function summarize(code, message, ret) {
  return {
    code,
    overrideMessage: message,
    extraFields: {
      returnId: ret.id,
      sellerOrderId: ret.sellerOrderId || null,
      status: ret.status || null,
      type: ret.type || null,
    },
  };
}

// Append a status only when it actually changes (idempotent pushes don't bloat history).
function applyStatus(ret, status) {
  if (!status) return;
  ret.statusHistory = Array.isArray(ret.statusHistory) ? ret.statusHistory : [];
  if (ret.status !== status) {
    ret.status = status;
    ret.statusHistory.push(status);
  } else if (!ret.statusHistory.length) {
    ret.statusHistory.push(status);
  }
}

function createReturn({ params, body }) {
  const id = params.id;
  const ret = db.returns.get(id) || { id, statusHistory: [] };

  mergeFields(ret, body);
  ret.id = id;
  ret.type = ret.type || inferType(id, body);
  applyStatus(ret, ret.status || body.status || 'CONFIRMED');

  db.returns.set(id, ret);
  db.markDirty();
  return summarize(1006, 'Return Created Successfully', ret);
}

function updateReturn({ params, body }) {
  const id = params.returnId || params.id;
  const ret = db.returns.get(id) || { id, statusHistory: [] };

  mergeFields(ret, body);
  ret.id = id;
  ret.type = ret.type || inferType(id, body);
  applyStatus(ret, body.status);

  db.returns.set(id, ret);
  db.markDirty();
  return summarize(1008, 'Return Updated Successfully', ret);
}

module.exports = {
  createReturn,
  updateReturn,
};
