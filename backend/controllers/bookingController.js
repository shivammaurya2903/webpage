const crypto = require('crypto');
const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const SiteSettings = require('../models/SiteSettings');
const Driver = require('../models/Driver');
const Route = require('../models/Route');
const Car = require('../models/Car');
const Package = require('../models/Package');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { createBookingId } = require('../utils/bookingId');
const { createInvoiceId } = require('../utils/invoiceId');
const { buildInvoicePdf } = require('../utils/invoicePdf');
const { normalizePaymentMethod: normalizeBillingPaymentMethod, normalizePaymentStatus: normalizeBillingPaymentStatus } = require('../utils/billingWorkflow');
const { calculateFareQuote } = require('../services/fareCalculator');
const { normalizeChargeItems } = require('../utils/billingWorkflow');
const { notifyBookingCreated, notifyBookingStatusChange } = require('../services/notificationService');
const { bookingConfirmation } = require('../services/emailTemplates');
const { sendEmail } = require('../services/emailService');
const { sendWhatsApp } = require('../services/whatsappService');

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeBookingStatus(status) {
  const value = String(status || '').trim();
  const aliases = {
    Accepted: 'Approved',
    'Payment Pending': 'Invoice Generated',
    'Fully Paid': 'Paid'
  };

  return aliases[value] || value;
}

function normalizePaymentStatus(status) {
  const value = String(status || '').trim();
  const aliases = {
    'Advance Paid': 'Partial',
    'Partially Paid': 'Partial',
    'Fully Paid': 'Paid',
    'Paid Online': 'Paid',
    'Paid Offline': 'Paid',
    Paid: 'Paid',
    Unpaid: 'Pending',
    'Payment Pending': 'Pending',
    'Invoice Generated': 'Pending'
  };

  return aliases[value] || value || 'Pending';
}

function normalizePaymentMethod(method) {
  const value = String(method || '').trim().toLowerCase();
  const aliases = {
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    online: 'Online payment link',
    'online payment link': 'Online payment link',
    bank: 'Bank transfer',
    'bank transfer': 'Bank transfer'
  };

  return aliases[value] || method || '';
}

function buildFinalBill(estimatedFare) {
  const baseAmount = Number(estimatedFare || 0);
  const taxAmount = Math.max(0, Math.round(baseAmount * 0.05));
  const discountAmount = 0;
  const totalAmount = Math.max(0, baseAmount + taxAmount - discountAmount);

  return {
    baseAmount,
    taxAmount,
    discountAmount,
    totalAmount,
    currency: 'INR'
  };
}

async function findInvoiceForBooking(booking) {
  if (booking.invoice) return Invoice.findById(booking.invoice);
  if (booking.invoiceId) return Invoice.findOne({ invoiceId: booking.invoiceId });
  return Invoice.findOne({ booking: booking._id });
}

async function findBestRoute(pickupLocation, dropLocation) {
  const routes = await Route.find({});
  return routes.find((route) => {
    const fromMatch = pickupLocation.toLowerCase().includes(route.from.toLowerCase()) || route.from.toLowerCase().includes(pickupLocation.toLowerCase());
    const toMatch = dropLocation.toLowerCase().includes(route.to.toLowerCase()) || route.to.toLowerCase().includes(dropLocation.toLowerCase());
    return fromMatch && toMatch;
  }) || null;
}

function parseCoordinates(value) {
  if (!value) return null;
  if (Array.isArray(value) && value.length >= 2) {
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
  }

  if (typeof value === 'string') {
    const parts = value.split(',').map((item) => Number(item.trim()));
    if (parts.length >= 2 && parts.every(Number.isFinite)) return [parts[0], parts[1]];
  }

  if (typeof value === 'object') {
    const longitude = Number(value.longitude ?? value.lng ?? value.lon);
    const latitude = Number(value.latitude ?? value.lat);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) return [longitude, latitude];
  }

  return null;
}

function parseLocalDateOnly(value) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(value || '').trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function normalizeIndianPhone(value) {
  const cleaned = String(value || '').trim().replace(/[\s-]/g, '');
  if (!cleaned || /[^+0-9]/.test(cleaned)) return '';

  let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2);
  }

  if (!/^[6-9][0-9]{9}$/.test(digits)) return '';
  return `+91${digits}`;
}

function validationError(field, message) {
  return new ApiError(400, 'Validation failed', [{ field, message }]);
}

