const Stripe = require('stripe');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const Car = require('../models/Car');
const Package = require('../models/Package');
const Route = require('../models/Route');
const Payment = require('../models/Payment');
const Contact = require('../models/Contact');
const Notification = require('../models/Notification');
const SiteSettings = require('../models/SiteSettings');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { attachAdminToken } = require('../utils/generateToken');
const { notifyAdmins } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');
const { sendWhatsApp } = require('../services/whatsappService');
const { bookingAccepted, driverAssigned, rideCompleted } = require('../services/emailTemplates');

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

async function getSettingsDocument() {
  let settings = await SiteSettings.findOne({});
  if (!settings) {
    settings = await SiteSettings.create({});
  }
  return settings;
}

function mapSettingsPayload(body, file) {
  const payload = {
    businessName: body.businessName,
    contactEmail: body.contactEmail,
    contactPhone: body.contactPhone,
    address: body.address,
    logoText: body.logoText,
    socialLinks: {
      website: body.website,
      facebook: body.facebook,
      instagram: body.instagram,
      whatsapp: body.whatsapp
    },
    paymentSettings: {
      currency: body.currency,
      advancePercent: toNumber(body.advancePercent, 20),
      gatewayName: body.gatewayName
    },
    notificationSettings: {
      emailEnabled: toBoolean(body.emailEnabled, true),
      whatsappEnabled: toBoolean(body.whatsappEnabled, true),
      realtimeEnabled: toBoolean(body.realtimeEnabled, true)
    },
    homepage: {
      heroTitle: body.heroTitle,
      heroSubtitle: body.heroSubtitle,
      seoTitle: body.seoTitle,
      seoDescription: body.seoDescription,
      testimonials: body.testimonials ? parseList(body.testimonials).map((entry) => ({ name: entry.split('::')[0] || 'Guest', quote: entry.split('::')[1] || entry })) : undefined,
      fleetHighlights: body.fleetHighlights ? parseList(body.fleetHighlights).map((entry) => ({ title: entry.split('::')[0] || 'Highlight', description: entry.split('::')[1] || entry })) : undefined
    }
  };

  if (file) {
    payload.homepage.bannerImage = `/uploads/${file.filename}`;
  }

  return payload;
}

const login = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required');
  }

  const admin = await Admin.findOne({ email }).select('+password');
  if (!admin || !admin.isActive || !(await admin.comparePassword(password))) {
    throw new ApiError(401, 'Invalid admin email or password');
  }

  admin.lastLoginAt = new Date();
  await admin.save();

  return attachAdminToken(res, admin, 200);
});

const me = asyncHandler(async (req, res) => {
  res.json({ success: true, admin: req.user.toSafeJSON ? req.user.toSafeJSON() : req.user });
});

