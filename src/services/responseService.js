const { SUCCESS_RESPONSES, ERROR_RESPONSES } = require('../constants/myntraCodes');

function createSuccess(code) {
  const payload = SUCCESS_RESPONSES[code];
  if (!payload) {
    throw new Error(`Unknown success code: ${code}`);
  }
  return payload;
}

function createError(code, overrideMessage) {
  const mapped = ERROR_RESPONSES[code] || ERROR_RESPONSES[2000];
  return {
    httpStatus: mapped.httpStatus,
    body: {
      statusCode: mapped.statusCode,
      statusMessage: overrideMessage || mapped.statusMessage,
      statusType: mapped.statusType,
    },
  };
}

function sendSuccess(req, res, code, options = {}) {
  if (res.headersSent) return res;
  const { overrideMessage, extraFields } = options;
  const payload = { ...createSuccess(code) };
  if (overrideMessage) payload.statusMessage = overrideMessage;
  if (extraFields && typeof extraFields === 'object') {
    Object.assign(payload, extraFields);
  }
  if (req.idempotencyKey) {
    req.idempotencyStore.set(req.idempotencyKey, {
      status: 200,
      body: payload,
      storedAt: Date.now(),
    });
  }
  return res.status(200).json(payload);
}

function sendError(req, res, code, overrideMessage) {
  if (res.headersSent) return res;
  const { httpStatus, body } = createError(code, overrideMessage);
  if (req.idempotencyKey) {
    req.idempotencyStore.set(req.idempotencyKey, {
      status: httpStatus,
      body,
      storedAt: Date.now(),
    });
  }
  return res.status(httpStatus).json(body);
}

module.exports = {
  createSuccess,
  createError,
  sendSuccess,
  sendError,
};
