const AppError = require('../errors/AppError');
const db = require('../db/mockDb');
const { hashPayload } = require('../utils/hash');

function recordFailureInventory({ body }) {
  for (const failure of body.failures) {
    if (!db.supportedSkus.has(String(failure.sku))) {
      throw new AppError(2007);
    }
  }

  const payloadHash = hashPayload(body);
  if (db.inventoryFailureHashes.has(payloadHash)) {
    throw new AppError(2005);
  }

  db.inventoryFailureHashes.add(payloadHash);
  db.inventoryFailures.push({ ...body, createdAt: new Date().toISOString() });
  return 1001;
}

module.exports = {
  recordFailureInventory,
};
