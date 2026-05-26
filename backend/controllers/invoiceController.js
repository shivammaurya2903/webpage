const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const SiteSettings = require('../models/SiteSettings');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { createInvoiceId } = require('../utils/invoiceId');
const { buildInvoicePdf, buildInvoiceModel } = require('../utils/invoicePdf');
const { calculateFareQuote } = require('../services/fareCalculator');
const { notifyAdmins, notifyCustomer } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');
const { invoiceGenerated, paymentReceipt } = require('../services/emailTemplates');
const { sendWhatsApp } = require('../services/whatsappService');

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

  return aliases[value] || method || 'Cash';
}

function normalizePaymentStatus(status, method) {
  const value = String(status || '').trim();
  if (value) return value;
  if (['Cash', 'UPI'].includes(method)) return 'Paid Offline';
  if (['Card', 'Online payment link'].includes(method)) return 'Paid Online';
  return 'Paid Offline';
}

async function loadSettings() {
  return SiteSettings.findOne({}).lean();
}

async function buildBillingQuoteFromBooking(booking, settings) {
  return calculateFareQuote({
    pickup: {
      address: booking.pickupLocation,
      coordinates: booking.pickupCoordinates
    },
    drop: {
      address: booking.dropLocation,
      coordinates: booking.dropCoordinates
    },
    vehicleId: booking.vehicleId,
    selectedCar: booking.selectedCar,
    tripPackage: {
      packageName: booking.selectedPackage,
      price: booking.fareBreakdown?.packageBaseFare || booking.finalBill?.packageBaseFare || 0,
      includedKm: booking.fareBreakdown?.includedKm || booking.finalBill?.includedKm || 0,
      includedHours: booking.fareBreakdown?.includedHours || booking.finalBill?.includedHours || 0
    },
    tripType: booking.tripType,
    passengers: booking.passengers,
    pickupDateTime: booking.pickupDate && booking.pickupTime ? `${new Date(booking.pickupDate).toISOString().slice(0, 10)}T${booking.pickupTime}` : null,
    waitingMinutes: booking.fareBreakdown?.waitingMinutes || booking.finalBill?.waitingMinutes || 0,
    tollCharges: booking.fareBreakdown?.tollCharges || booking.finalBill?.tollCharges || booking.tollCharges || 0,
    extraCharges: booking.fareBreakdown?.extraTravelCharges || booking.finalBill?.extraTravelCharges || booking.extraCharges || 0,
    tripDays: booking.fareBreakdown?.driverAllowanceDays || booking.finalBill?.driverAllowanceDays || 0,
    settings
  });
}

