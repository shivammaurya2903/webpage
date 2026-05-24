const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const Route = require('../models/Route');
const Car = require('../models/Car');
const Package = require('../models/Package');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { createBookingId } = require('../utils/bookingId');
const { estimateFare } = require('../utils/fareEstimator');
const { notifyAdmins } = require('../services/notificationService');
const { bookingConfirmation, bookingAccepted, driverAssigned, rideCompleted } = require('../services/emailTemplates');
const { sendEmail } = require('../services/emailService');
const { sendWhatsApp } = require('../services/whatsappService');

async function findBestRoute(pickupLocation, dropLocation) {
  const routes = await Route.find({});
  return routes.find((route) => {
    const fromMatch = pickupLocation.toLowerCase().includes(route.from.toLowerCase()) || route.from.toLowerCase().includes(pickupLocation.toLowerCase());
    const toMatch = dropLocation.toLowerCase().includes(route.to.toLowerCase()) || route.to.toLowerCase().includes(dropLocation.toLowerCase());
    return fromMatch && toMatch;
  }) || null;
}

const createBooking = asyncHandler(async (req, res) => {
  const payload = {
    customerName: req.body.customerName || req.body.fullName,
    phone: req.body.phone,
    email: req.body.email,
    pickupLocation: req.body.pickupLocation,
    dropLocation: req.body.dropLocation,
    pickupDate: req.body.pickupDate,
    pickupTime: req.body.pickupTime,
    passengers: req.body.passengers,
    selectedCar: req.body.selectedCar,
    selectedPackage: req.body.selectedPackage,
    specialRequirements: req.body.specialRequirements || req.body.requirements || '',
    user: req.user?._id || null
  };

  const [car, tripPackage, route] = await Promise.all([
    Car.findOne({ carName: new RegExp(`^${payload.selectedCar}$`, 'i') }),
    Package.findOne({ packageName: new RegExp(`^${payload.selectedPackage}$`, 'i') }),
    findBestRoute(payload.pickupLocation, payload.dropLocation)
  ]);

  const pricing = estimateFare({ car, tripPackage, route, passengers: payload.passengers });

  const booking = await Booking.create({
    bookingId: createBookingId(),
    ...payload,
    pickupDate: new Date(`${payload.pickupDate}T00:00:00`),
    estimatedFare: pricing.estimatedFare,
    bookingAdvance: pricing.bookingAdvance,
    remainingPayment: pricing.remainingPayment,
    paymentStatus: 'Pending',
    bookingStatus: 'Pending'
  });

  await notifyAdmins('booking:new', {
    bookingId: booking.bookingId,
    customerName: booking.customerName,
    pickupLocation: booking.pickupLocation,
    dropLocation: booking.dropLocation,
    bookingStatus: booking.bookingStatus,
    paymentStatus: booking.paymentStatus,
    estimatedFare: booking.estimatedFare
  });

  await sendEmail({
    to: booking.email,
    subject: `Booking received - ${booking.bookingId}`,
    html: bookingConfirmation(booking)
  }).catch(() => undefined);

  await sendWhatsApp({
    to: booking.phone,
    message: `Booking received: ${booking.bookingId}. Advance amount ₹${booking.bookingAdvance}.`
  }).catch(() => undefined);

  res.status(201).json({
    success: true,
    message: 'Booking created successfully',
    booking
  });
});

const getBookings = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  const skip = (page - 1) * limit;
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();

  const queryParts = [];
  if (status) queryParts.push({ bookingStatus: status });
  if (search) {
    queryParts.push({
      $or: [
        { customerName: { $regex: search, $options: 'i' } },
        { bookingId: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    });
  }

  if (req.user?.role !== 'admin') {
    queryParts.push({
      $or: [{ user: req.user?._id }, { email: req.user?.email }]
    });
  }

  const query = queryParts.length ? { $and: queryParts } : {};

  const [items, total] = await Promise.all([
    Booking.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('assignedDriver').lean(),
    Booking.countDocuments(query)
  ]);

  res.json({
    success: true,
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    bookings: items
  });
});

const getBookingById = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate('assignedDriver').populate('user');
  if (!booking) throw new ApiError(404, 'Booking not found');

  const isOwner = req.user && (req.user.role === 'admin' || String(booking.user?._id) === String(req.user._id) || booking.email === req.user.email);
  if (!isOwner) throw new ApiError(403, 'Not allowed to view this booking');

  res.json({ success: true, booking });
});

const updateBookingStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const booking = await Booking.findById(req.params.id).populate('assignedDriver');
  if (!booking) throw new ApiError(404, 'Booking not found');

  booking.bookingStatus = status;
  if (status === 'Fully Paid') booking.paymentStatus = 'Fully Paid';
  await booking.save();

  if (booking.email && status === 'Accepted') {
    await sendEmail({ to: booking.email, subject: `Booking accepted - ${booking.bookingId}`, html: bookingAccepted(booking) }).catch(() => undefined);
  }

  if (booking.email && status === 'Ride Completed') {
    await sendEmail({ to: booking.email, subject: `Ride completed - ${booking.bookingId}`, html: rideCompleted(booking) }).catch(() => undefined);
  }

  await notifyAdmins('booking:updated', { bookingId: booking.bookingId, status: booking.bookingStatus, paymentStatus: booking.paymentStatus });
  res.json({ success: true, booking });
});

const assignDriver = asyncHandler(async (req, res) => {
  const { driverId } = req.body;
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(404, 'Booking not found');

  const driver = await Driver.findById(driverId);
  if (!driver) throw new ApiError(404, 'Driver not found');

  booking.assignedDriver = driver._id;
  booking.bookingStatus = 'Driver Assigned';
  await booking.save();

  driver.availability = false;
  await driver.save();

  if (booking.email) {
    await sendEmail({ to: booking.email, subject: `Driver assigned - ${booking.bookingId}`, html: driverAssigned(booking, driver) }).catch(() => undefined);
  }

  await notifyAdmins('booking:driver-assigned', {
    bookingId: booking.bookingId,
    driverName: driver.driverName,
    vehicleAssigned: driver.vehicleAssigned
  });

  res.json({ success: true, booking, driver });
});

module.exports = {
  createBooking,
  getBookings,
  getBookingById,
  updateBookingStatus,
  assignDriver
};