const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Driver = require('../models/Driver');
const asyncHandler = require('../utils/asyncHandler');

const getDashboard = asyncHandler(async (req, res) => {
  const [totalBookings, pendingRides, completedRides, availableDrivers, paymentSummary] = await Promise.all([
    Booking.countDocuments(),
    Booking.countDocuments({ bookingStatus: { $in: ['Pending', 'Approved', 'Driver Assigned'] } }),
    Booking.countDocuments({ bookingStatus: { $in: ['Ride Completed', 'Invoice Generated', 'Paid', 'Fully Paid'] } }),
    Driver.countDocuments({ availability: true }),
    Payment.aggregate([
      { $match: { status: 'Completed' } },
      { $group: { _id: null, revenue: { $sum: '$amount' } } }
    ])
  ]);

  const recentBookings = await Booking.find().sort({ createdAt: -1 }).limit(8).lean();

  res.json({
    success: true,
    dashboard: {
      totalBookings,
      pendingRides,
      completedRides,
      availableDrivers,
      revenue: paymentSummary[0]?.revenue || 0,
      recentBookings
    }
  });
});

module.exports = { getDashboard };