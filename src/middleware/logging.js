const crypto = require('crypto');

function loggingMiddleware(config) {
  function extractEntityIds(req) {
    return {
      sellerOrderId: req.params?.sellerOrderId || req.body?.sellerOrderId || null,
      returnId: req.params?.returnId || req.params?.id || req.body?.id || null,
      packetId: req.params?.packetId || req.body?.packetId || null,
      orderLineId: req.body?.orderLineId || null,
    };
  }

  return (req, res, next) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const start = Date.now();
    const endpoint = req.path;
    const entityIds = extractEntityIds(req);
    let responsePayload;

    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      responsePayload = payload;
      return originalJson(payload);
    };

    const reqLog = {
      requestId,
      method: req.method,
      endpoint,
      path: req.originalUrl,
      query: req.query,
      entityIds,
    };

    if (config.logBody) reqLog.body = req.body;
    console.log('[REQUEST]', JSON.stringify(reqLog));

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      console.log(
        '[RESPONSE]',
        JSON.stringify({
          requestId,
          method: req.method,
          endpoint,
          path: req.originalUrl,
          httpStatusCode: res.statusCode,
          myntraStatusCode: responsePayload?.statusCode || null,
          statusType: responsePayload?.statusType || null,
          status: responsePayload?.status || null,
          entityIds,
          durationMs,
        }),
      );
    });

    next();
  };
}

module.exports = loggingMiddleware;
