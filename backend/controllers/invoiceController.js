const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const SiteSettings = require('../models/SiteSettings');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { createInvoiceId } = require('../utils/invoiceId');
const { buildInvoicePdf, buildInvoiceModel } = require('../utils/invoicePdf');
const { notifyAdmins } = require('../services/notificationService');
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

function buildFinalBill(estimatedFare) {
  const baseAmount = Number(estimatedFare || 0);
  const taxPercent = Number(process.env.INVOICE_TAX_PERCENT || 5);
  const taxAmount = Math.max(0, Math.round(baseAmount * (taxPercent / 100)));
  const cgstAmount = Math.round(taxAmount / 2);
  const sgstAmount = Math.max(0, taxAmount - cgstAmount);
  const discountAmount = 0;
  const totalAmount = Math.max(0, baseAmount + taxAmount - discountAmount);

  return {
    baseAmount,
    taxAmount,
    taxPercent,
    cgstAmount,
    sgstAmount,
    discountAmount,
    totalAmount,
    currency: 'INR'
  };
}

async function loadSettings() {
  return SiteSettings.findOne({}).lean();
}

function syncInvoiceFromModel(booking, invoice, model, finalBill, paymentStatus) {
  booking.invoiceId = invoice.invoiceId;
  booking.invoiceGenerated = true;
  booking.bookingStatus = 'Invoice Generated';
  booking.paymentStatus = paymentStatus || 'Pending';
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
  invoice.distance = booking.finalBill?.distance || invoice.distance || '';
  invoice.distanceValue = invoice.distance;
  invoice.businessSnapshot = model.business;
  invoice.customerSnapshot = model.customer;
  invoice.rideSnapshot = model.ride;
  invoice.lineItems = model.lineItems;
  invoice.paymentSummary = model.payment;
  invoice.terms = model.terms;
  invoice.fareBreakdown = {
    baseAmount: finalBill.baseAmount,
    taxAmount: finalBill.taxAmount,
    taxPercent: finalBill.taxPercent,
    cgstAmount: finalBill.cgstAmount,
    sgstAmount: finalBill.sgstAmount,
    discountAmount: finalBill.discountAmount,
    totalAmount: finalBill.totalAmount,
    currency: 'INR'
  };
  invoice.subtotalAmount = finalBill.baseAmount;
  invoice.taxAmount = finalBill.taxAmount;
  invoice.cgstAmount = finalBill.cgstAmount;
  invoice.sgstAmount = finalBill.sgstAmount;
  invoice.taxPercent = finalBill.taxPercent;
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

  const finalBill = buildFinalBill(booking.totalFare || booking.estimatedFare || 0);
  const existingInvoice = booking.invoice || await Invoice.findOne({ booking: booking._id });
  const invoice = existingInvoice || new Invoice({ invoiceId: booking.invoiceId || createInvoiceId(), booking: booking._id });

  if (String(req.body?.regenerate || '').toLowerCase() === 'true') {
    invoice.invoiceId = createInvoiceId();
  } else {
    invoice.invoiceId = invoice.invoiceId || booking.invoiceId || createInvoiceId();
  }

  const model = buildInvoiceModel({ booking, invoice, driver: booking.assignedDriver, settings });
  syncInvoiceFromModel(booking, invoice, model, finalBill, 'Pending');

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
    invoiceId: invoice.invoiceId,
    totalFare: invoice.totalFare
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

  const finalBill = buildFinalBill(booking.totalFare || booking.estimatedFare || invoice.totalFare || 0);
  const model = buildInvoiceModel({ booking, invoice, driver: booking.assignedDriver, settings });
  syncInvoiceFromModel(booking, invoice, model, finalBill, invoice.paymentStatus || booking.paymentStatus || 'Pending');

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
    invoiceId: invoice.invoiceId
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
    invoiceId: invoice.invoiceId,
    paymentStatus: booking.paymentStatus,
    paymentMethod,
    amount: payment.amount
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