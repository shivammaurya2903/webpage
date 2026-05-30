const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const Driver = require('../models/Driver');
const Car = require('../models/Car');
const User = require('../models/User');
const Contact = require('../models/Contact');
const Notification = require('../models/Notification');

function buildMonthExpression(fieldName) {
  return {
    $dateToString: {
      format: '%Y-%m',
      date: { $ifNull: [`$${fieldName}`, '$createdAt'] }
    }
  };
}

function buildMonthlyCountPipeline(fieldName) {
  return [
    {
      $group: {
        _id: buildMonthExpression(fieldName),
        total: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ];
}

function buildMonthlyCollectionPipeline() {
  return [
    // payments with completed status are considered collected
    { $match: { status: 'Completed' } },
    {
      $group: {
        _id: buildMonthExpression('paymentDate'),
        total: { $sum: { $ifNull: ['$amount', 0] } }
      }
    },
    { $sort: { _id: 1 } }
  ];
}

function buildMonthlyRevenuePipeline() {
  return [
    // derive revenue from invoices marked Paid
    { $match: { paymentStatus: 'Paid' } },
    {
      $group: {
        _id: buildMonthExpression('paymentDate'),
        total: { $sum: { $ifNull: ['$totalFare', 0] } }
      }
    },
    { $sort: { _id: 1 } }
  ];
}

function buildCollectionPipeline() {
  return [
    { $match: { status: 'Completed' } },
    {
      $group: {
        _id: null,
        collection: { $sum: { $ifNull: ['$amount', 0] } }
      }
    }
  ];
}

function buildRevenuePipeline() {
  return [
    // revenue is sum of paid invoices' totalFare
    { $match: { paymentStatus: 'Paid' } },
    {
      $group: {
        _id: null,
        revenue: { $sum: { $ifNull: ['$totalFare', 0] } }
      }
    }
  ];
}

function buildPendingRevenuePipeline() {
  return [
    { $match: { paymentStatus: { $ne: 'Paid' }, balanceAmount: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        pendingRevenue: { $sum: { $ifNull: ['$balanceAmount', 0] } }
      }
    }
  ];
}

async function getDashboardSnapshot() {
  const [
    totalBookings,
    pendingBookings,
    pendingRides,
    acceptedRides,
    completedRides,
    totalCustomers,
    blockedCustomers,
    totalDrivers,
    activeDrivers,
    totalVehicles,
    totalPayments,
    completedPayments,
    partialPayments,
    pendingPayments,
    paidBookings,
    revenueSummary,
    collectionSummary,
    pendingRevenueSummary,
    monthlyBookings,
    monthlyRevenue,
    monthlyCollections,
    customerGrowth,
    recentBookings,
    recentPayments,
    recentMessages,
    notifications
  ] = await Promise.all([
    Booking.countDocuments(),
    Booking.countDocuments({ bookingStatus: { $in: ['Pending', 'Accepted', 'Approved', 'Driver Assigned', 'Ride Started', 'Invoice Generated', 'Payment Pending'] } }),
    Booking.countDocuments({ bookingStatus: { $in: ['Pending', 'Accepted', 'Approved', 'Driver Assigned', 'Ride Started', 'Invoice Generated', 'Payment Pending'] } }),
    Booking.countDocuments({ bookingStatus: { $in: ['Accepted', 'Approved', 'Driver Assigned', 'Ride Started'] } }),
    Booking.countDocuments({ $or: [{ rideCompletedAt: { $ne: null } }, { bookingStatus: { $in: ['Ride Completed', 'Paid', 'Fully Paid'] } }] }),
    User.countDocuments({ role: 'customer' }),
    User.countDocuments({ role: 'customer', isBlocked: true }),
    Driver.countDocuments(),
    Driver.countDocuments({ availability: true }),
    Car.countDocuments(),
    Payment.countDocuments(),
    Payment.countDocuments({ status: 'Completed' }),
    Payment.countDocuments({ status: 'Partially Paid' }),
    Payment.countDocuments({ status: 'Pending' }),
    Booking.countDocuments({ paymentStatus: 'Paid' }),
    Invoice.aggregate(buildRevenuePipeline()),
    Payment.aggregate(buildCollectionPipeline()),
    Invoice.aggregate(buildPendingRevenuePipeline()),
    Booking.aggregate(buildMonthlyCountPipeline('createdAt')),
    Invoice.aggregate(buildMonthlyRevenuePipeline()),
    Payment.aggregate(buildMonthlyCollectionPipeline()),
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
  const [collection] = collectionSummary;
  const [pendingRevenue] = pendingRevenueSummary;
  const paymentCompletionRate = totalPayments > 0 ? Math.round(((completedPayments + partialPayments) / totalPayments) * 100) : 0;

  return {
    stats: {
      totalBookings,
      pendingBookings,
      pendingRides,
      acceptedRides,
      completedRides,
      totalCustomers,
      blockedCustomers,
      totalDrivers,
      activeDrivers,
      totalVehicles,
      totalPayments,
      completedPayments,
      partialPayments,
      pendingPayments,
      paidBookings,
      paymentCompletionRate,
      revenue: Number(revenue?.revenue || 0),
      collection: Number(collection?.collection || 0),
      pendingRevenue: Number(pendingRevenue?.pendingRevenue || 0)
    },
    charts: {
      monthlyBookings,
      monthlyRevenue,
      monthlyCollections,
      customerGrowth
    },
    recentBookings,
    recentPayments,
    recentMessages,
    notifications
  };
}

module.exports = {
  getDashboardSnapshot,
  buildMonthlyCountPipeline,
  buildMonthlyCollectionPipeline,
  buildMonthlyRevenuePipeline,
  buildCollectionPipeline,
  buildRevenuePipeline,
  buildPendingRevenuePipeline
};