function syncInvoiceFromModel(booking, invoice, model, finalBill, paymentStatus) {
  booking.invoiceId = invoice.invoiceId;
  booking.invoiceGenerated = true;
  booking.bookingStatus = 'Invoice Generated';
  booking.paymentStatus = paymentStatus || 'Pending';
  booking.distanceInKm = finalBill.distanceInKm || booking.distanceInKm || 0;
  booking.duration = finalBill.estimatedDuration || booking.duration || booking.estimatedDuration || 0;
  booking.estimatedDuration = finalBill.estimatedDuration || booking.estimatedDuration || 0;
  booking.baseFare = finalBill.baseFare || booking.baseFare || 0;
  booking.pricePerKm = finalBill.pricePerKm || booking.pricePerKm || booking.perKmRate || 0;
  booking.perKmRate = booking.pricePerKm;
  booking.distanceFare = finalBill.distanceFare || booking.distanceFare || 0;
  booking.tollCharges = finalBill.tollCharges || booking.tollCharges || 0;
  booking.waitingCharges = finalBill.waitingCharges || booking.waitingCharges || 0;
  booking.nightCharges = finalBill.nightCharges || booking.nightCharges || 0;
  booking.driverAllowance = finalBill.driverAllowance || booking.driverAllowance || 0;
  booking.extraCharges = finalBill.extraTravelCharges || booking.extraCharges || 0;
  booking.gstAmount = finalBill.gstAmount || booking.gstAmount || 0;
  booking.subtotal = finalBill.subtotalAmount || finalBill.subtotal || booking.subtotal || 0;
  booking.totalFare = finalBill.totalAmount;
  booking.finalBill = {
    ...finalBill,
    payableAfterRide: true,
    paymentStatus: paymentStatus || 'Pending'
  };

  invoice.booking = booking._id;
  invoice.bookingId = booking.bookingId;
  invoice.customerName = booking.customerName;
  invoice.email = booking.email;
  invoice.phone = booking.phone;
  invoice.pickupLocation = booking.pickupLocation;
  invoice.dropLocation = booking.dropLocation;
  invoice.pickupDate = booking.pickupDate;
  invoice.pickupTime = booking.pickupTime;
  invoice.vehicle = booking.selectedCar;
  invoice.driverName = booking.assignedDriver?.driverName || invoice.driverName || '';
  invoice.driverPhone = booking.assignedDriver?.phone || invoice.driverPhone || '';
  invoice.carType = booking.selectedPackage || invoice.carType || '';
  invoice.distance = booking.distanceInKm ? `${Number(booking.distanceInKm).toFixed(1)} KM` : booking.finalBill?.distance || invoice.distance || '';
  invoice.distanceValue = invoice.distance;
  invoice.duration = booking.duration || booking.estimatedDuration || invoice.duration || 0;
  invoice.pricePerKm = booking.pricePerKm || booking.perKmRate || invoice.pricePerKm || 0;
  invoice.distanceFare = booking.distanceFare || invoice.distanceFare || 0;
  invoice.tollCharges = booking.tollCharges || invoice.tollCharges || 0;
  invoice.waitingCharges = booking.waitingCharges || invoice.waitingCharges || 0;
  invoice.nightCharges = booking.nightCharges || invoice.nightCharges || 0;
  invoice.driverAllowance = booking.driverAllowance || invoice.driverAllowance || 0;
  invoice.extraCharges = booking.extraCharges || invoice.extraCharges || 0;
  invoice.businessSnapshot = model.business;
  invoice.customerSnapshot = model.customer;
  invoice.rideSnapshot = model.ride;
  invoice.lineItems = model.lineItems;
  invoice.paymentSummary = model.payment;
  invoice.terms = model.terms;
  invoice.fareBreakdown = {
    ...finalBill,
    currency: finalBill.currency || 'INR'
  };
  invoice.subtotalAmount = finalBill.subtotalAmount || finalBill.subtotal || finalBill.baseAmount || 0;
  invoice.subtotal = invoice.subtotalAmount;
  invoice.taxAmount = finalBill.taxAmount || finalBill.gstAmount || 0;
  invoice.cgstAmount = finalBill.cgstAmount;
  invoice.sgstAmount = finalBill.sgstAmount;
  invoice.taxPercent = finalBill.taxPercent || finalBill.gstPercent || 5;
  invoice.discountAmount = finalBill.discountAmount;
  invoice.totalFare = finalBill.totalAmount;
  invoice.paymentMethod = booking.paymentMethod || invoice.paymentMethod || '';
  invoice.paymentStatus = paymentStatus || invoice.paymentStatus || 'Pending';
  invoice.finalBill = {
    ...finalBill,
    payableAfterRide: true,
    paymentStatus: invoice.paymentStatus
  };
  invoice.amountPaid = model.payment.amountPaid;
  invoice.remainingAmount = model.payment.balanceDue;
  invoice.transactionId = model.payment.transactionId;
  invoice.businessSnapshot = {
    ...invoice.businessSnapshot,
    businessName: model.business.businessName,
    contactEmail: model.business.email,
    contactPhone: model.business.phone,
    address: model.business.address,
    gstin: model.business.gstin,
    upiId: model.business.upiId,
    bankAccountName: model.business.bankAccountName,
    bankAccountNumber: model.business.bankAccountNumber,
    bankIfsc: model.business.bankIfsc,
    bankBranch: model.business.bankBranch,
    paymentLink: model.business.paymentLink,
    footerNote: model.business.footerNote
  };

  booking.invoice = invoice._id;
}