const logout = asyncHandler(async (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

const getDashboard = asyncHandler(async (req, res) => {
  const [
    totalBookings,
    pendingRides,
    acceptedRides,
    completedRides,
    totalCustomers,
    blockedCustomers,
    activeDrivers,
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
    Booking.countDocuments({ bookingStatus: 'Pending' }),
    Booking.countDocuments({ bookingStatus: { $in: ['Accepted', 'Driver Assigned', 'Ride Started'] } }),
    Booking.countDocuments({ bookingStatus: { $in: ['Ride Completed', 'Fully Paid'] } }),
    User.countDocuments({ role: 'customer' }),
    User.countDocuments({ role: 'customer', isBlocked: true }),
    Driver.countDocuments({ availability: true }),
    Payment.countDocuments({ status: 'Pending' }),
    Payment.aggregate([{ $match: { status: 'Completed' } }, { $group: { _id: null, revenue: { $sum: '$amount' } } }]),
    Booking.aggregate([
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, total: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    Payment.aggregate([
      { $match: { status: 'Completed' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } }
    ]),
    User.aggregate([
      { $match: { role: 'customer' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, total: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    Booking.find().sort({ createdAt: -1 }).limit(8).populate('assignedDriver').lean(),
    Payment.find().sort({ createdAt: -1 }).limit(6).populate('booking').lean(),
    Contact.find().sort({ createdAt: -1 }).limit(6).lean(),
    Notification.find({ recipientRole: 'admin' }).sort({ createdAt: -1 }).limit(10).lean()
  ]);

  const [revenue] = revenueSummary;

  res.json({
    success: true,
    dashboard: {
      stats: {
        totalBookings,
        pendingRides,
        acceptedRides,
        completedRides,
        totalCustomers,
        blockedCustomers,
        activeDrivers,
        pendingPayments,
        revenue: revenue?.revenue || 0
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

const listBookings = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  const skip = (page - 1) * limit;
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const paymentStatus = String(req.query.paymentStatus || '').trim();
  const sort = String(req.query.sort || '-createdAt');

  const filters = [];
  if (status) filters.push({ bookingStatus: status });
  if (paymentStatus) filters.push({ paymentStatus });
  if (search) {
    const escaped = escapeRegExp(search);
    filters.push({
      $or: [
        { customerName: { $regex: escaped, $options: 'i' } },
        { bookingId: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } }
      ]
    });
  }

  const query = filters.length ? { $and: filters } : {};

  const [bookings, total] = await Promise.all([
    Booking.find(query).sort(sort).skip(skip).limit(limit).populate('assignedDriver').lean(),
    Booking.countDocuments(query)
  ]);

  res.json({ success: true, page, limit, total, pages: Math.ceil(total / limit), bookings });
});

const setBookingStatus = asyncHandler(async (req, res) => {
  const { status, rejectionReason, adminNotes } = req.body;
  const booking = await Booking.findById(req.params.id).populate('assignedDriver');
  if (!booking) throw new ApiError(404, 'Booking not found');

  booking.bookingStatus = status;
  booking.adminNotes = adminNotes || booking.adminNotes || '';

  if (status === 'Cancelled') {
    booking.rejectionReason = rejectionReason || booking.rejectionReason || 'Rejected by admin';
  }

  if (status === 'Fully Paid') {
    booking.paymentStatus = 'Fully Paid';
  }

  await booking.save();

  if (booking.email && status === 'Accepted') {
    await sendEmail({ to: booking.email, subject: `Booking accepted - ${booking.bookingId}`, html: bookingAccepted(booking) }).catch(() => undefined);
    await sendWhatsApp({ to: booking.phone, message: `Your booking ${booking.bookingId} has been accepted.` }).catch(() => undefined);
  }

  if (booking.email && status === 'Cancelled') {
    await sendEmail({
      to: booking.email,
      subject: `Booking rejected - ${booking.bookingId}`,
      html: `<div style="font-family:Arial,sans-serif"><h2>Booking Rejected</h2><p>Your booking <strong>${booking.bookingId}</strong> was rejected.</p><p>Reason: ${booking.rejectionReason || 'Not provided'}</p></div>`
    }).catch(() => undefined);
    await sendWhatsApp({ to: booking.phone, message: `Booking ${booking.bookingId} was cancelled. ${booking.rejectionReason || ''}`.trim() }).catch(() => undefined);
  }

  if (booking.email && status === 'Ride Completed') {
    await sendEmail({ to: booking.email, subject: `Ride completed - ${booking.bookingId}`, html: rideCompleted(booking) }).catch(() => undefined);
  }

  await notifyAdmins('booking:updated', {
    title: 'Booking updated',
    message: `${booking.bookingId} moved to ${booking.bookingStatus}`,
    bookingId: booking.bookingId,
    status: booking.bookingStatus,
    paymentStatus: booking.paymentStatus
  });

  res.json({ success: true, booking });
});

const assignDriverToBooking = asyncHandler(async (req, res) => {
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
    await sendWhatsApp({ to: booking.phone, message: `Driver ${driver.driverName} has been assigned to booking ${booking.bookingId}.` }).catch(() => undefined);
  }

  await notifyAdmins('booking:driver-assigned', {
    title: 'Driver assigned',
    message: `${driver.driverName} assigned to ${booking.bookingId}`,
    bookingId: booking.bookingId,
    driverName: driver.driverName,
    vehicleAssigned: driver.vehicleAssigned
  });

  res.json({ success: true, booking, driver });
});

const deleteBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(404, 'Booking not found');

  if (booking.assignedDriver) {
    await Driver.updateOne({ _id: booking.assignedDriver }, { $set: { availability: true } });
  }

  await booking.deleteOne();
  res.json({ success: true, message: 'Booking deleted successfully' });
});

const listDrivers = asyncHandler(async (req, res) => {
  const drivers = await Driver.find({}).sort({ createdAt: -1 }).lean();
  res.json({ success: true, drivers });
});

const createDriver = asyncHandler(async (req, res) => {
  const driver = await Driver.create(req.body);
  res.status(201).json({ success: true, driver });
});

const updateDriver = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) throw new ApiError(404, 'Driver not found');
  Object.assign(driver, req.body);
  await driver.save();
  res.json({ success: true, driver });
});

const deleteDriver = asyncHandler(async (req, res) => {
  const driver = await Driver.findByIdAndDelete(req.params.id);
  if (!driver) throw new ApiError(404, 'Driver not found');
  res.json({ success: true, message: 'Driver deleted successfully' });
});

const listCars = asyncHandler(async (req, res) => {
  const cars = await Car.find({}).sort({ createdAt: -1 }).lean();
  res.json({ success: true, cars });
});

const createCar = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (req.file) payload.image = `/uploads/${req.file.filename}`;
  payload.seatingCapacity = toNumber(payload.seatingCapacity, 1);
  payload.pricePerDay = toNumber(payload.pricePerDay, 0);
  payload.features = parseList(payload.features);
  const car = await Car.create(payload);
  res.status(201).json({ success: true, car });
});

const updateCar = asyncHandler(async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (!car) throw new ApiError(404, 'Car not found');

  const payload = { ...req.body };
  if (payload.seatingCapacity) payload.seatingCapacity = toNumber(payload.seatingCapacity, car.seatingCapacity);
  if (payload.pricePerDay) payload.pricePerDay = toNumber(payload.pricePerDay, car.pricePerDay);
  if (payload.features) payload.features = parseList(payload.features);

  Object.assign(car, payload);
  if (req.file) car.image = `/uploads/${req.file.filename}`;
  await car.save();
  res.json({ success: true, car });
});

const deleteCar = asyncHandler(async (req, res) => {
  const car = await Car.findByIdAndDelete(req.params.id);
  if (!car) throw new ApiError(404, 'Car not found');
  res.json({ success: true, message: 'Car deleted successfully' });
});

const listPackages = asyncHandler(async (req, res) => {
  const packages = await Package.find({}).sort({ createdAt: -1 }).lean();
  res.json({ success: true, packages });
});

const createPackage = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (req.file) payload.image = `/uploads/${req.file.filename}`;
  payload.price = toNumber(payload.price, 0);
  payload.destinations = parseList(payload.destinations);
  payload.inclusions = parseList(payload.inclusions);
  payload.exclusions = parseList(payload.exclusions);
  const tripPackage = await Package.create(payload);
  res.status(201).json({ success: true, package: tripPackage });
});

