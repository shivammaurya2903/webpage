const router = require('express').Router();
const { body } = require('express-validator');
const { createBooking, getBookings, getBookingById, updateBookingStatus, assignDriver } = require('../controllers/bookingController');
const { protect, optionalProtect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');

const bookingValidators = [
  body('customerName')
    .custom((value, { req }) => String(value || req.body.fullName || '').trim().length >= 2)
    .withMessage('Customer name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').matches(/^\+?[0-9]{10,15}$/).withMessage('Valid phone number is required'),
  body('pickupLocation').trim().isLength({ min: 2 }).withMessage('Pickup location is required'),
  body('dropLocation').trim().isLength({ min: 2 }).withMessage('Drop location is required'),
  body('pickupDate').isISO8601().withMessage('Valid pickup date is required'),
  body('pickupTime').matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('Valid pickup time is required'),
  body('passengers').notEmpty().withMessage('Passenger count is required'),
  body('selectedCar').notEmpty().withMessage('Selected car is required'),
  body('selectedPackage').notEmpty().withMessage('Selected package is required')
];

router.post('/', optionalProtect, bookingValidators, validateRequest, createBooking);
router.get('/', protect, getBookings);
router.get('/:id', protect, getBookingById);
router.put('/:id/status', protect, authorize('admin'), [body('status').isIn(['Pending', 'Accepted', 'Driver Assigned', 'Ride Started', 'Ride Completed', 'Payment Pending', 'Fully Paid', 'Cancelled'])], validateRequest, updateBookingStatus);
router.put('/:id/assign-driver', protect, authorize('admin'), [body('driverId').notEmpty().withMessage('driverId is required')], validateRequest, assignDriver);

module.exports = router;