const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { notifyAdmins } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');
const { paymentReceipt } = require('../services/emailTemplates');

function isOwnedBooking(booking, user) {
  if (!booking?.user || !user) return false;
  const bookingUserId = booking.user._id || booking.user;
  return String(bookingUserId) === String(user._id) || user.role === 'admin';
}

const createOrder = asyncHandler(async (req, res) => {
  throw new ApiError(410, 'Booking-time payment has been disabled. Collect payment after ride completion from the admin panel.');
});

const verifyPayment = asyncHandler(async (req, res) => {
  throw new ApiError(410, 'Stripe verification is disabled. Payments are settled manually after ride completion.');
});

const refundPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.body;
  const payment = await Payment.findById(paymentId).populate('booking');
  if (!payment) throw new ApiError(404, 'Payment not found');

  if (payment.status === 'Refunded') {
    return res.json({ success: true, message: 'Payment was already refunded', refund: null });
  }

  payment.status = 'Refunded';
  payment.refundedAt = new Date();
  await payment.save();

  payment.booking.paymentStatus = 'Refunded';
  payment.booking.bookingStatus = 'Cancelled';
  await payment.booking.save();

  res.json({ success: true, message: 'Refund marked successfully', refund: null, manualRefund: true });
});

const paymentHistory = asyncHandler(async (req, res) => {
  const query = req.user?.role === 'admin' ? {} : { user: req.user?._id };
  const payments = await Payment.find(query).sort({ createdAt: -1 }).populate('booking').lean();
  res.json({ success: true, payments });
});

module.exports = { createOrder, verifyPayment, refundPayment, paymentHistory };