const updatePackage = asyncHandler(async (req, res) => {
  const tripPackage = await Package.findById(req.params.id);
  if (!tripPackage) throw new ApiError(404, 'Package not found');

  const payload = { ...req.body };
  if (payload.price) payload.price = toNumber(payload.price, tripPackage.price);
  if (payload.destinations) payload.destinations = parseList(payload.destinations);
  if (payload.inclusions) payload.inclusions = parseList(payload.inclusions);
  if (payload.exclusions) payload.exclusions = parseList(payload.exclusions);

  Object.assign(tripPackage, payload);
  if (req.file) tripPackage.image = `/uploads/${req.file.filename}`;
  await tripPackage.save();
  res.json({ success: true, package: tripPackage });
});

const deletePackage = asyncHandler(async (req, res) => {
  const tripPackage = await Package.findByIdAndDelete(req.params.id);
  if (!tripPackage) throw new ApiError(404, 'Package not found');
  res.json({ success: true, message: 'Package deleted successfully' });
});

const listRoutes = asyncHandler(async (req, res) => {
  const routes = await Route.find({}).sort({ createdAt: -1 }).lean();
  res.json({ success: true, routes });
});

const createRoute = asyncHandler(async (req, res) => {
  const route = await Route.create({ ...req.body, price: toNumber(req.body.price, 0) });
  res.status(201).json({ success: true, route });
});

