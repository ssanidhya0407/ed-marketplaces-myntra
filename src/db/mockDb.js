const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'persistent-store.json');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function toLineMapEntries(lineMap) {
  if (!(lineMap instanceof Map)) return [];
  return Array.from(lineMap.entries()).map(([key, value]) => [key, value]);
}

function fromLineMapEntries(entries) {
  return new Map(Array.isArray(entries) ? entries : []);
}

function serializeOrderRecord(order) {
  return {
    ...order,
    lineMapEntries: toLineMapEntries(order.lineMap),
  };
}

function hydrateOrderRecord(order) {
  return {
    ...order,
    lineMap: fromLineMapEntries(order.lineMapEntries),
  };
}

function defaultRawState() {
  return {
    ordersEntries: [],
    returnsEntries: [],
    packetsEntries: [],
    inventoryFailures: [],
    idempotencyEntries: [],
    inventoryFailureHashes: [],
  };
}

function loadRawState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return defaultRawState();
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    if (!raw.trim()) return defaultRawState();
    return { ...defaultRawState(), ...JSON.parse(raw) };
  } catch (error) {
    console.error('[PERSISTENCE_LOAD_ERROR]', error.message);
    return defaultRawState();
  }
}

let schedulePersist = () => {};

class PersistentMap extends Map {
  set(key, value) {
    const result = super.set(key, value);
    schedulePersist();
    return result;
  }

  delete(key) {
    const result = super.delete(key);
    if (result) schedulePersist();
    return result;
  }

  clear() {
    if (this.size === 0) return;
    super.clear();
    schedulePersist();
  }
}

class PersistentSet extends Set {
  add(value) {
    const originalSize = this.size;
    const result = super.add(value);
    if (this.size !== originalSize) schedulePersist();
    return result;
  }

  delete(value) {
    const result = super.delete(value);
    if (result) schedulePersist();
    return result;
  }

  clear() {
    if (this.size === 0) return;
    super.clear();
    schedulePersist();
  }
}

class PersistentArray extends Array {
  push(...items) {
    const result = super.push(...items);
    schedulePersist();
    return result;
  }
}

const rawState = loadRawState();

const db = {
  orders: new PersistentMap((rawState.ordersEntries || []).map(([key, value]) => [key, hydrateOrderRecord(value)])),
  returns: new PersistentMap(rawState.returnsEntries || []),
  packets: new PersistentMap(rawState.packetsEntries || []),
  inventoryFailures: new PersistentArray(...(rawState.inventoryFailures || [])),
  idempotency: new PersistentMap(rawState.idempotencyEntries || []),
  inventoryFailureHashes: new PersistentSet(rawState.inventoryFailureHashes || []),
  supportedSkus: new Set(['SKU1', 'SKU2', 'SKU3', 'SHIRT-RED-M', 'SHOE-BLK-9']),
  stores: new Set(['WH1', 'WH2', 'WH3', 'Warehouse', 'BLR4KHB']),
};

function serializeDbState() {
  return {
    ordersEntries: Array.from(db.orders.entries()).map(([key, order]) => [key, serializeOrderRecord(order)]),
    returnsEntries: Array.from(db.returns.entries()),
    packetsEntries: Array.from(db.packets.entries()),
    inventoryFailures: Array.from(db.inventoryFailures),
    idempotencyEntries: Array.from(db.idempotency.entries()),
    inventoryFailureHashes: Array.from(db.inventoryFailureHashes),
  };
}

let flushScheduled = false;
let dirty = false;
let persistPromise = Promise.resolve();

function writeStateToDisk() {
  const payload = JSON.stringify(serializeDbState(), null, 2);
  const tmpFile = `${DATA_FILE}.tmp`;
  ensureDataDir();
  return fs.promises
    .writeFile(tmpFile, payload, 'utf8')
    .then(() => fs.promises.rename(tmpFile, DATA_FILE))
    .catch((error) => {
      console.error('[PERSISTENCE_WRITE_ERROR]', error.message);
    });
}

schedulePersist = function schedulePersistImpl() {
  dirty = true;
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    if (!dirty) return;
    dirty = false;
    persistPromise = persistPromise.then(() => writeStateToDisk());
  }, 20);
};

db.markDirty = () => schedulePersist();
db.flush = async () => {
  if (dirty) {
    dirty = false;
    await writeStateToDisk();
  }
  await persistPromise;
};
db.dataFile = DATA_FILE;

process.on('beforeExit', () => {
  if (dirty) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(serializeDbState(), null, 2), 'utf8');
    } catch (error) {
      console.error('[PERSISTENCE_BEFORE_EXIT_ERROR]', error.message);
    }
  }
});

module.exports = db;