function createBookingSignature(data) {
  const signatureSource = [
    String(data.customerName || '').trim().toLowerCase(),
    String(data.email || '').trim().toLowerCase(),
    String(data.phone || '').trim(),
    String(data.pickupLocation || '').trim().toLowerCase(),
    String(data.dropLocation || '').trim().toLowerCase(),
    String(data.pickupDate || '').trim(),
    String(data.pickupTime || '').trim(),
    String(data.selectedCar || '').trim().toLowerCase(),
    String(data.selectedPackage || '').trim().toLowerCase(),
    String(data.tripType || '').trim().toLowerCase(),
    String(data.vehicleId || '').trim()
  ].join('|');

  return crypto.createHash('sha256').update(signatureSource).digest('hex');
}

async function resolveSelectedCar({ vehicleId, selectedCar }) {
  if (vehicleId) {
    const carById = await Car.findById(vehicleId);
    if (carById) return carById;
  }

  if (selectedCar) {
    return Car.findOne({ carName: new RegExp(`^${escapeRegExp(selectedCar)}$`, 'i') });
  }

  return null;
}

const createBooking = asyncHandler(async (req, res) => {
  const customerName = String(req.body.customerName || req.body.fullName || '').trim();
  if (customerName.length < 2) throw validationError('customerName', 'Customer name is required');

  const normalizedPhone = normalizeIndianPhone(req.body.phone);
  if (!normalizedPhone) throw validationError('phone', 'Please enter a valid Indian mobile number.');

  const email = String(req.body.email || '').trim().toLowerCase();
  const pickupLocation = String(req.body.pickupLocation || '').trim();
  const dropLocation = String(req.body.dropLocation || '').trim();
  const pickupDateValue = String(req.body.pickupDate || '').trim();
  const pickupDate = parseLocalDateOnly(pickupDateValue);
  const pickupTime = String(req.body.pickupTime || '').trim();
  const passengers = String(req.body.passengers || '').trim();
  const selectedCar = String(req.body.selectedCar || '').trim();
  const selectedPackage = String(req.body.selectedPackage || req.body.tripType || '').trim();
  const tripType = String(req.body.tripType || req.body.selectedPackage || '').trim();
  const vehicleId = String(req.body.vehicleId || req.body.selectedCarId || '').trim();

  if (!email) throw validationError('email', 'Valid email is required');
  if (!pickupLocation) throw validationError('pickupLocation', 'Pickup location is required');
  if (!dropLocation) throw validationError('dropLocation', 'Drop location is required');
  if (!pickupDate) throw validationError('pickupDate', 'Valid pickup date is required');
  if (pickupDate < startOfToday()) throw validationError('pickupDate', 'Booking date cannot be earlier than today.');
  if (!pickupTime) throw validationError('pickupTime', 'Valid pickup time is required');
  if (!passengers) throw validationError('passengers', 'Passenger count is required');
  if (!selectedCar) throw validationError('selectedCar', 'Selected car is required');
  if (!selectedPackage) throw validationError('selectedPackage', 'Selected package is required');
  if (!vehicleId) throw validationError('vehicleId', 'Vehicle selection is required');

  const dropDateValue = String(req.body.dropDate || '').trim();
  if (dropDateValue) {
    const dropDate = parseLocalDateOnly(dropDateValue);
    if (!dropDate) throw validationError('dropDate', 'Valid drop date is required');
    if (dropDate < pickupDate) throw validationError('dropDate', 'Drop date cannot be earlier than pickup date.');
  }

  const payload = {
    customerName,
    phone: normalizedPhone,
    email,
    pickupLocation,
    pickupAddress: pickupLocation,
    dropLocation,
    destinationAddress: dropLocation,
    pickupDate: pickupDateValue,
    pickupTime,
    passengers,
    selectedCar,
    selectedPackage,
    tripType,
    vehicleId,
    pickupCoordinates: parseCoordinates(req.body.pickupCoordinates || req.body.pickupCoords),
    destinationCoordinates: parseCoordinates(req.body.destinationCoordinates || req.body.destinationCoords || req.body.dropCoordinates || req.body.dropCoords),
    dropCoordinates: parseCoordinates(req.body.dropCoordinates || req.body.dropCoords || req.body.destinationCoordinates || req.body.destinationCoords),
    specialRequirements: String(req.body.specialRequirements || req.body.requirements || '').trim(),
    user: req.user?._id || null
  };

  const bookingSignature = createBookingSignature({
    customerName: payload.customerName,
    email: payload.email,
    phone: payload.phone,
    pickupLocation: payload.pickupLocation,
    dropLocation: payload.dropLocation,
    pickupDate: payload.pickupDate,
    pickupTime: payload.pickupTime,
    selectedCar: payload.selectedCar,
    selectedPackage: payload.selectedPackage,
    tripType: payload.tripType,
    vehicleId: payload.vehicleId
  });

  const recentDuplicate = await Booking.findOne({ bookingSignature });
  if (recentDuplicate) {
    throw new ApiError(409, 'This booking request was already submitted. Please wait for confirmation or update the existing booking.');
  }

  const [car, tripPackage, route, settings] = await Promise.all([
    resolveSelectedCar({ vehicleId: payload.vehicleId, selectedCar: payload.selectedCar }),
    Package.findOne({ packageName: new RegExp(`^${escapeRegExp(payload.selectedPackage)}$`, 'i') }),
    findBestRoute(payload.pickupLocation, payload.dropLocation),
    SiteSettings.findOne({}).lean()
  ]);

  if (!car) {
    throw validationError('selectedCar', 'Selected vehicle could not be resolved');
  }

  const pricing = await calculateFareQuote({
    pickup: {
      address: payload.pickupLocation,
      coordinates: payload.pickupCoordinates
    },
    drop: {
      address: payload.dropLocation,
      coordinates: payload.destinationCoordinates || payload.dropCoordinates
    },
    vehicle: car,
    tripPackage,
    route,
    tripType: payload.tripType,
    passengers: payload.passengers,
    pickupDateTime: `${payload.pickupDate}T${payload.pickupTime}`,
    settings
  });

  let booking;
  try {
    booking = await Booking.create({
      bookingId: createBookingId(),
      bookingSignature,
      ...payload,
      pickupDate,
      pickupCoordinates: payload.pickupCoordinates,
      dropCoordinates: payload.destinationCoordinates || payload.dropCoordinates,
      destinationCoordinates: payload.destinationCoordinates || payload.dropCoordinates,
      distanceInKm: pricing.distanceInKm,
      estimatedDuration: pricing.estimatedDuration,
      duration: pricing.estimatedDuration,
      baseFare: pricing.fareBreakdown.baseFare,
      perKmRate: pricing.fareBreakdown.pricePerKm,
      pricePerKm: pricing.fareBreakdown.pricePerKm,
      distanceFare: pricing.fareBreakdown.distanceFare,
      tollCharges: pricing.fareBreakdown.tollCharges,
      waitingCharges: pricing.fareBreakdown.waitingCharges,
      nightCharges: pricing.fareBreakdown.nightCharges,
      driverAllowance: pricing.fareBreakdown.driverAllowance,
      extraCharges: normalizeChargeItems(req.body.extraCharges || req.body.extraChargeItems),
      gstAmount: pricing.fareBreakdown.gstAmount,
      subtotal: pricing.fareBreakdown.subtotalAmount,
      estimatedFare: pricing.totalFare,
      totalFare: pricing.totalFare,
      fareBreakdown: pricing.fareBreakdown,
      routeGeometry: pricing.routeGeometry || [],
      statusHistory: [{ status: 'Pending', at: new Date(), note: 'Booking created' }],
      finalBill: {
        ...pricing.fareBreakdown,
        currency: 'INR',
        payableAfterRide: true,
        source: pricing.source,
        routeGeometry: pricing.routeGeometry,
        pickupCoordinates: pricing.pickup?.coordinates || null,
        dropCoordinates: pricing.drop?.coordinates || null,
        destinationCoordinates: pricing.drop?.coordinates || null
      },
      paymentStatus: 'Pending',
      bookingStatus: 'Pending'
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.bookingSignature) {
      throw new ApiError(409, 'This booking request was already submitted. Please wait for confirmation or update the existing booking.');
    }
    throw error;
  }

  await notifyBookingCreated(booking);

  await sendEmail({
    to: booking.email,
    subject: `Booking received - ${booking.bookingId}`,
    html: bookingConfirmation(booking)
  }).catch(() => undefined);

  await sendWhatsApp({
    to: booking.phone,
    message: `Booking received: ${booking.bookingId}. Your request is pending approval and payment is due after ride completion.`
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
    const escapedSearch = escapeRegExp(search);
    queryParts.push({
      $or: [
        { customerName: { $regex: escapedSearch, $options: 'i' } },
        { bookingId: { $regex: escapedSearch, $options: 'i' } },
        { phone: { $regex: escapedSearch, $options: 'i' } },
        { email: { $regex: escapedSearch, $options: 'i' } }
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
    Booking.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('assignedDriver').populate('invoice').lean(),
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
  const booking = await Booking.findById(req.params.id).populate('assignedDriver').populate('user').populate('invoice');
  if (!booking) throw new ApiError(404, 'Booking not found');

  const isOwner = req.user && (req.user.role === 'admin' || String(booking.user?._id) === String(req.user._id) || booking.email === req.user.email);
  if (!isOwner) throw new ApiError(403, 'Not allowed to view this booking');

  res.json({ success: true, booking });
});

const updateBookingStatus = asyncHandler(async (req, res) => {
  const status = normalizeBookingStatus(req.body.status);
  const booking = await Booking.findById(req.params.id).populate('assignedDriver');
  if (!booking) throw new ApiError(404, 'Booking not found');

  booking.bookingStatus = status;
    if (status === 'Approved') {
    booking.approvedAt = booking.approvedAt || new Date();
    booking.paymentStatus = normalizeBillingPaymentStatus(booking.paymentStatus || 'Pending');
  }

  if (status === 'Rejected') {
    booking.rejectedAt = new Date();
    booking.rejectionReason = req.body.rejectionReason || booking.rejectionReason || 'Rejected by admin';
    booking.paymentStatus = normalizeBillingPaymentStatus(booking.paymentStatus || 'Pending');
  }

  if (status === 'Ride Started') booking.rideStartedAt = new Date();
  if (status === 'Ride Completed') booking.rideCompletedAt = new Date();

  if (status === 'Paid') {
    booking.paymentMethod = normalizeBillingPaymentMethod(req.body.paymentMethod || booking.paymentMethod || 'Cash');
    booking.paymentStatus = normalizeBillingPaymentStatus(req.body.paymentStatus || 'Paid');
    booking.paymentDate = req.body.paymentDate || new Date();
    booking.paidAt = booking.paymentDate;
    booking.transactionId = String(req.body.transactionId || req.body.reference || booking.transactionId || '').trim();
    booking.paidAmount = Math.max(0, Number(req.body.paidAmount || booking.totalFare || booking.estimatedFare || 0));
    booking.balanceAmount = Math.max(0, Number(req.body.balanceAmount || 0));
  }

  booking.statusHistory = Array.isArray(booking.statusHistory) ? booking.statusHistory : [];
  booking.statusHistory.push({
    status: booking.bookingStatus,
    at: new Date(),
    note: booking.rejectionReason || req.body.adminNotes || ''
  });

  await booking.save();

  await notifyBookingStatusChange({
    booking,
    status: booking.bookingStatus,
    note: booking.rejectionReason || '',
    userId: booking.user || null,
    socketEvent: 'booking:status-updated'
  });
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
  booking.statusHistory = Array.isArray(booking.statusHistory) ? booking.statusHistory : [];
  booking.statusHistory.push({
    status: booking.bookingStatus,
    at: new Date(),
    note: `Driver ${driver.driverName} has been assigned`
  });
  await booking.save();

  driver.availability = false;
  await driver.save();

  await notifyBookingStatusChange({
    booking,
    status: booking.bookingStatus,
    note: `Driver ${driver.driverName} has been assigned`,
    userId: booking.user || null,
    socketEvent: 'booking:driver-assigned',
    adminEvent: 'booking:driver-assigned',
    adminTitle: 'Driver assigned'
  });

  res.json({ success: true, booking, driver });
});

const downloadBookingInvoice = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate('assignedDriver').populate('user').populate('invoice');
  if (!booking) throw new ApiError(404, 'Booking not found');

  const isOwner = req.user && (req.user.role === 'admin' || String(booking.user?._id) === String(req.user._id) || booking.email === req.user.email);
  if (!isOwner) throw new ApiError(403, 'Not allowed to download this invoice');

  const invoice = booking.invoice || await findInvoiceForBooking(booking);
  if (!invoice) throw new ApiError(404, 'Invoice not found');

  const settings = await SiteSettings.findOne({}).lean();

  const pdfBuffer = await buildInvoicePdf({ booking, invoice, driver: booking.assignedDriver, settings });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceId || booking.bookingId}.pdf"`);
  res.send(pdfBuffer);
});

const deleteBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(404, 'Booking not found');

  await notifyBookingStatusChange({
    booking,
    status: 'Cancelled',
    note: 'Booking deleted by admin',
    userId: booking.user || null,
    socketEvent: 'booking:cancelled',
    adminEvent: 'booking:cancelled',
    adminTitle: 'Booking cancelled'
  });

  if (booking.assignedDriver) {
    await Driver.updateOne({ _id: booking.assignedDriver }, { $set: { availability: true } });
  }

  if (booking.invoice) {
    await Invoice.deleteOne({ _id: booking.invoice }).catch(() => undefined);
  }

  await booking.deleteOne();
  res.json({ success: true, message: 'Booking deleted successfully' });
});

module.exports = {
  createBooking,
  getBookings,
  getBookingById,
  updateBookingStatus,
  assignDriver,
  downloadBookingInvoice,
  deleteBooking
};