const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Driver = require('../models/Driver');
const Car = require('../models/Car');
const User = require('../models/User');
const Contact = require('../models/Contact');
const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');
const { getDashboardSnapshot } = require('../utils/dashboardMetrics');

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
  const dashboard = await getDashboardSnapshot();
  res.json({ success: true, dashboard });
});

module.exports = { getDashboard };