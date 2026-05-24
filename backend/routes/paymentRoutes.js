const router = require('express').Router();
const { body } = require('express-validator');
const { createOrder, verifyPayment, refundPayment, paymentHistory } = require('../controllers/paymentController');
const { protect, optionalProtect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');

router.post(
  '/create-order',
  optionalProtect,
  [body('bookingId').notEmpty().withMessage('bookingId is required'), body('paymentType').optional().isIn(['advance', 'remaining'])],
  validateRequest,
  createOrder
);

router.post('/verify', optionalProtect, [body('sessionId').notEmpty().withMessage('sessionId is required')], validateRequest, verifyPayment);
router.post('/refund', protect, authorize('admin'), [body('paymentId').notEmpty().withMessage('paymentId is required')], validateRequest, refundPayment);
router.get('/history', protect, paymentHistory);

module.exports = router;