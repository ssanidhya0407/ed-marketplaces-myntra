const { createError } = require('../services/responseService');

function notFoundHandler(_req, res) {
  const mapped = createError(2006);
  return res.status(mapped.httpStatus).json(mapped.body);
}

module.exports = notFoundHandler;
