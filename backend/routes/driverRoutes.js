const router = require('express').Router();
const { body } = require('express-validator');
const { listDrivers, createDriver, updateDriver, deleteDriver } = require('../controllers/driverController');
const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');

router.get('/', protect, authorize('admin'), listDrivers);
router.post('/', protect, authorize('admin'), [body('driverName').notEmpty(), body('phone').notEmpty(), body('licenseNumber').notEmpty()], validateRequest, createDriver);
router.put('/:id', protect, authorize('admin'), validateRequest, updateDriver);
router.delete('/:id', protect, authorize('admin'), deleteDriver);

module.exports = router;