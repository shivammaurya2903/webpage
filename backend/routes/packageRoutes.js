const router = require('express').Router();
const { body } = require('express-validator');
const { listPackages, createPackage, updatePackage, deletePackage } = require('../controllers/packageController');
const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');
const { uploadSingleImage } = require('../middleware/upload');

router.get('/', listPackages);
router.post(
  '/',
  protect,
  authorize('admin'),
  uploadSingleImage('image'),
  [
    body('packageName').trim().notEmpty(),
    body('duration').notEmpty(),
    body('price').isFloat({ min: 1 }),
    body('description').notEmpty()
  ],
  validateRequest,
  createPackage
);
router.put('/:id', protect, authorize('admin'), uploadSingleImage('image'), validateRequest, updatePackage);
router.delete('/:id', protect, authorize('admin'), deletePackage);

module.exports = router;