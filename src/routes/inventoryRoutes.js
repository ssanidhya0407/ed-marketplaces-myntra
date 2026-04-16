const express = require('express');
const validate = require('../middleware/validate');
const { failureInventorySchema } = require('../schemas/inventorySchemas');
const inventoryController = require('../controllers/inventoryController');

const router = express.Router();

router.post('/failureinventory/update', validate(failureInventorySchema), inventoryController.failureInventoryUpdate);

module.exports = router;