const updateRoute = asyncHandler(async (req, res) => {
  const route = await Route.findById(req.params.id);
  if (!route) throw new ApiError(404, 'Route not found');
  Object.assign(route, { ...req.body, price: req.body.price ? toNumber(req.body.price, route.price) : route.price });
  await route.save();
  res.json({ success: true, route });
});

const deleteRoute = asyncHandler(async (req, res) => {
  const route = await Route.findByIdAndDelete(req.params.id);
  if (!route) throw new ApiError(404, 'Route not found');
  res.json({ success: true, message: 'Route deleted successfully' });
});

const listCustomers = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  const skip = (page - 1) * limit;
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const filters = [{ role: 'customer' }];

  if (search) {
    const escaped = escapeRegExp(search);
    filters.push({
      $or: [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } }
      ]
    });
  }

  if (status === 'blocked') filters.push({ isBlocked: true });
  if (status === 'active') filters.push({ isBlocked: false });

  const query = { $and: filters };
  const [customers, total] = await Promise.all([
    User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(query)
  ]);

  res.json({ success: true, page, limit, total, pages: Math.ceil(total / limit), customers });
});

const blockCustomer = asyncHandler(async (req, res) => {
  const customer = await User.findOne({ _id: req.params.id, role: 'customer' });
  if (!customer) throw new ApiError(404, 'Customer not found');
  customer.isBlocked = toBoolean(req.body.isBlocked, true);
  await customer.save();
  res.json({ success: true, customer });
});

const deleteCustomer = asyncHandler(async (req, res) => {
  const customer = await User.findOneAndDelete({ _id: req.params.id, role: 'customer' });
  if (!customer) throw new ApiError(404, 'Customer not found');
  res.json({ success: true, message: 'Customer deleted successfully' });
});

const listPayments = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  const skip = (page - 1) * limit;
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const filters = [];

  if (status) filters.push({ status });
  if (search) {
    const escaped = escapeRegExp(search);
    const bookingMatches = await Booking.find({ bookingId: { $regex: escaped, $options: 'i' } }).select('_id');
    filters.push({ $or: [{ providerPaymentId: { $regex: escaped, $options: 'i' } }, { providerSessionId: { $regex: escaped, $options: 'i' } }, { booking: { $in: bookingMatches.map((b) => b._id) } }] });
  }

  const query = filters.length ? { $and: filters } : {};
  const [payments, total] = await Promise.all([
    Payment.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('booking').lean(),
    Payment.countDocuments(query)
  ]);

  res.json({ success: true, page, limit, total, pages: Math.ceil(total / limit), payments });
});

const refundPayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id).populate('booking');
  if (!payment) throw new ApiError(404, 'Payment not found');

  if (payment.status === 'Refunded') {
    return res.json({ success: true, message: 'Payment was already refunded', refund: null });
  }

  const stripe = getStripe();
  if (!stripe) {
    payment.status = 'Refunded';
    payment.refundedAt = new Date();
    await payment.save();
    if (payment.booking) {
      payment.booking.paymentStatus = 'Refunded';
      payment.booking.bookingStatus = 'Cancelled';
      await payment.booking.save();
    }
    return res.json({ success: true, message: 'Refund marked manually because Stripe is not configured', refund: null, manualRefund: true });
  }

  if (!payment.providerPaymentId) throw new ApiError(400, 'Provider payment id missing');

  const refund = await stripe.refunds.create({ payment_intent: payment.providerPaymentId });
  payment.status = 'Refunded';
  payment.refundedAt = new Date();
  await payment.save();

  if (payment.booking) {
    payment.booking.paymentStatus = 'Refunded';
    payment.booking.bookingStatus = 'Cancelled';
    await payment.booking.save();
  }

  res.json({ success: true, message: 'Refund processed successfully', refund });
});

const listMessages = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  const skip = (page - 1) * limit;
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const filters = [];

  if (status) filters.push({ status });
  if (search) {
    const escaped = escapeRegExp(search);
    filters.push({
      $or: [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { subject: { $regex: escaped, $options: 'i' } },
        { message: { $regex: escaped, $options: 'i' } }
      ]
    });
  }

  const query = filters.length ? { $and: filters } : {};
  const [messages, total] = await Promise.all([
    Contact.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Contact.countDocuments(query)
  ]);

  res.json({ success: true, page, limit, total, pages: Math.ceil(total / limit), messages });
});

