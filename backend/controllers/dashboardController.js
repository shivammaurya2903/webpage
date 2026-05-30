const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Driver = require('../models/Driver');
const Car = require('../models/Car');
const User = require('../models/User');
const Contact = require('../models/Contact');
const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');

function buildMonthExpression(fieldName) {
  return {
    $dateToString: {
      format: '%Y-%m',
      date: { $ifNull: [`$${fieldName}`, '$createdAt'] }
    }
  };
}

function buildRevenuePipeline() {
  return [
    { $match: { status: { $in: ['Completed', 'Partially Paid'] } } },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$amount' }
      }
    }
  ];
}

function buildMonthlyRevenuePipeline() {
  return [
    { $match: { status: { $in: ['Completed', 'Partially Paid'] } } },
    {
      $group: {
        _id: buildMonthExpression('paymentDate'),
        total: { $sum: '$amount' }
      }
    },
    { $sort: { _id: 1 } }
  ];
}

function buildMonthlyCountPipeline(modelField) {
  return [
    {
      $group: {
        _id: buildMonthExpression(modelField),
        total: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ];
}

const PENDING_BOOKING_STATUSES = ['Pending', 'Accepted', 'Approved', 'Driver Assigned', 'Ride Started', 'Invoice Generated', 'Payment Pending'];
const ACCEPTED_BOOKING_STATUSES = ['Accepted', 'Approved', 'Driver Assigned', 'Ride Started'];
const COMPLETED_BOOKING_STATUSES = ['Ride Completed', 'Invoice Generated', 'Paid', 'Fully Paid'];

const getDashboard = asyncHandler(async (req, res) => {
  const [
    totalBookings,
    pendingBookings,
    pendingRides,
    acceptedRides,
    completedRides,
    totalCustomers,
    blockedCustomers,
    totalVehicles,
    activeDrivers,
    totalPayments,
    completedPayments,
    partialPayments,
    pendingPayments,
    revenueSummary,
    monthlyBookings,
    monthlyRevenue,
    customerGrowth,
    recentBookings,
    recentPayments,
    recentMessages,
    notifications
  ] = await Promise.all([
    Booking.countDocuments(),
    Booking.countDocuments({ bookingStatus: { $in: PENDING_BOOKING_STATUSES } }),
    Booking.countDocuments({ bookingStatus: { $in: PENDING_BOOKING_STATUSES } }),
    Booking.countDocuments({ bookingStatus: { $in: ACCEPTED_BOOKING_STATUSES } }),
    Booking.countDocuments({ bookingStatus: { $in: COMPLETED_BOOKING_STATUSES } }),
    User.countDocuments({ role: 'customer' }),
    User.countDocuments({ role: 'customer', isBlocked: true }),
    Car.countDocuments(),
    Driver.countDocuments({ availability: true }),
    Payment.countDocuments(),
    Payment.countDocuments({ status: 'Completed' }),
    Payment.countDocuments({ status: 'Partially Paid' }),
    Payment.countDocuments({ status: 'Pending' }),
    Payment.aggregate(buildRevenuePipeline()),
    Booking.aggregate(buildMonthlyCountPipeline('createdAt')),
    Payment.aggregate(buildMonthlyRevenuePipeline()),
    User.aggregate([
      { $match: { role: 'customer' } },
      ...buildMonthlyCountPipeline('createdAt')
    ]),
    Booking.find().sort({ createdAt: -1 }).limit(8).populate('assignedDriver').lean(),
    Payment.find().sort({ createdAt: -1 }).limit(6).populate('booking').lean(),
    Contact.find().sort({ createdAt: -1 }).limit(6).lean(),
    Notification.find({ recipientRole: 'admin' }).sort({ createdAt: -1 }).limit(10).lean()
  ]);

  const [revenue] = revenueSummary;
  const collectedRevenue = Number(revenue?.revenue || 0);
  const paymentCompletionRate = totalPayments > 0 ? Math.round(((completedPayments + partialPayments) / totalPayments) * 100) : 0;

  res.json({
    success: true,
    dashboard: {
      stats: {
        totalBookings,
        pendingBookings,
        pendingRides,
        acceptedRides,
        completedRides,
        totalCustomers,
        blockedCustomers,
        totalVehicles,
        activeDrivers,
        totalPayments,
        completedPayments,
        partialPayments,
        pendingPayments,
        paymentCompletionRate,
        revenue: collectedRevenue
      },
      charts: {
        monthlyBookings,
        monthlyRevenue,
        customerGrowth
      },
      recentBookings,
      recentPayments,
      recentMessages,
      notifications
    }
  });
});

module.exports = { getDashboard };