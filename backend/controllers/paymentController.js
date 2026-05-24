const Stripe = require('stripe');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { notifyAdmins } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');
const { paymentReceipt } = require('../services/emailTemplates');

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new ApiError(500, 'Stripe secret key is missing');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function resolveAmount(booking, paymentType) {
  return paymentType === 'remaining' ? booking.remainingPayment : booking.bookingAdvance;
}

const createOrder = asyncHandler(async (req, res) => {
  const { bookingId, paymentType = 'advance' } = req.body;
  const booking = await Booking.findOne({ bookingId });
  if (!booking) throw new ApiError(404, 'Booking not found');

  const amount = resolveAmount(booking, paymentType);
  if (!amount || amount <= 0) throw new ApiError(400, 'Invalid payment amount');

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: booking.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'inr',
          unit_amount: Math.round(amount * 100),
          product_data: {
            name: `${paymentType === 'advance' ? 'Booking Advance' : 'Final Payment'} - ${booking.bookingId}`,
            description: `${booking.pickupLocation} to ${booking.dropLocation}`
          }
        }
      }
    ],
    metadata: {
      bookingId: booking.bookingId,
      paymentType
    },
    success_url: `${process.env.FRONTEND_URL || 'http://localhost:5000'}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5000'}/?payment=cancelled&booking_id=${booking.bookingId}`
  });

  const payment = await Payment.create({
    booking: booking._id,
    user: booking.user,
    provider: 'stripe',
    providerSessionId: session.id,
    paymentType,
    amount,
    currency: 'inr',
    status: 'Pending',
    metadata: { bookingId: booking.bookingId }
  });

  booking.paymentSessionId = session.id;
  await booking.save();

  res.json({
    success: true,
    message: 'Payment session created',
    paymentId: payment._id,
    sessionId: session.id,
    checkoutUrl: session.url,
    amount
  });
});

const verifyPayment = asyncHandler(async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) throw new ApiError(400, 'sessionId is required');

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const payment = await Payment.findOne({ providerSessionId: sessionId }).populate('booking');
  if (!payment) throw new ApiError(404, 'Payment record not found');

  if (session.payment_status !== 'paid') {
    payment.status = 'Failed';
    await payment.save();
    payment.booking.paymentStatus = 'Failed';
    await payment.booking.save();
    throw new ApiError(400, 'Payment not completed');
  }

  payment.status = 'Completed';
  payment.providerPaymentId = session.payment_intent || session.id;
  await payment.save();

  const booking = await Booking.findById(payment.booking._id);
  if (!booking) throw new ApiError(404, 'Booking not found');

  booking.paymentId = payment.providerPaymentId;
  booking.transactionId = payment.providerPaymentId;
  booking.paymentStatus = payment.paymentType === 'remaining' ? 'Fully Paid' : 'Advance Paid';
  if (payment.paymentType === 'remaining') {
    booking.bookingStatus = 'Fully Paid';
  }
  await booking.save();

  await notifyAdmins('payment:completed', {
    bookingId: booking.bookingId,
    paymentType: payment.paymentType,
    amount: payment.amount,
    status: payment.status
  });

  await sendEmail({
    to: booking.email,
    subject: `Payment receipt - ${booking.bookingId}`,
    html: paymentReceipt(payment, booking)
  }).catch(() => undefined);

  res.json({
    success: true,
    message: 'Payment verified successfully',
    booking,
    payment
  });
});

const refundPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.body;
  const payment = await Payment.findById(paymentId).populate('booking');
  if (!payment) throw new ApiError(404, 'Payment not found');

  const stripe = getStripe();
  if (!payment.providerPaymentId) throw new ApiError(400, 'Provider payment id missing');

  const refund = await stripe.refunds.create({ payment_intent: payment.providerPaymentId });
  payment.status = 'Refunded';
  payment.refundedAt = new Date();
  await payment.save();

  payment.booking.paymentStatus = 'Refunded';
  payment.booking.bookingStatus = 'Cancelled';
  await payment.booking.save();

  res.json({ success: true, message: 'Refund processed successfully', refund });
});

const paymentHistory = asyncHandler(async (req, res) => {
  const query = req.user?.role === 'admin' ? {} : { user: req.user?._id };
  const payments = await Payment.find(query).sort({ createdAt: -1 }).populate('booking').lean();
  res.json({ success: true, payments });
});

module.exports = { createOrder, verifyPayment, refundPayment, paymentHistory };