const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const SiteSettings = require('../models/SiteSettings');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { createInvoiceId } = require('../utils/invoiceId');
const { buildInvoicePdf, buildInvoiceModel } = require('../utils/invoicePdf');
const { calculateBillingDraft, normalizePaymentMethod, normalizePaymentStatus, normalizeChargeItems, sumCharges } = require('../utils/billingWorkflow');
const { calculateFareQuote } = require('../services/fareCalculator');
const { notifyAdmins, notifyCustomer } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');
const { invoiceGenerated, paymentReceipt } = require('../services/emailTemplates');
const { sendWhatsApp } = require('../services/whatsappService');

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
    extraCharges: booking.fareBreakdown?.extraTravelCharges || booking.finalBill?.extraTravelCharges || sumCharges(normalizeChargeItems(booking.extraCharges)) || 0,
    tripDays: booking.fareBreakdown?.driverAllowanceDays || booking.finalBill?.driverAllowanceDays || 0,
    settings
  });
}

function syncInvoiceFromModel(booking, invoice, model, finalBill, paymentStatus, billing = {}) {
  booking.invoiceId = invoice.invoiceId;
  booking.invoiceGenerated = true;
  booking.bookingStatus = billing.paymentStatus === 'Paid' ? 'Paid' : 'Invoice Generated';
  booking.paymentStatus = billing.paymentStatus || paymentStatus || 'Pending';
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
  booking.extraDistanceCharges = finalBill.extraDistanceCharges || booking.extraDistanceCharges || 0;
  booking.parkingCharges = finalBill.parkingCharges || booking.parkingCharges || 0;
  booking.statePermitCharges = finalBill.statePermitCharges || booking.statePermitCharges || 0;
  booking.miscellaneousCharges = finalBill.miscellaneousCharges || booking.miscellaneousCharges || 0;
  booking.extraCharges = billing.extraCharges || booking.extraCharges || [];
  booking.discountType = billing.discountType || booking.discountType || 'flat';
  booking.discountValue = billing.discountValue ?? booking.discountValue ?? 0;
  booking.discountAmount = billing.discountAmount ?? booking.discountAmount ?? 0;
    booking.gstAmount = billing.gstAmount ?? finalBill.gstAmount ?? booking.gstAmount ?? 0;
    booking.subtotal = billing.subtotal ?? finalBill.subtotalAmount ?? finalBill.subtotal ?? booking.subtotal ?? 0;
    booking.grandTotal = billing.grandTotal ?? finalBill.totalAmount ?? booking.grandTotal ?? 0;
    booking.totalFare = billing.totalFare ?? finalBill.totalAmount ?? booking.totalFare ?? 0;
  booking.paidAmount = billing.paidAmount ?? booking.paidAmount ?? 0;
  booking.balanceAmount = billing.balanceAmount ?? booking.balanceAmount ?? 0;
  booking.paymentDate = billing.paymentDate || booking.paymentDate || null;
  booking.transactionId = billing.transactionId || booking.transactionId || '';
  booking.finalBill = {
    ...finalBill,
    extraCharges: billing.extraCharges || booking.extraCharges || [],
    discountType: billing.discountType || booking.discountType || 'flat',
    discountValue: billing.discountValue ?? booking.discountValue ?? 0,
    discountAmount: billing.discountAmount ?? booking.discountAmount ?? 0,
    subtotal: billing.subtotal ?? finalBill.subtotalAmount ?? finalBill.subtotal ?? booking.subtotal ?? 0,
    grandTotal: billing.grandTotal ?? finalBill.totalAmount ?? booking.grandTotal ?? 0,
    totalAmount: billing.totalFare ?? finalBill.totalAmount ?? booking.totalFare ?? 0,
    paidAmount: billing.paidAmount ?? booking.paidAmount ?? 0,
    balanceAmount: billing.balanceAmount ?? booking.balanceAmount ?? 0,
    paymentDate: billing.paymentDate || booking.paymentDate || null,
    transactionId: billing.transactionId || booking.transactionId || '',
    payableAfterRide: true,
    paymentStatus: billing.paymentStatus || paymentStatus || 'Pending',
    paymentMethod: billing.paymentMethod || booking.paymentMethod || 'Cash'
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
  invoice.extraDistanceCharges = booking.extraDistanceCharges || invoice.extraDistanceCharges || 0;
  invoice.parkingCharges = booking.parkingCharges || invoice.parkingCharges || 0;
  invoice.statePermitCharges = booking.statePermitCharges || invoice.statePermitCharges || 0;
  invoice.miscellaneousCharges = booking.miscellaneousCharges || invoice.miscellaneousCharges || 0;
  invoice.extraCharges = booking.extraCharges || invoice.extraCharges || [];
  invoice.businessSnapshot = model.business;
  invoice.customerSnapshot = model.customer;
  invoice.rideSnapshot = model.ride;
  invoice.lineItems = billing.lineItems || model.lineItems;
  invoice.paymentSummary = model.payment;
  invoice.terms = model.terms;
  invoice.fareBreakdown = {
    ...finalBill,
    ...billing.fareBreakdown,
    extraCharges: billing.extraCharges || booking.extraCharges || [],
    currency: finalBill.currency || 'INR'
  };
  invoice.subtotalAmount = billing.subtotal ?? finalBill.subtotalAmount ?? finalBill.subtotal ?? finalBill.baseAmount ?? 0;
  invoice.subtotal = invoice.subtotalAmount;
  invoice.grandTotal = billing.grandTotal ?? finalBill.totalAmount ?? invoice.grandTotal ?? 0;
  invoice.taxAmount = billing.gstAmount ?? finalBill.taxAmount ?? finalBill.gstAmount ?? 0;
  invoice.cgstAmount = finalBill.cgstAmount;
  invoice.sgstAmount = finalBill.sgstAmount;
  invoice.taxPercent = billing.fareBreakdown?.gstPercent || finalBill.taxPercent || finalBill.gstPercent || 5;
  invoice.discountAmount = billing.discountAmount ?? finalBill.discountAmount ?? invoice.discountAmount ?? 0;
  invoice.discountType = billing.discountType || invoice.discountType || 'flat';
  invoice.discountValue = billing.discountValue ?? invoice.discountValue ?? 0;
  invoice.totalFare = billing.totalFare ?? finalBill.totalAmount ?? invoice.totalFare ?? 0;
  invoice.paymentMethod = billing.paymentMethod || booking.paymentMethod || invoice.paymentMethod || '';
  invoice.paymentStatus = billing.paymentStatus || paymentStatus || invoice.paymentStatus || 'Pending';
  invoice.paymentDate = billing.paymentDate || invoice.paymentDate || booking.paymentDate || null;
  invoice.paidAmount = billing.paidAmount ?? invoice.paidAmount ?? 0;
  invoice.balanceAmount = billing.balanceAmount ?? invoice.balanceAmount ?? 0;
  invoice.transactionId = billing.transactionId || invoice.transactionId || '';
  invoice.finalBill = {
    ...finalBill,
    ...billing.fareBreakdown,
    extraCharges: billing.extraCharges || booking.extraCharges || [],
    discountType: billing.discountType || invoice.discountType || 'flat',
    discountValue: billing.discountValue ?? invoice.discountValue ?? 0,
    discountAmount: billing.discountAmount ?? invoice.discountAmount ?? 0,
    grandTotal: billing.grandTotal ?? finalBill.totalAmount ?? invoice.grandTotal ?? 0,
    paidAmount: billing.paidAmount ?? invoice.paidAmount ?? 0,
    balanceAmount: billing.balanceAmount ?? invoice.balanceAmount ?? 0,
    paymentDate: billing.paymentDate || invoice.paymentDate || null,
    transactionId: billing.transactionId || invoice.transactionId || '',
    payableAfterRide: true,
    paymentStatus: invoice.paymentStatus
  };
  invoice.amountPaid = billing.paidAmount ?? model.payment.amountPaid;
  invoice.remainingAmount = billing.balanceAmount ?? model.payment.balanceDue;
  invoice.paymentSummary = {
    ...model.payment,
    ...billing.paymentSummary,
    amountPaid: billing.paidAmount ?? model.payment.amountPaid,
    balanceDue: billing.balanceAmount ?? model.payment.balanceDue,
    transactionId: billing.transactionId || model.payment.transactionId,
    paymentDate: billing.paymentDate || model.payment.paymentDate || null,
    paymentMethod: billing.paymentMethod || model.payment.paymentMethod || 'Cash',
    paymentStatus: billing.paymentStatus || model.payment.status || 'Pending'
  };
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

function buildInvoiceDraftSnapshot(booking, invoice = null) {
  const source = invoice?.invoiceDraft || booking.invoiceDraft || {};
  const extraCharges = Array.isArray(source.extraCharges)
    ? source.extraCharges
    : normalizeChargeItems(source.extraCharges || booking.extraCharges || invoice?.extraCharges);

  return {
    baseFare: Number(source.baseFare ?? booking.baseFare ?? invoice?.subtotalAmount ?? 0),
    distanceFare: Number(source.distanceFare ?? booking.distanceFare ?? invoice?.distanceFare ?? 0),
    tollCharges: Number(source.tollCharges ?? booking.tollCharges ?? invoice?.tollCharges ?? 0),
    parkingCharges: Number(source.parkingCharges ?? booking.parkingCharges ?? invoice?.parkingCharges ?? 0),
    waitingCharges: Number(source.waitingCharges ?? booking.waitingCharges ?? invoice?.waitingCharges ?? 0),
    nightCharges: Number(source.nightCharges ?? booking.nightCharges ?? invoice?.nightCharges ?? 0),
    statePermitCharges: Number(source.statePermitCharges ?? booking.statePermitCharges ?? invoice?.statePermitCharges ?? 0),
    extraDistanceCharges: Number(source.extraDistanceCharges ?? booking.extraDistanceCharges ?? invoice?.extraDistanceCharges ?? 0),
    miscellaneousCharges: Number(source.miscellaneousCharges ?? booking.miscellaneousCharges ?? invoice?.miscellaneousCharges ?? 0),
    extraCharges,
    discountType: source.discountType ?? booking.discountType ?? invoice?.discountType ?? 'flat',
    discountValue: Number(source.discountValue ?? booking.discountValue ?? invoice?.discountValue ?? 0),
    discountAmount: Number(source.discountAmount ?? booking.discountAmount ?? invoice?.discountAmount ?? 0),
      grandTotal: Number(source.grandTotal ?? booking.grandTotal ?? invoice?.grandTotal ?? 0),
    paymentStatus: source.paymentStatus ?? booking.paymentStatus ?? invoice?.paymentStatus ?? 'Pending',
    paymentMethod: source.paymentMethod ?? booking.paymentMethod ?? invoice?.paymentMethod ?? '',
    paymentDate: source.paymentDate ?? booking.paymentDate ?? invoice?.paymentDate ?? null,
    transactionId: source.transactionId ?? booking.transactionId ?? invoice?.transactionId ?? '',
    paidAmount: Number(source.paidAmount ?? booking.paidAmount ?? invoice?.paidAmount ?? 0),
    balanceAmount: Number(source.balanceAmount ?? booking.balanceAmount ?? invoice?.balanceAmount ?? 0),
    subtotal: Number(source.subtotal ?? booking.subtotal ?? invoice?.subtotalAmount ?? 0),
    gstAmount: Number(source.gstAmount ?? booking.gstAmount ?? invoice?.taxAmount ?? 0)
  };
}

function getBillingDraftInput(reqBody = {}) {
  return {
    ...reqBody,
    extraCharges: Array.isArray(reqBody.extraCharges) ? reqBody.extraCharges : normalizeChargeItems(reqBody.extraCharges)
  };
}

const getBookingInvoiceDraft = asyncHandler(async (req, res) => {
  const booking = await loadBookingWithInvoice(req.params.id);
  const invoice = booking.invoice || await Invoice.findOne({ booking: booking._id });

  res.json({
    success: true,
    booking,
    invoice,
    draft: buildInvoiceDraftSnapshot(booking, invoice)
  });
});

const saveBookingInvoiceDraft = asyncHandler(async (req, res) => {
  const booking = await loadBookingWithInvoice(req.params.id);
  const settings = await loadSettings();
  const invoice = booking.invoice || await Invoice.findOne({ booking: booking._id });
  const billing = calculateBillingDraft({ booking, invoice: invoice || {}, settings, draft: getBillingDraftInput(req.body || {}) });

  const draftSnapshot = {
    ...buildInvoiceDraftSnapshot(booking, invoice),
    ...getBillingDraftInput(req.body || {}),
    extraCharges: billing.extraCharges,
    discountType: billing.discountType,
    discountValue: billing.discountValue,
    discountAmount: billing.discountAmount,
    subtotal: billing.subtotal,
    gstAmount: billing.gstAmount,
    grandTotal: billing.grandTotal,
    paymentStatus: billing.paymentStatus,
    paymentMethod: billing.paymentMethod,
    paymentDate: billing.paymentDate,
    transactionId: billing.transactionId,
    paidAmount: billing.paidAmount,
    balanceAmount: billing.balanceAmount
  };

  booking.extraCharges = billing.extraCharges;
  booking.invoiceDraft = draftSnapshot;
  booking.discountType = billing.discountType;
  booking.discountValue = billing.discountValue;
  booking.discountAmount = billing.discountAmount;
  booking.subtotal = billing.subtotal;
  booking.grandTotal = billing.grandTotal;
  booking.totalFare = billing.totalFare;
  booking.paidAmount = billing.paidAmount;
  booking.balanceAmount = billing.balanceAmount;
  booking.paymentMethod = billing.paymentMethod;
  booking.paymentStatus = billing.paymentStatus;
  booking.paymentDate = billing.paymentDate;
  booking.transactionId = billing.transactionId;
  booking.finalBill = {
    ...(booking.finalBill || {}),
    ...billing.fareBreakdown,
    payableAfterRide: true,
    paymentStatus: billing.paymentStatus,
    paymentMethod: billing.paymentMethod,
    paidAmount: billing.paidAmount,
    balanceAmount: billing.balanceAmount,
    paymentDate: billing.paymentDate,
    transactionId: billing.transactionId
  };

  booking.statusHistory = Array.isArray(booking.statusHistory) ? booking.statusHistory : [];
  booking.statusHistory.push({
    status: booking.bookingStatus || 'Ride Completed',
    at: new Date(),
    note: 'Invoice draft updated'
  });

  await booking.save();

  if (invoice) {
    invoice.invoiceDraft = draftSnapshot;
    invoice.extraCharges = billing.extraCharges;
    invoice.discountType = billing.discountType;
    invoice.discountValue = billing.discountValue;
    invoice.discountAmount = billing.discountAmount;
    invoice.subtotalAmount = billing.subtotal;
    invoice.subtotal = billing.subtotal;
    invoice.grandTotal = billing.grandTotal;
    invoice.totalFare = billing.totalFare;
    invoice.paidAmount = billing.paidAmount;
    invoice.balanceAmount = billing.balanceAmount;
    invoice.paymentMethod = billing.paymentMethod;
    invoice.paymentStatus = billing.paymentStatus;
    invoice.paymentDate = billing.paymentDate;
    invoice.transactionId = billing.transactionId;
    invoice.fareBreakdown = {
      ...(invoice.fareBreakdown || {}),
      ...billing.fareBreakdown,
      currency: invoice.fareBreakdown?.currency || 'INR'
    };
    invoice.lineItems = billing.lineItems;
    invoice.paymentSummary = billing.paymentSummary;
    invoice.finalBill = {
      ...(invoice.finalBill || {}),
      ...billing.fareBreakdown,
      payableAfterRide: true,
      paymentStatus: billing.paymentStatus,
      paymentMethod: billing.paymentMethod,
      paidAmount: billing.paidAmount,
      balanceAmount: billing.balanceAmount,
      paymentDate: billing.paymentDate,
      transactionId: billing.transactionId
    };

    await invoice.save();
  }

  await notifyAdmins('invoice:updated', {
    title: 'Invoice draft updated',
    message: `${booking.bookingId} invoice draft saved`,
    bookingId: booking.bookingId,
    customerId: booking.user || null,
    invoiceId: invoice?.invoiceId || booking.invoiceId || '',
    customerName: booking.customerName,
    tripType: booking.tripType,
    vehicle: booking.selectedCar,
    paymentStatus: billing.paymentStatus,
    totalFare: billing.totalFare
  });

  await notifyCustomer({
    userId: booking.user || null,
    email: booking.email,
    phone: booking.phone,
    socketEvent: 'invoice:updated',
    payload: {
      title: 'Invoice updated',
      message: `${booking.bookingId} invoice draft was updated`,
      bookingId: booking.bookingId,
      invoiceId: invoice?.invoiceId || booking.invoiceId || '',
      bookingStatus: booking.bookingStatus,
      paymentStatus: billing.paymentStatus,
      paymentMethod: billing.paymentMethod,
      totalFare: billing.totalFare,
      balanceAmount: billing.balanceAmount,
      tripType: booking.tripType,
      vehicle: booking.selectedCar
    }
  });

  res.json({
    success: true,
    message: 'Invoice draft saved successfully',
    booking,
    invoice,
    preview: {
      lineItems: billing.lineItems,
      subtotal: billing.subtotal,
      discountAmount: billing.discountAmount,
      gstAmount: billing.gstAmount,
      grandTotal: billing.grandTotal,
      paymentStatus: billing.paymentStatus,
      paymentMethod: billing.paymentMethod,
      paymentDate: billing.paymentDate,
      paidAmount: billing.paidAmount,
      balanceAmount: billing.balanceAmount
    }
  });
});

const generateBookingInvoice = asyncHandler(async (req, res) => {
  const booking = await loadBookingWithInvoice(req.params.id);
  const settings = await loadSettings();

  if (['Rejected', 'Cancelled'].includes(booking.bookingStatus)) {
    throw new ApiError(400, 'Invoice cannot be generated for a rejected or cancelled booking');
  }

  const billing = await buildBillingQuoteFromBooking(booking, settings);
  const billingState = calculateBillingDraft({ booking, invoice: booking.invoice || {}, settings, draft: buildInvoiceDraftSnapshot(booking, booking.invoice) });
  const finalBill = billing.fareBreakdown;
  const existingInvoice = booking.invoice || await Invoice.findOne({ booking: booking._id });
  const invoice = existingInvoice || new Invoice({ invoiceId: booking.invoiceId || createInvoiceId(), booking: booking._id });

  if (String(req.body?.regenerate || '').toLowerCase() === 'true') {
    invoice.invoiceId = createInvoiceId();
  } else {
    invoice.invoiceId = invoice.invoiceId || booking.invoiceId || createInvoiceId();
  }

  const model = buildInvoiceModel({ booking, invoice, driver: booking.assignedDriver, settings });
  syncInvoiceFromModel(booking, invoice, model, finalBill, billingState.paymentStatus, billingState);
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
  const billingState = calculateBillingDraft({ booking, invoice, settings, draft: buildInvoiceDraftSnapshot(booking, invoice) });
  const finalBill = billing.fareBreakdown;
  const model = buildInvoiceModel({ booking, invoice, driver: booking.assignedDriver, settings });
  syncInvoiceFromModel(booking, invoice, model, finalBill, billingState.paymentStatus || invoice.paymentStatus || booking.paymentStatus || 'Pending', billingState);
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

  const billingState = calculateBillingDraft({ booking, invoice, settings, draft: { ...buildInvoiceDraftSnapshot(booking, invoice), ...getBillingDraftInput(req.body || {}) } });
  const paymentMethod = billingState.paymentMethod;
  const paymentStatus = billingState.paymentStatus === 'Partial' || billingState.paymentStatus === 'Refunded' ? billingState.paymentStatus : 'Paid';
  const amount = Math.max(0, Number(req.body.amount || billingState.totalFare || invoice.totalFare || booking.totalFare || booking.estimatedFare || 0));
  const isPartial = paymentStatus === 'Partial' || amount < Number(billingState.totalFare || invoice.totalFare || booking.totalFare || 0);
  const paidAmount = isPartial ? amount : billingState.totalFare;
  const balanceAmount = Math.max(0, Number(billingState.totalFare || invoice.totalFare || booking.totalFare || 0) - paidAmount);
  const paymentDate = req.body.paymentDate || new Date();
  const transactionId = String(req.body.transactionId || req.body.reference || req.body.transactionReference || '').trim() || `RCPT-${invoice.invoiceId}`;

  const payment = await Payment.create({
    booking: booking._id,
    invoice: invoice._id,
    user: booking.user,
    provider: 'manual',
    paymentType: paymentMethod || 'manual',
    paymentMethod,
    paymentStatus: isPartial ? 'Partial' : 'Paid',
    amount: isPartial ? amount : Number(billingState.totalFare || amount),
    paidAmount,
    balanceAmount,
    currency: 'inr',
    status: isPartial ? 'Partially Paid' : 'Completed',
    metadata: {
      bookingId: booking.bookingId,
      invoiceId: invoice.invoiceId
    },
    notes: req.body.notes || '',
    proofUrl: req.body.proofUrl || '',
    collectedBy: req.user?._id || null,
    receiptId: transactionId,
    paymentDate,
    transactionId,
    paidAt: paymentDate
  });

  booking.paymentMethod = paymentMethod;
  booking.paymentStatus = isPartial ? 'Partial' : 'Paid';
  booking.bookingStatus = isPartial ? 'Invoice Generated' : 'Paid';
  booking.paidAt = paymentDate;
  booking.paymentDate = paymentDate;
  booking.transactionId = transactionId;
  booking.paidAmount = paidAmount;
  booking.balanceAmount = balanceAmount;
  booking.statusHistory = Array.isArray(booking.statusHistory) ? booking.statusHistory : [];
  booking.statusHistory.push({
    status: booking.bookingStatus,
    at: new Date(),
    note: isPartial ? 'Partial payment recorded' : 'Payment recorded'
  });
  invoice.paymentMethod = paymentMethod;
  invoice.paymentStatus = booking.paymentStatus;
  invoice.paidAt = paymentDate;
  invoice.paymentDate = paymentDate;
  invoice.amountPaid = paidAmount;
  invoice.paidAmount = paidAmount;
  invoice.balanceAmount = balanceAmount;
  invoice.remainingAmount = balanceAmount;
  invoice.transactionId = transactionId;
  invoice.paymentSummary = {
    ...(invoice.paymentSummary || {}),
    amountPaid: paidAmount,
    balanceDue: balanceAmount,
    paymentDate,
    paymentMethod,
    paymentStatus: booking.paymentStatus,
    transactionId
  };
  booking.finalBill = {
    ...(booking.finalBill || {}),
    paymentStatus: booking.paymentStatus,
    paymentMethod,
    paidAmount,
    balanceAmount,
    paidAt: booking.paidAt,
    paymentDate,
    transactionId
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
  getBookingInvoiceDraft,
  saveBookingInvoiceDraft,
  generateBookingInvoice,
  regenerateBookingInvoice,
  resendBookingInvoice,
  markBookingPaid,
  downloadBookingInvoice
};