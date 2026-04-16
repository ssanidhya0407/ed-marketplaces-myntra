const express = require('express');
const validate = require('../middleware/validate');
const { createOrderSchema, getOrderSchema, updateOrderSchema } = require('../schemas/orderSchemas');
const { downloadInvoiceSchema, getPacketSchema } = require('../schemas/packetSchemas');
const orderController = require('../controllers/orderController');

const router = express.Router();

router.post('/storefront/v4/order/:sellerOrderId', validate(createOrderSchema), orderController.createOrder);
router.put('/storefront/v4/order/:sellerOrderId/:eventType', validate(updateOrderSchema), orderController.updateOrder);
router.get('/storefront/v4/order/:sellerOrderId', validate(getOrderSchema), orderController.getOrderById);
router.get('/storefront/v4/packet/:packetId', validate(getPacketSchema), orderController.getPacketById);
router.get('/storefront/v4/packet/downloadinvoice/:packetId', validate(downloadInvoiceSchema), orderController.downloadInvoice);

module.exports = router;