async function dispatchInvoiceArtifacts({ booking, invoice, settings, emailSubject, whatsappMessage }) {
  const pdfBuffer = await buildInvoicePdf({ booking, invoice, driver: booking.assignedDriver, settings });
  await sendEmail({
    to: booking.email,
    subject: emailSubject,
    html: invoiceGenerated(invoice, booking),
    attachments: [{ filename: `${invoice.invoiceId}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
  }).catch(() => undefined);

  await sendWhatsApp({
    to: booking.phone,
    message: whatsappMessage
  }).catch(() => undefined);

  return pdfBuffer;
}

async function loadBookingWithInvoice(id) {
  const booking = await Booking.findById(id).populate('assignedDriver').populate('user').populate('invoice');
  if (!booking) throw new ApiError(404, 'Booking not found');
  return booking;
}

const generateBookingInvoice = asyncHandler(async (req, res) => {
  const booking = await loadBookingWithInvoice(req.params.id);
  const settings = await loadSettings();

  if (['Rejected', 'Cancelled'].includes(booking.bookingStatus)) {
    throw new ApiError(400, 'Invoice cannot be generated for a rejected or cancelled booking');
  }

  const billing = await buildBillingQuoteFromBooking(booking, settings);
  const finalBill = billing.fareBreakdown;
  const existingInvoice = booking.invoice || await Invoice.findOne({ booking: booking._id });
  const invoice = existingInvoice || new Invoice({ invoiceId: booking.invoiceId || createInvoiceId(), booking: booking._id });

  if (String(req.body?.regenerate || '').toLowerCase() === 'true') {
    invoice.invoiceId = createInvoiceId();
  } else {
    invoice.invoiceId = invoice.invoiceId || booking.invoiceId || createInvoiceId();
  }

  const model = buildInvoiceModel({ booking, invoice, driver: booking.assignedDriver, settings });
  syncInvoiceFromModel(booking, invoice, model, finalBill, 'Pending');
  booking.statusHistory = Array.isArray(booking.statusHistory) ? booking.statusHistory : [];
  booking.statusHistory.push({ status: 'Invoice Generated', at: new Date(), note: 'Invoice generated by admin' });

  await booking.save();
  await invoice.save();

  await dispatchInvoiceArtifacts({
    booking,
    invoice,
    settings,
    emailSubject: `Invoice generated - ${booking.bookingId}`,
    whatsappMessage: `Your invoice ${invoice.invoiceId} for booking ${booking.bookingId} is ready.`
  });

  await notifyAdmins('invoice:generated', {
    title: 'Invoice generated',
    message: `${invoice.invoiceId} created for ${booking.bookingId}`,
    bookingId: booking.bookingId,
    customerId: booking.user || null,
    invoiceId: invoice.invoiceId,
    customerName: booking.customerName,
    tripType: booking.tripType,
    vehicle: booking.selectedCar,
    totalFare: invoice.totalFare
  });

  await notifyCustomer({
    userId: booking.user || null,
    email: booking.email,
    phone: booking.phone,
    socketEvent: 'invoice:generated',
    payload: {
      title: 'Invoice generated',
      message: `${invoice.invoiceId} is ready for ${booking.bookingId}`,
      bookingId: booking.bookingId,
      invoiceId: invoice.invoiceId,
      customerName: booking.customerName,
      bookingStatus: booking.bookingStatus,
      paymentStatus: booking.paymentStatus,
      tripType: booking.tripType,
      vehicle: booking.selectedCar,
      totalFare: invoice.totalFare
    }
  });

  res.json({
    success: true,
    message: 'Invoice generated successfully',
    booking,
    invoice,
    downloadUrl: `/api/bookings/${booking._id}/invoice/download`
  });
});

const regenerateBookingInvoice = asyncHandler(async (req, res) => {
  req.body = { ...(req.body || {}), regenerate: true };
  return generateBookingInvoice(req, res);
});

const resendBookingInvoice = asyncHandler(async (req, res) => {
  const booking = await loadBookingWithInvoice(req.params.id);
  const settings = await loadSettings();
  const invoice = booking.invoice || await Invoice.findOne({ booking: booking._id });
  if (!invoice) throw new ApiError(404, 'Invoice not found');

  const billing = await buildBillingQuoteFromBooking(booking, settings);
  const finalBill = billing.fareBreakdown;
  const model = buildInvoiceModel({ booking, invoice, driver: booking.assignedDriver, settings });
  syncInvoiceFromModel(booking, invoice, model, finalBill, invoice.paymentStatus || booking.paymentStatus || 'Pending');
  booking.statusHistory = Array.isArray(booking.statusHistory) ? booking.statusHistory : [];
  booking.statusHistory.push({ status: booking.bookingStatus || 'Invoice Generated', at: new Date(), note: 'Invoice resent' });

  await booking.save();
  await invoice.save();
  await dispatchInvoiceArtifacts({
    booking,
    invoice,
    settings,
    emailSubject: `Invoice resent - ${booking.bookingId}`,
    whatsappMessage: `Resent invoice ${invoice.invoiceId} for booking ${booking.bookingId} is ready.`
  });

  await notifyAdmins('invoice:resent', {
    title: 'Invoice resent',
    message: `${invoice.invoiceId} resent for ${booking.bookingId}`,
    bookingId: booking.bookingId,
    customerId: booking.user || null,
    invoiceId: invoice.invoiceId
  });

  await notifyCustomer({
    userId: booking.user || null,
    email: booking.email,
    phone: booking.phone,
    socketEvent: 'invoice:resent',
    payload: {
      title: 'Invoice resent',
      message: `${invoice.invoiceId} resent for ${booking.bookingId}`,
      bookingId: booking.bookingId,
      invoiceId: invoice.invoiceId,
      customerName: booking.customerName,
      tripType: booking.tripType,
      vehicle: booking.selectedCar
    }
  });

  res.json({ success: true, message: 'Invoice resent successfully', booking, invoice });
});

const markBookingPaid = asyncHandler(async (req, res) => {
  const booking = await loadBookingWithInvoice(req.params.id);
  const settings = await loadSettings();
  const invoice = booking.invoice || await Invoice.findOne({ booking: booking._id });
  if (!invoice) throw new ApiError(400, 'Generate an invoice before marking payment');

  const paymentMethod = normalizePaymentMethod(req.body.paymentMethod || booking.paymentMethod || 'Cash');
  const paymentStatus = normalizePaymentStatus(req.body.paymentStatus, paymentMethod);
  const amount = Math.max(0, Number(req.body.amount || invoice.totalFare || booking.totalFare || booking.estimatedFare || 0));
  const isPartial = paymentStatus === 'Partially Paid' || amount < Number(invoice.totalFare || booking.totalFare || 0);

  const payment = await Payment.create({
    booking: booking._id,
    invoice: invoice._id,
    user: booking.user,
    provider: 'manual',
    paymentType: paymentMethod || 'manual',
    paymentMethod,
    amount: isPartial ? amount : Number(invoice.totalFare || amount),
    currency: 'inr',
    status: isPartial ? 'Partially Paid' : 'Completed',
    metadata: {
      bookingId: booking.bookingId,
      invoiceId: invoice.invoiceId
    },
    notes: req.body.notes || '',
    proofUrl: req.body.proofUrl || '',
    collectedBy: req.user?._id || null,
    receiptId: `RCPT-${invoice.invoiceId}`,
    paidAt: new Date()
  });

  booking.paymentMethod = paymentMethod;
  booking.paymentStatus = isPartial ? 'Partially Paid' : paymentStatus;
  booking.bookingStatus = isPartial ? 'Invoice Generated' : 'Paid';
  booking.paidAt = new Date();
  booking.statusHistory = Array.isArray(booking.statusHistory) ? booking.statusHistory : [];
  booking.statusHistory.push({
    status: booking.bookingStatus,
    at: new Date(),
    note: isPartial ? 'Partial payment recorded' : 'Payment recorded'
  });
  invoice.paymentMethod = paymentMethod;
  invoice.paymentStatus = booking.paymentStatus;
  invoice.paidAt = isPartial ? null : new Date();
  invoice.amountPaid = payment.amount;
  invoice.remainingAmount = Math.max(0, Number(invoice.totalFare || booking.totalFare || 0) - payment.amount);
  invoice.transactionId = payment.receiptId;
  booking.finalBill = {
    ...(booking.finalBill || {}),
    paymentStatus: booking.paymentStatus,
    paymentMethod,
    paidAmount: payment.amount,
    paidAt: booking.paidAt
  };

  await booking.save();
  await invoice.save();

  await sendEmail({
    to: booking.email,
    subject: `Payment receipt - ${booking.bookingId}`,
    html: paymentReceipt(payment, booking)
  }).catch(() => undefined);

  await sendWhatsApp({
    to: booking.phone,
    message: `Payment recorded for booking ${booking.bookingId}. Status: ${booking.paymentStatus}.`
  }).catch(() => undefined);

  await dispatchInvoiceArtifacts({
    booking,
    invoice,
    settings,
    emailSubject: `Payment receipt - ${booking.bookingId}`,
    whatsappMessage: `Payment receipt generated for booking ${booking.bookingId}.`
  });

  await notifyAdmins('payment:completed', {
    title: 'Payment recorded',
    message: `${booking.bookingId} marked as ${booking.paymentStatus}`,
    bookingId: booking.bookingId,
    customerId: booking.user || null,
    invoiceId: invoice.invoiceId,
    customerName: booking.customerName,
    tripType: booking.tripType,
    vehicle: booking.selectedCar,
    paymentStatus: booking.paymentStatus,
    paymentMethod,
    amount: payment.amount
  });

  await notifyCustomer({
    userId: booking.user || null,
    email: booking.email,
    phone: booking.phone,
    socketEvent: 'payment:received',
    payload: {
      title: 'Payment received',
      message: `${booking.bookingId} marked as ${booking.paymentStatus}`,
      bookingId: booking.bookingId,
      invoiceId: invoice.invoiceId,
      customerName: booking.customerName,
      bookingStatus: booking.bookingStatus,
      paymentStatus: booking.paymentStatus,
      paymentMethod,
      amount: payment.amount,
      tripType: booking.tripType,
      vehicle: booking.selectedCar
    }
  });

  res.json({
    success: true,
    message: 'Payment recorded successfully',
    booking,
    invoice,
    payment
  });
});

const downloadBookingInvoice = asyncHandler(async (req, res) => {
  const booking = await loadBookingWithInvoice(req.params.id);
  const settings = await loadSettings();
  const invoice = booking.invoice || await Invoice.findOne({ booking: booking._id });
  if (!invoice) throw new ApiError(404, 'Invoice not found');

  const pdfBuffer = await buildInvoicePdf({ booking, invoice, driver: booking.assignedDriver, settings });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceId}.pdf"`);
  res.send(pdfBuffer);
});

module.exports = {
  generateBookingInvoice,
  regenerateBookingInvoice,
  resendBookingInvoice,
  markBookingPaid,
  downloadBookingInvoice
};