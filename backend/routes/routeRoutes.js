const router = require('express').Router();
const { body } = require('express-validator');
const { listRoutes, createRoute, updateRoute, deleteRoute } = require('../controllers/routeController');
const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');

router.get('/', listRoutes);
router.post('/', protect, authorize('admin'), [body('from').notEmpty(), body('to').notEmpty(), body('price').isFloat({ min: 1 })], validateRequest, createRoute);
router.put('/:id', protect, authorize('admin'), validateRequest, updateRoute);
router.delete('/:id', protect, authorize('admin'), deleteRoute);

module.exports = router;