const express = require('express');
const validate = require('../middleware/validate');
const { createOrderSchema, getOrderSchema, updateOrderSchema } = require('../schemas/orderSchemas');
const { downloadInvoiceSchema, getPacketSchema, updatePacketSchema } = require('../schemas/packetSchemas');
const orderController = require('../controllers/orderController');

const router = express.Router();

router.post('/storefront/v4/order/:sellerOrderId', validate(createOrderSchema), orderController.createOrder);
router.put('/storefront/v4/order/:sellerOrderId/:eventType', validate(updateOrderSchema), orderController.updateOrder);
router.get('/storefront/v4/order/:sellerOrderId', validate(getOrderSchema), orderController.getOrderById);
router.get('/storefront/v4/packet/:packetId', validate(getPacketSchema), orderController.getPacketById);
router.get('/storefront/v4/packet/downloadinvoice/:packetId', validate(downloadInvoiceSchema), orderController.downloadInvoice);
// Packet-level lifecycle events Myntra pushes after RTD: shipped / delivered / lost.
router.put('/storefront/v4/packet/:packetId/:eventType', validate(updatePacketSchema), orderController.updatePacket);

module.exports = router;
