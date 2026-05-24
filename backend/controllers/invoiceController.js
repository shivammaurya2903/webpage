const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { createInvoiceId } = require('../utils/invoiceId');
const { buildInvoicePdf } = require('../utils/invoicePdf');
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

async function loadBookingWithInvoice(id) {
  const booking = await Booking.findById(id).populate('assignedDriver').populate('user').populate('invoice');
  if (!booking) throw new ApiError(404, 'Booking not found');
  return booking;
}

const generateBookingInvoice = asyncHandler(async (req, res) => {
  const booking = await loadBookingWithInvoice(req.params.id);

  if (['Rejected', 'Cancelled'].includes(booking.bookingStatus)) {
    throw new ApiError(400, 'Invoice cannot be generated for a rejected or cancelled booking');
  }

  const finalBill = buildFinalBill(booking.totalFare || booking.estimatedFare || 0);
  const invoiceId = booking.invoiceId || createInvoiceId();
  const existingInvoice = booking.invoice || await Invoice.findOne({ booking: booking._id });

  booking.invoiceId = invoiceId;
  booking.invoiceGenerated = true;
  booking.bookingStatus = 'Invoice Generated';
  booking.paymentStatus = 'Pending';
  booking.totalFare = finalBill.totalAmount;
  booking.finalBill = {
    ...finalBill,
    payableAfterRide: true,
    paymentStatus: 'Pending'
  };

  const invoice = existingInvoice || new Invoice({
    invoiceId,
    booking: booking._id,
    bookingId: booking.bookingId,
    customerName: booking.customerName,
    email: booking.email,
    phone: booking.phone,
    pickupLocation: booking.pickupLocation,
    dropLocation: booking.dropLocation,
    pickupDate: booking.pickupDate,
    pickupTime: booking.pickupTime,
    vehicle: booking.selectedCar,
    driverName: booking.assignedDriver?.driverName || '',
    distance: booking.finalBill?.distance || booking.routeDistance || '',
    fareBreakdown: finalBill,
    paymentMethod: booking.paymentMethod || '',
    paymentStatus: 'Pending',
    totalFare: finalBill.totalAmount,
    taxAmount: finalBill.taxAmount,
    discountAmount: finalBill.discountAmount,
    finalBill
  });

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
  invoice.distance = booking.finalBill?.distance || invoice.distance || '';
  invoice.fareBreakdown = finalBill;
  invoice.paymentMethod = booking.paymentMethod || invoice.paymentMethod || '';
  invoice.paymentStatus = 'Pending';
  invoice.totalFare = finalBill.totalAmount;
  invoice.taxAmount = finalBill.taxAmount;
  invoice.discountAmount = finalBill.discountAmount;
  invoice.finalBill = finalBill;

  booking.invoice = invoice._id;
  await booking.save();
  await invoice.save();

  const pdfBuffer = await buildInvoicePdf({ booking, invoice, driver: booking.assignedDriver });
  await sendEmail({
    to: booking.email,
    subject: `Invoice generated - ${booking.bookingId}`,
    html: invoiceGenerated(invoice, booking),
    attachments: [{ filename: `${invoice.invoiceId}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
  }).catch(() => undefined);

  await sendWhatsApp({
    to: booking.phone,
    message: `Your invoice ${invoice.invoiceId} for booking ${booking.bookingId} is ready.`
  }).catch(() => undefined);

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

const markBookingPaid = asyncHandler(async (req, res) => {
  const booking = await loadBookingWithInvoice(req.params.id);
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
  const invoice = booking.invoice || await Invoice.findOne({ booking: booking._id });
  if (!invoice) throw new ApiError(404, 'Invoice not found');

  const pdfBuffer = await buildInvoicePdf({ booking, invoice, driver: booking.assignedDriver });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceId}.pdf"`);
  res.send(pdfBuffer);
});

module.exports = {
  generateBookingInvoice,
  markBookingPaid,
  downloadBookingInvoice
};