const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const Driver = require('../models/Driver');
const Route = require('../models/Route');
const Car = require('../models/Car');
const Package = require('../models/Package');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { createBookingId } = require('../utils/bookingId');
const { estimateFare } = require('../utils/fareEstimator');
const { createInvoiceId } = require('../utils/invoiceId');
const { buildInvoicePdf } = require('../utils/invoicePdf');
const { notifyAdmins } = require('../services/notificationService');
const { bookingConfirmation, bookingAccepted, driverAssigned, rideCompleted, invoiceGenerated, paymentReceipt } = require('../services/emailTemplates');
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
    'Advance Paid': 'Paid Offline',
    'Fully Paid': 'Paid Offline',
    Paid: 'Paid Offline'
  };

  return aliases[value] || value;
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
    Car.findOne({ carName: new RegExp(`^${escapeRegExp(payload.selectedCar)}$`, 'i') }),
    Package.findOne({ packageName: new RegExp(`^${escapeRegExp(payload.selectedPackage)}$`, 'i') }),
    findBestRoute(payload.pickupLocation, payload.dropLocation)
  ]);

  const pricing = estimateFare({ car, tripPackage, route, passengers: payload.passengers });

  const booking = await Booking.create({
    bookingId: createBookingId(),
    ...payload,
    pickupDate: new Date(`${payload.pickupDate}T00:00:00`),
    estimatedFare: pricing.estimatedFare,
    totalFare: pricing.estimatedFare,
    finalBill: {
      estimatedFare: pricing.estimatedFare,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: pricing.estimatedFare,
      currency: 'INR',
      payableAfterRide: true
    },
    paymentStatus: 'Unpaid',
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
    if (booking.paymentStatus === 'Unpaid') booking.paymentStatus = 'Pending';
  }

  if (status === 'Rejected') {
    booking.rejectedAt = new Date();
    booking.rejectionReason = req.body.rejectionReason || booking.rejectionReason || 'Rejected by admin';
    booking.paymentStatus = 'Unpaid';
  }

  if (status === 'Ride Started') booking.rideStartedAt = new Date();
  if (status === 'Ride Completed') booking.rideCompletedAt = new Date();

  if (status === 'Paid') {
    booking.paymentMethod = normalizePaymentMethod(req.body.paymentMethod || booking.paymentMethod || 'Cash');
    booking.paymentStatus = normalizePaymentStatus(req.body.paymentStatus || 'Paid Offline');
    booking.paidAt = new Date();
  }

  await booking.save();

  if (booking.email && status === 'Approved') {
    await sendEmail({ to: booking.email, subject: `Booking approved - ${booking.bookingId}`, html: bookingAccepted(booking) }).catch(() => undefined);
    await sendWhatsApp({ to: booking.phone, message: `Your booking ${booking.bookingId} has been approved.` }).catch(() => undefined);
  }

  if (booking.email && status === 'Ride Completed') {
    await sendEmail({ to: booking.email, subject: `Ride completed - ${booking.bookingId}`, html: rideCompleted(booking) }).catch(() => undefined);
    await sendWhatsApp({ to: booking.phone, message: `Your ride for booking ${booking.bookingId} has been completed. The invoice will be generated shortly.` }).catch(() => undefined);
  }

  if (booking.email && status === 'Rejected') {
    await sendWhatsApp({ to: booking.phone, message: `Booking ${booking.bookingId} was rejected. ${booking.rejectionReason || ''}`.trim() }).catch(() => undefined);
  }

  if (booking.email && status === 'Paid') {
    const invoice = await findInvoiceForBooking(booking);
    const summary = invoice || {
      invoiceId: booking.invoiceId || 'PENDING',
      totalFare: booking.totalFare || booking.estimatedFare || 0,
      paymentStatus: booking.paymentStatus,
      paymentMethod: booking.paymentMethod
    };
    await sendEmail({ to: booking.email, subject: `Payment receipt - ${booking.bookingId}`, html: paymentReceipt(summary, booking) }).catch(() => undefined);
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

const downloadBookingInvoice = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate('assignedDriver').populate('user').populate('invoice');
  if (!booking) throw new ApiError(404, 'Booking not found');

  const isOwner = req.user && (req.user.role === 'admin' || String(booking.user?._id) === String(req.user._id) || booking.email === req.user.email);
  if (!isOwner) throw new ApiError(403, 'Not allowed to download this invoice');

  const invoice = booking.invoice || await findInvoiceForBooking(booking);
  if (!invoice) throw new ApiError(404, 'Invoice not found');

  const pdfBuffer = await buildInvoicePdf({ booking, invoice, driver: booking.assignedDriver });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceId || booking.bookingId}.pdf"`);
  res.send(pdfBuffer);
});

module.exports = {
  createBooking,
  getBookings,
  getBookingById,
  updateBookingStatus,
  assignDriver,
  downloadBookingInvoice
};