const express = require('express');

const { sendSuccess } = require('../services/responseService');
const excelCompat = require('../services/excelCompatService');

const router = express.Router();

function wrap(handler) {
  return (req, res, next) => {
    try {
      return handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

router.post(
  '/authorization/generate_token',
  wrap((req, res) => res.status(200).json(excelCompat.generateToken())),
);

router.post(
  '/authorization/refresh_token',
  wrap((req, res) => res.status(200).json(excelCompat.refreshToken())),
);

router.put(
  '/partner/v4/inventory/update',
  wrap((req, res) => {
    const result = excelCompat.updateInventory(req.body);
    return sendSuccess(req, res, result.code);
  }),
);

router.put(
  '/partner/v4/inventory/async/update',
  wrap((req, res) => {
    const result = excelCompat.updateAsyncInventory(req.body);
    return sendSuccess(req, res, result.code);
  }),
);

router.post(
  '/partner/v4/inventory/search',
  wrap((req, res) => {
    const result = excelCompat.searchInventory(req.body);
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/partner/v4/discount/override',
  wrap((req, res) => {
    const result = excelCompat.discountOverride(req.body);
    return sendSuccess(req, res, result.code);
  }),
);

router.put(
  '/partner/v4/expiry/update',
  wrap((req, res) => {
    const result = excelCompat.updateExpiry(req.body);
    return sendSuccess(req, res, result.code);
  }),
);

router.post(
  '/storefront/v4/mock/order',
  wrap((req, res) => {
    const result = excelCompat.mockCreateOrder(req.body);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/partner/v4/order/:sellerOrderId/accept',
  wrap((req, res) => {
    const result = excelCompat.partnerEvent(req.params.sellerOrderId, 'accept', req.body);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/partner/v4/order/:sellerOrderId/reject',
  wrap((req, res) => {
    const result = excelCompat.partnerEvent(req.params.sellerOrderId, 'reject', req.body);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/partner/v4/order/readyToDispatch',
  wrap((req, res) => {
    const result = excelCompat.readyToDispatchFromPartner(req.body);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/partner/v4/trackingNumber/:trackingNumber/readyToShip',
  wrap((req, res) => {
    const result = excelCompat.readyToShipByTracking(req.params.trackingNumber);
    return sendSuccess(req, res, result.code);
  }),
);

router.get(
  '/partner/v4/order/:sellerOrderId',
  wrap((req, res) => {
    const result = excelCompat.getOrderById(req.params.sellerOrderId);
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.get(
  '/partner/v4/packet/:packetId',
  wrap((req, res) => {
    const result = excelCompat.getPacketById(req.params.packetId);
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.get(
  '/partner/v4/packet/:packetId/getInvoiceDetails',
  wrap((req, res) => {
    const result = excelCompat.getInvoiceDetails(req.params.packetId);
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.get(
  '/partner/v4/packet/:packetId/getDocument',
  wrap((req, res) => {
    const result = excelCompat.getDocument(req.params.packetId);
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.get(
  '/partner/v4/packet/:packetId/shippingLabel',
  wrap((req, res) => {
    const result = excelCompat.getShippingLabel(req.params.packetId);
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/storefront/v4/mock/packet/:packetId/shipped',
  wrap((req, res) => {
    const result = excelCompat.updateByPacket(req.params.packetId, 'shipped');
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/storefront/v4/mock/packet/:packetId/delivered',
  wrap((req, res) => {
    const result = excelCompat.updateByPacket(req.params.packetId, 'delivered');
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/storefront/v4/mock/packet/:packetId/lost',
  wrap((req, res) => {
    const result = excelCompat.updateByPacket(req.params.packetId, 'lost');
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/storefront/v4/mock/order/:sellerOrderId/itemCancellation',
  wrap((req, res) => {
    const orderLineEntries = Array.isArray(req.body?.orderLineEntries)
      ? req.body.orderLineEntries
      : Array.isArray(req.body?.orderLineIds)
        ? req.body.orderLineIds.map((orderLineId) => ({ orderLineId }))
        : [];
    const result = excelCompat.partnerEvent(req.params.sellerOrderId, 'itemCancellation', {
      ...req.body,
      orderLineEntries,
    });
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/storefront/v4/mock/order/:sellerOrderId/onhold',
  wrap((req, res) => {
    const result = excelCompat.partnerEvent(req.params.sellerOrderId, 'onhold', req.body);
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/storefront/v4/mock/order/:sellerOrderId/unhold',
  wrap((req, res) => {
    const result = excelCompat.partnerEvent(req.params.sellerOrderId, 'unhold', req.body);
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/storefront/v4/mock/order/:sellerOrderId/assignmentUpdate',
  wrap(() => excelCompat.assignmentUpdateUnsupported()),
);

router.post(
  '/storefront/v4/mock/return/:id',
  wrap((req, res) => {
    const result = excelCompat.createReturnMock(req.params.id, req.body);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  }),
);

router.post(
  '/storefront/v4/mock/return',
  wrap((req, res) => {
    const result = excelCompat.createReturnMock(null, req.body);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/storefront/v4/mock/return/:returnId/update',
  wrap((req, res) => {
    const result = excelCompat.updateReturnMock(req.params.returnId, req.body);
    return sendSuccess(req, res, result.code, {
      overrideMessage: result.overrideMessage,
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/partner/v4/order/:sellerOrderId/cancelItems',
  wrap((req, res) => {
    const orderLineEntries = Array.isArray(req.body?.orderLineEntries)
      ? req.body.orderLineEntries
      : Array.isArray(req.body?.orderLineIds)
        ? req.body.orderLineIds.map((orderLineId) => ({ orderLineId }))
        : [];
    const result = excelCompat.partnerEvent(req.params.sellerOrderId, 'cancelItems', {
      ...req.body,
      orderLineEntries,
    });
    return sendSuccess(req, res, result.code, {
      extraFields: result.extraFields,
    });
  }),
);

router.put(
  '/sku',
  wrap((req, res) => {
    const result = excelCompat.updateSku(req.body);
    return sendSuccess(req, res, result.code);
  }),
);

router.put(
  '/warehouse',
  wrap((req, res) => {
    const result = excelCompat.updateWarehouse(req.body);
    return sendSuccess(req, res, result.code);
  }),
);

router.post(
  '/failureinventory/update',
  wrap((req, res) => {
    const result = excelCompat.failedAsyncInventoryAck(req.body);
    return sendSuccess(req, res, result.code);
  }),
);

module.exports = router;
