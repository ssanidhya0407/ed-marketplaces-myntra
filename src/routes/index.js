const express = require('express');

const healthRoutes = require('./healthRoutes');
const excelCompatRoutes = require('./excelCompatRoutes');
const orderRoutes = require('./orderRoutes');
const inventoryRoutes = require('./inventoryRoutes');
const returnRoutes = require('./returnRoutes');

const router = express.Router();

router.use(healthRoutes);
router.use(excelCompatRoutes);
router.use(orderRoutes);
router.use(inventoryRoutes);
router.use(returnRoutes);

module.exports = router;
