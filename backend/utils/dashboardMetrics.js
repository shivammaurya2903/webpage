const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const Driver = require('../models/Driver');
const Car = require('../models/Car');
const User = require('../models/User');
const Contact = require('../models/Contact');
const Notification = require('../models/Notification');

const BOOKING_STATUS_FIELDS = ['bookingStatus', 'status'];

function buildStatusFieldMatches(statuses) {
  return BOOKING_STATUS_FIELDS.map((field) => ({ [field]: { $in: statuses } }));
}

function buildMonthExpression(...fieldNames) {
  const candidates = [...new Set([...fieldNames.flat().filter(Boolean), 'createdAt'])];
  const dateExpression = candidates.reduceRight((expression, fieldName) => (
    expression == null ? `$${fieldName}` : { $ifNull: [`$${fieldName}`, expression] }
  ), null);

  return {
    $dateToString: {
      format: '%Y-%m',
      date: dateExpression
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
    { $match: { paymentStatus: { $in: ['Paid', 'Completed'] } } },
    {
      $group: {
        _id: buildMonthExpression('paymentDate', 'paidAt', 'createdAt'),
        total: { $sum: { $ifNull: ['$totalFare', { $ifNull: ['$amount', 0] }] } }
      }
    },
    { $sort: { _id: 1 } }
  ];
}

function buildMonthlyRevenuePipeline() {
  return [
    {
      $group: {
        _id: buildMonthExpression('createdAt'),
        total: { $sum: { $ifNull: ['$totalFare', 0] } }
      }
    },
    { $sort: { _id: 1 } }
  ];
}

function buildCollectionPipeline() {
  return [
    { $match: { paymentStatus: { $in: ['Paid', 'Completed'] } } },
    {
      $group: {
        _id: null,
        collection: { $sum: { $ifNull: ['$totalFare', { $ifNull: ['$amount', 0] }] } }
      }
    }
  ];
}

function buildRevenuePipeline() {
  return [
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
    { $match: { paymentStatus: { $nin: ['Paid', 'Completed'] } } },
    {
      $group: {
        _id: null,
        pendingRevenue: { $sum: { $ifNull: ['$balanceAmount', { $ifNull: ['$totalFare', 0] }] } }
      }
    }
  ];
}

function buildPendingBookingQuery() {
  return { $or: buildStatusFieldMatches(['Pending']) };
}

function buildCompletedRideQuery() {
  return {
    $or: [
      { rideCompletedAt: { $ne: null } },
      ...buildStatusFieldMatches(['Ride Completed', 'Completed', 'Paid', 'Fully Paid'])
    ]
  };
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
    availableVehicles,
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
    Booking.countDocuments(buildPendingBookingQuery()),
    Booking.countDocuments(buildPendingBookingQuery()),
    Booking.countDocuments({ $or: buildStatusFieldMatches(['Accepted', 'Approved', 'Driver Assigned', 'Ride Started']) }),
    Booking.countDocuments(buildCompletedRideQuery()),
    User.countDocuments({ role: 'customer' }),
    User.countDocuments({ role: 'customer', isBlocked: true }),
    Driver.countDocuments(),
    Driver.countDocuments({ availability: true }),
    Car.countDocuments(),
    Car.countDocuments({ availability: true }),
    Payment.countDocuments(),
    Payment.countDocuments({ status: 'Completed' }),
    Payment.countDocuments({ status: 'Partially Paid' }),
    Payment.countDocuments({ status: 'Pending' }),
    Booking.countDocuments({ paymentStatus: 'Paid' }),
    Invoice.aggregate(buildRevenuePipeline()),
    Invoice.aggregate(buildCollectionPipeline()),
    Invoice.aggregate(buildPendingRevenuePipeline()),
    Booking.aggregate(buildMonthlyCountPipeline('createdAt')),
    Invoice.aggregate(buildMonthlyRevenuePipeline()),
    Invoice.aggregate(buildMonthlyCollectionPipeline()),
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
      availableVehicles,
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
  buildPendingRevenuePipeline,
  buildPendingBookingQuery,
  buildCompletedRideQuery,
  buildStatusFieldMatches
};