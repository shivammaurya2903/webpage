const router = require('express').Router();
const { body } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');
const adminController = require('../controllers/adminController');
const invoiceController = require('../controllers/invoiceController');
const { isValidImageUrl } = require('../utils/imageUrl');

router.post(
	'/auth/login',
	[body('email').isEmail().withMessage('Valid email is required'), body('password').notEmpty().withMessage('Password is required')],
	validateRequest,
	adminController.login
);

router.post('/auth/logout', protect, authorize('admin'), adminController.logout);
router.get('/auth/me', protect, authorize('admin'), adminController.me);

router.use(protect, authorize('admin'));

router.get('/dashboard', adminController.getDashboard);

router.get('/bookings', adminController.listBookings);
router.patch(
	'/bookings/:id/status',
	[body('status').isIn(['Pending', 'Approved', 'Rejected', 'Driver Assigned', 'Ride Started', 'Ride Completed', 'Invoice Generated', 'Paid', 'Cancelled', 'Accepted', 'Payment Pending', 'Fully Paid'])],
	validateRequest,
	adminController.setBookingStatus
);
router.patch('/bookings/:id/assign-driver', [body('driverId').notEmpty().withMessage('driverId is required')], validateRequest, adminController.assignDriverToBooking);
router.post('/bookings/:id/generate-invoice', invoiceController.generateBookingInvoice);
router.post('/bookings/:id/regenerate-invoice', invoiceController.regenerateBookingInvoice);
router.post('/bookings/:id/send-invoice', invoiceController.resendBookingInvoice);
router.post('/bookings/:id/mark-paid', [body('paymentMethod').notEmpty().withMessage('paymentMethod is required')], validateRequest, invoiceController.markBookingPaid);
router.get('/bookings/:id/invoice', invoiceController.downloadBookingInvoice);
router.delete('/bookings/:id', adminController.deleteBooking);

router.get('/drivers', adminController.listDrivers);
router.post('/drivers', [body('driverName').notEmpty(), body('phone').notEmpty(), body('licenseNumber').notEmpty()], validateRequest, adminController.createDriver);
router.put('/drivers/:id', adminController.updateDriver);
router.delete('/drivers/:id', adminController.deleteDriver);

router.get('/cars', adminController.listCars);
router.post('/cars', [body('image').optional({ checkFalsy: true }).custom((value) => isValidImageUrl(value)).withMessage('Image URL must be a JPG, JPEG, PNG, or WEBP link')], validateRequest, adminController.createCar);
router.put('/cars/:id', [body('image').optional({ checkFalsy: true }).custom((value) => isValidImageUrl(value)).withMessage('Image URL must be a JPG, JPEG, PNG, or WEBP link')], validateRequest, adminController.updateCar);
router.delete('/cars/:id', adminController.deleteCar);

router.get('/packages', adminController.listPackages);
router.post('/packages', [body('image').optional({ checkFalsy: true }).custom((value) => isValidImageUrl(value)).withMessage('Image URL must be a JPG, JPEG, PNG, or WEBP link')], validateRequest, adminController.createPackage);
router.put('/packages/:id', [body('image').optional({ checkFalsy: true }).custom((value) => isValidImageUrl(value)).withMessage('Image URL must be a JPG, JPEG, PNG, or WEBP link')], validateRequest, adminController.updatePackage);
router.delete('/packages/:id', adminController.deletePackage);

router.get('/routes', adminController.listRoutes);
router.post('/routes', adminController.createRoute);
router.put('/routes/:id', adminController.updateRoute);
router.delete('/routes/:id', adminController.deleteRoute);

router.get('/customers', adminController.listCustomers);
router.patch('/customers/:id/block', adminController.blockCustomer);
router.delete('/customers/:id', adminController.deleteCustomer);

router.get('/payments', adminController.listPayments);
router.get('/invoices', adminController.listInvoices);
router.post('/payments/:id/refund', adminController.refundPayment);

router.get('/messages', adminController.listMessages);
router.post('/messages/:id/reply', [body('reply').notEmpty().withMessage('Reply is required')], validateRequest, adminController.replyMessage);
router.patch('/messages/:id/resolve', adminController.resolveMessage);
router.delete('/messages/:id', adminController.deleteMessage);

router.get('/settings', adminController.getSettings);
router.put('/settings', [body('bannerImage').optional({ checkFalsy: true }).custom((value) => isValidImageUrl(value)).withMessage('Image URL must be a JPG, JPEG, PNG, or WEBP link')], validateRequest, adminController.updateSettings);

router.get('/notifications', adminController.listNotifications);
router.patch('/notifications/:id/read', adminController.markNotificationRead);
router.delete('/notifications/:id', adminController.deleteNotification);

module.exports = router;