const replyMessage = asyncHandler(async (req, res) => {
  const { reply } = req.body;
  const message = await Contact.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found');
  if (!reply) throw new ApiError(400, 'Reply is required');

  message.reply = reply;
  message.status = 'resolved';
  message.repliedAt = new Date();
  message.resolvedAt = new Date();
  await message.save();

  await sendEmail({
    to: message.email,
    subject: `Re: ${message.subject}`,
    html: `<div style="font-family:Arial,sans-serif"><h2>Thanks for contacting us</h2><p>${reply}</p></div>`
  }).catch(() => undefined);

  await sendWhatsApp({ to: message.phone, message: reply }).catch(() => undefined);

  res.json({ success: true, message });
});

const resolveMessage = asyncHandler(async (req, res) => {
  const message = await Contact.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found');
  message.status = 'resolved';
  message.resolvedAt = new Date();
  await message.save();
  res.json({ success: true, message });
});

const deleteMessage = asyncHandler(async (req, res) => {
  const message = await Contact.findByIdAndDelete(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found');
  res.json({ success: true, message: 'Message deleted successfully' });
});

const getSettings = asyncHandler(async (req, res) => {
  const settings = await getSettingsDocument();
  res.json({ success: true, settings });
});

const updateSettings = asyncHandler(async (req, res) => {
  const settings = await getSettingsDocument();
  const payload = mapSettingsPayload(req.body, req.file);

  if (payload.businessName) settings.businessName = payload.businessName;
  if (payload.contactEmail) settings.contactEmail = payload.contactEmail;
  if (payload.contactPhone) settings.contactPhone = payload.contactPhone;
  if (payload.address) settings.address = payload.address;
  if (payload.logoText) settings.logoText = payload.logoText;
  if (payload.socialLinks) settings.socialLinks = { ...(settings.socialLinks?.toObject ? settings.socialLinks.toObject() : settings.socialLinks || {}), ...payload.socialLinks };
  if (payload.paymentSettings) settings.paymentSettings = { ...(settings.paymentSettings?.toObject ? settings.paymentSettings.toObject() : settings.paymentSettings || {}), ...payload.paymentSettings };
  if (payload.notificationSettings) settings.notificationSettings = { ...(settings.notificationSettings?.toObject ? settings.notificationSettings.toObject() : settings.notificationSettings || {}), ...payload.notificationSettings };
  if (payload.homepage) {
    settings.homepage = {
      ...(settings.homepage?.toObject ? settings.homepage.toObject() : settings.homepage || {}),
      ...payload.homepage,
      bannerImage: payload.homepage.bannerImage || settings.homepage?.bannerImage || ''
    };
  }

  await settings.save();
  res.json({ success: true, settings });
});

const listNotifications = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const skip = (page - 1) * limit;
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find({ recipientRole: 'admin' }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments({ recipientRole: 'admin' }),
    Notification.countDocuments({ recipientRole: 'admin', readAt: null })
  ]);

  res.json({ success: true, page, limit, total, pages: Math.ceil(total / limit), unreadCount, notifications });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);
  if (!notification) throw new ApiError(404, 'Notification not found');
  notification.readAt = new Date();
  await notification.save();
  res.json({ success: true, notification });
});

const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findByIdAndDelete(req.params.id);
  if (!notification) throw new ApiError(404, 'Notification not found');
  res.json({ success: true, message: 'Notification deleted successfully' });
});

module.exports = {
  login,
  me,
  logout,
  getDashboard,
  listBookings,
  setBookingStatus,
  assignDriverToBooking,
  deleteBooking,
  listDrivers,
  createDriver,
  updateDriver,
  deleteDriver,
  listCars,
  createCar,
  updateCar,
  deleteCar,
  listPackages,
  createPackage,
  updatePackage,
  deletePackage,
  listRoutes,
  createRoute,
  updateRoute,
  deleteRoute,
  listCustomers,
  blockCustomer,
  deleteCustomer,
  listPayments,
  refundPayment,
  listMessages,
  replyMessage,
  resolveMessage,
  deleteMessage,
  getSettings,
  updateSettings,
  listNotifications,
  markNotificationRead,
  deleteNotification
};