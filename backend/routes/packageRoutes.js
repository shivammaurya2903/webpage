const router = require('express').Router();
const { body } = require('express-validator');
const { listPackages, createPackage, updatePackage, deletePackage } = require('../controllers/packageController');
const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');
const { isValidImageUrl } = require('../utils/imageUrl');

router.get('/', listPackages);
router.post(
  '/',
  protect,
  authorize('admin'),
  [
    body('packageName').trim().notEmpty(),
    body('duration').notEmpty(),
    body('price').isFloat({ min: 1 }),
    body('description').notEmpty(),
    body('image').optional({ checkFalsy: true }).custom((value) => isValidImageUrl(value)).withMessage('Image URL must be a JPG, JPEG, PNG, or WEBP link')
  ],
  validateRequest,
  createPackage
);
router.put('/:id', protect, authorize('admin'), [body('image').optional({ checkFalsy: true }).custom((value) => isValidImageUrl(value)).withMessage('Image URL must be a JPG, JPEG, PNG, or WEBP link')], validateRequest, updatePackage);
router.delete('/:id', protect, authorize('admin'), deletePackage);

module.exports = router;