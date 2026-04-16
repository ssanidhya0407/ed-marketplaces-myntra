const express = require('express');
const validate = require('../middleware/validate');
const { createReturnSchema, updateReturnSchema } = require('../schemas/returnSchemas');
const returnController = require('../controllers/returnController');

const router = express.Router();

// Handles both Create Return RTO (cou_*) and Create Customer Return (cus_*).
router.post('/storefront/v4/return/:id', validate(createReturnSchema), returnController.createReturn);
router.put('/storefront/v4/return/:returnId/update', validate(updateReturnSchema), returnController.updateReturn);

module.exports = router;
