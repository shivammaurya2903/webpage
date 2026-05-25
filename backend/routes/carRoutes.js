const router = require('express').Router();
const { body } = require('express-validator');
const { listCars, createCar, updateCar, deleteCar } = require('../controllers/carController');
const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');
const { isValidImageUrl } = require('../utils/imageUrl');

router.get('/', listCars);
router.post(
  '/',
  protect,
  authorize('admin'),
  [
    body('carName').trim().notEmpty(),
    body('seatingCapacity').isInt({ min: 1 }),
    body('category').notEmpty(),
    body('fuelType').notEmpty(),
    body('transmission').notEmpty(),
    body('image').optional({ checkFalsy: true }).custom((value) => isValidImageUrl(value)).withMessage('Image URL must be a JPG, JPEG, PNG, or WEBP link'),
    body('pricePerDay').optional({ checkFalsy: true }).isFloat({ min: 0 }),
    body('baseFare').optional({ checkFalsy: true }).isFloat({ min: 0 }),
    body('pricePerKm').optional({ checkFalsy: true }).isFloat({ min: 0 })
  ],
  validateRequest,
  createCar
);
router.put('/:id', protect, authorize('admin'), [body('image').optional({ checkFalsy: true }).custom((value) => isValidImageUrl(value)).withMessage('Image URL must be a JPG, JPEG, PNG, or WEBP link')], validateRequest, updateCar);
router.delete('/:id', protect, authorize('admin'), deleteCar);

module.exports = router;