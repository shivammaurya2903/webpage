const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { createBooking, getBookings, getBookingById, updateBookingStatus, assignDriver, downloadBookingInvoice } = require('../controllers/bookingController');
const { protect, createProtectMiddleware, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');
const { deleteBooking } = require('../controllers/bookingController');

const bookingCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many booking submissions. Please try again later.' }
});

function parseLocalDateOnly(value) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(value || '').trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function normalizeIndianPhone(value) {
  const cleaned = String(value || '').trim().replace(/[\s-]/g, '');
  if (!cleaned || /[^+0-9]/.test(cleaned)) return '';

  let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2);
  }

  if (!/^[6-9][0-9]{9}$/.test(digits)) return '';
  return `+91${digits}`;
}

const bookingValidators = [
  body('customerName')
    .customSanitizer((value, { req }) => String(value || req.body.fullName || '').trim())
    .isLength({ min: 2, max: 120 })
    .withMessage('Customer name is required'),
  body('email').trim().isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone')
    .customSanitizer((value) => normalizeIndianPhone(value))
    .custom((value) => {
      if (!value) {
        throw new Error('Please enter a valid Indian mobile number.');
      }
      return true;
    }),
  body('pickupLocation').trim().isLength({ min: 2, max: 200 }).withMessage('Pickup location is required'),
  body('dropLocation').trim().isLength({ min: 2, max: 200 }).withMessage('Drop location is required'),
  body('pickupDate')
    .trim()
    .custom((value) => {
      const selected = parseLocalDateOnly(value);
      if (!selected) {
        throw new Error('Valid pickup date is required');
      }

      if (selected < startOfToday()) {
        throw new Error('Booking date cannot be earlier than today.');
      }

      return true;
    }),
  body('dropDate')
    .optional({ checkFalsy: true })
    .trim()
    .custom((value, { req }) => {
      if (!value) return true;

      const selected = parseLocalDateOnly(value);
      if (!selected) {
        throw new Error('Valid drop date is required');
      }

      const pickup = parseLocalDateOnly(req.body.pickupDate);
      if (pickup && selected < pickup) {
        throw new Error('Drop date cannot be earlier than pickup date.');
      }

      return true;
    }),
  body('pickupTime').matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('Valid pickup time is required'),
  body('passengers').trim().isLength({ min: 1, max: 20 }).withMessage('Passenger count is required'),
  body('selectedCar').trim().isLength({ min: 1, max: 120 }).withMessage('Selected car is required'),
  body('vehicleId').trim().isLength({ min: 1, max: 128 }).withMessage('Vehicle selection is required'),
  body('selectedPackage')
    .customSanitizer((value, { req }) => String(value || req.body.tripType || '').trim())
    .isLength({ min: 2, max: 120 })
    .withMessage('Selected package is required')
];

router.post('/', bookingCreateLimiter, createProtectMiddleware('Please login to book a ride.'), bookingValidators, validateRequest, createBooking);
router.get('/', protect, getBookings);
router.get('/:id', protect, getBookingById);
router.get('/:id/invoice/download', protect, downloadBookingInvoice);
router.put('/:id/status', protect, authorize('admin'), [body('status').isIn(['Pending', 'Approved', 'Rejected', 'Driver Assigned', 'Ride Started', 'Ride Completed', 'Invoice Generated', 'Paid', 'Cancelled', 'Accepted', 'Payment Pending', 'Fully Paid'])], validateRequest, updateBookingStatus);
router.put('/:id/assign-driver', protect, authorize('admin'), [body('driverId').notEmpty().withMessage('driverId is required')], validateRequest, assignDriver);
router.delete('/:id', protect, authorize('admin'), deleteBooking);

module.exports = router;