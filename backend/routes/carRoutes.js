const router = require('express').Router();
const { body } = require('express-validator');
const { listCars, createCar, updateCar, deleteCar } = require('../controllers/carController');
const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');
const { uploadSingleImage } = require('../middleware/upload');

router.get('/', listCars);
router.post(
  '/',
  protect,
  authorize('admin'),
  uploadSingleImage('image'),
  [
    body('carName').trim().notEmpty(),
    body('seatingCapacity').isInt({ min: 1 }),
    body('category').notEmpty(),
    body('fuelType').notEmpty(),
    body('transmission').notEmpty(),
    body('pricePerDay').isFloat({ min: 1 })
  ],
  validateRequest,
  createCar
);
router.put('/:id', protect, authorize('admin'), uploadSingleImage('image'), validateRequest, updateCar);
router.delete('/:id', protect, authorize('admin'), deleteCar);

module.exports = router;