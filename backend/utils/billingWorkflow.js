const { buildBillingLineItems } = require('../services/billingService');
const { roundCurrency, toNumber, validateBillingBreakdown } = require('./billingMath');

function trimText(value) {
  return String(value || '').trim();
}

function normalizePaymentMethod(method, fallback = 'Cash') {
  const value = trimText(method).toLowerCase();
  const aliases = {
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    bank: 'Bank transfer',
    'bank transfer': 'Bank transfer',
    transfer: 'Bank transfer',
    online: 'Online payment link',
    'online payment link': 'Online payment link',
    wallet: 'UPI'
  };

  return aliases[value] || trimText(method) || fallback;
}

function normalizePaymentStatus(status, fallback = 'Pending') {
  const value = trimText(status).toLowerCase();
  if (!value) return fallback;

  const aliases = {
    unpaid: 'Pending',
    pending: 'Pending',
    'payment pending': 'Pending',
    'invoice generated': 'Pending',
    partial: 'Partial',
    'partially paid': 'Partial',
    'part payment': 'Partial',
    'advance paid': 'Partial',
    'advance payment': 'Partial',
    paid: 'Paid',
    'paid online': 'Paid',
    'paid offline': 'Paid',
    'fully paid': 'Paid',
    refunded: 'Refunded'
  };

  return aliases[value] || fallback;
}

function normalizeChargeItems(items) {
  if (Array.isArray(items)) {
    return items
      .map((item) => {
        if (!item) return null;
        if (typeof item === 'number') {
          return { name: 'Extra Charge', amount: Number(item) };
        }

        const name = trimText(item.name || item.label || item.title || item.description);
        const amount = Number(item.amount ?? item.value ?? 0);
        if (!name || !Number.isFinite(amount) || amount <= 0) return null;
        return { name, amount };
      })
      .filter(Boolean);
  }

  const amount = Number(items || 0);
  if (!Number.isFinite(amount) || amount <= 0) return [];
  return [{ name: 'Extra Charge', amount }];
}

function collectChargeItems(source = {}) {
  const items = [];
  const builtIns = [
    ['Toll Charges', source.tollCharges],
    ['Parking Charges', source.parkingCharges],
    ['Driver Allowance', source.driverAllowance],
    ['Waiting Charges', source.waitingCharges],
    ['Night Charges', source.nightCharges],
    ['State Permit Charges', source.statePermitCharges],
    ['Extra Distance Charges', source.extraDistanceCharges || source.extraKmCharges || source.extraKmRateCharges],
    ['Miscellaneous Charges', source.miscellaneousCharges]
  ];

  builtIns.forEach(([name, amount]) => {
    const numericAmount = Number(amount || 0);
    if (Number.isFinite(numericAmount) && numericAmount > 0) {
      items.push({ name, amount: numericAmount });
    }
  });

  normalizeChargeItems(source.extraCharges).forEach((item) => items.push(item));
  return items;
}

function sumCharges(items = []) {
  return items.reduce((total, item) => total + Number(item?.amount || 0), 0);
}

function calculateBillingDraft({ booking = {}, invoice = {}, settings = {}, draft = {} }) {
  const billingSettings = settings.billing || {};
  const paymentSettings = settings.paymentSettings || {};
  const sourceBreakdown = invoice.billingBreakdown || invoice.fareBreakdown || booking.billingBreakdown || booking.fareBreakdown || booking.finalBill || invoice.finalBill || {};

  const taxPercent = Number(draft.taxPercent ?? invoice.taxPercent ?? booking.taxPercent ?? sourceBreakdown.gstPercent ?? billingSettings.taxPercent ?? 5);
  const discountType = trimText(draft.discountType ?? booking.discountType ?? invoice.discountType ?? sourceBreakdown.discountType ?? 'flat').toLowerCase() || 'flat';
  const discountValue = Number(draft.discountValue ?? booking.discountValue ?? invoice.discountValue ?? sourceBreakdown.discountValue ?? booking.discountAmount ?? invoice.discountAmount ?? 0);
  const paymentStatus = normalizePaymentStatus(draft.paymentStatus ?? invoice.paymentStatus ?? booking.paymentStatus ?? sourceBreakdown.paymentStatus ?? 'Pending');
  const paymentMethod = normalizePaymentMethod(draft.paymentMethod ?? invoice.paymentMethod ?? booking.paymentMethod ?? sourceBreakdown.paymentMethod ?? paymentSettings.defaultMethod ?? 'Cash');
  const paymentDate = draft.paymentDate || invoice.paymentDate || booking.paymentDate || sourceBreakdown.paymentDate || (paymentStatus === 'Paid' ? new Date() : null);
  const transactionId = trimText(draft.transactionId ?? invoice.transactionId ?? booking.transactionId ?? sourceBreakdown.transactionId ?? '');

  const baseFare = roundCurrency(draft.baseFare ?? sourceBreakdown.baseFare ?? booking.baseFare ?? invoice.subtotalAmount ?? 0);
  const distanceCharge = roundCurrency(draft.distanceCharge ?? draft.distanceFare ?? sourceBreakdown.distanceCharge ?? sourceBreakdown.distanceFare ?? booking.distanceFare ?? 0);
  const extraKmCharge = roundCurrency(draft.extraKmCharge ?? sourceBreakdown.extraKmCharge ?? distanceCharge);
  const extraHourCharge = roundCurrency(draft.extraHourCharge ?? sourceBreakdown.extraHourCharge ?? booking.extraHourCharge ?? 0);
  const driverAllowance = roundCurrency(draft.driverAllowance ?? sourceBreakdown.driverAllowance ?? booking.driverAllowance ?? 0);
  const tollCharges = roundCurrency(draft.tollCharges ?? sourceBreakdown.tollCharges ?? booking.tollCharges ?? 0);
  const parkingCharges = roundCurrency(draft.parkingCharges ?? sourceBreakdown.parkingCharges ?? booking.parkingCharges ?? 0);
  const permitCharges = roundCurrency(draft.permitCharges ?? sourceBreakdown.permitCharges ?? sourceBreakdown.statePermitCharges ?? booking.statePermitCharges ?? 0);
  const waitingCharges = roundCurrency(draft.waitingCharges ?? sourceBreakdown.waitingCharges ?? booking.waitingCharges ?? 0);
  const nightCharges = roundCurrency(draft.nightCharges ?? sourceBreakdown.nightCharges ?? booking.nightCharges ?? 0);
  const extraTravelCharges = roundCurrency(draft.extraTravelCharges ?? sourceBreakdown.extraTravelCharges ?? 0);
  const minimumFareAdjustment = roundCurrency(draft.minimumFareAdjustment ?? sourceBreakdown.minimumFareAdjustment ?? booking.minimumFareAdjustment ?? invoice.minimumFareAdjustment ?? 0);
  const extraKmChargeVisible = roundCurrency(extraKmCharge) !== roundCurrency(distanceCharge) ? extraKmCharge : 0;
  const subtotal = roundCurrency(baseFare + distanceCharge + extraKmChargeVisible + extraHourCharge + driverAllowance + tollCharges + parkingCharges + permitCharges + waitingCharges + nightCharges + extraTravelCharges + minimumFareAdjustment);

  let discountAmount = roundCurrency(draft.discountAmount ?? booking.discountAmount ?? invoice.discountAmount ?? sourceBreakdown.discountAmount ?? 0);
  if (!discountAmount && discountValue > 0) {
    discountAmount = discountType === 'percentage' ? roundCurrency((subtotal * discountValue) / 100) : roundCurrency(discountValue);
  }

  const gstAmount = roundCurrency(subtotal * (taxPercent / 100));
  const grandTotal = roundCurrency(subtotal + gstAmount - discountAmount);
  const paidAmount = roundCurrency(draft.paidAmount ?? invoice.paidAmount ?? booking.paidAmount ?? sourceBreakdown.paidAmount ?? (paymentStatus === 'Paid' ? grandTotal : 0));
  const balanceAmount = roundCurrency(draft.balanceAmount ?? invoice.balanceAmount ?? booking.balanceAmount ?? sourceBreakdown.balanceAmount ?? grandTotal - paidAmount);

  const packageLabel = sourceBreakdown.packageLabel || booking.fareBreakdown?.packageLabel || booking.finalBill?.packageLabel || (booking.tripType === 'local-package' ? 'Local Package' : booking.tripType === 'half-day-package' ? 'Half Day Package' : booking.tripType === 'airport-transfer' ? 'Airport Pickup / Drop' : booking.tripType === 'outstation-package' ? 'Outstation Package' : booking.tripType === 'wedding-vip-event' ? 'Wedding / VIP Events' : 'Base Fare');
  const distanceKm = toNumber(draft.distanceKm ?? sourceBreakdown.tripDistanceKm ?? sourceBreakdown.distanceKm ?? sourceBreakdown.tripDistance ?? booking.distanceInKm ?? 0, 0);
  const ratePerKm = toNumber(draft.ratePerKm ?? sourceBreakdown.ratePerKm ?? sourceBreakdown.pricePerKm ?? booking.pricePerKm ?? 0, 0);
  const extraHours = toNumber(draft.extraHours ?? sourceBreakdown.extraHours ?? 0, 0);

  const lineItems = buildBillingLineItems({
    tripType: sourceBreakdown.tripType || booking.tripType,
    packageLabel,
    packageBaseFare: baseFare,
    baseFare,
    distanceKm,
    tripDistanceKm: distanceKm,
    tripDistance: distanceKm,
    ratePerKm,
    pricePerKm: ratePerKm,
    billableDistance: toNumber(sourceBreakdown.billableDistance ?? distanceKm, distanceKm),
    extraKm: toNumber(sourceBreakdown.extraKm ?? (distanceCharge > 0 ? distanceKm : 0), 0),
    distanceCharge,
    distanceFare: distanceCharge,
    extraKmCharge,
    extraHours,
    extraHourCharge,
    extraHourRate: toNumber(sourceBreakdown.extraHourRate ?? 0, 0),
    tollCharges,
    driverAllowance,
    driverAllowancePerDay: toNumber(sourceBreakdown.driverAllowancePerDay ?? 0, 0),
    driverAllowanceDays: toNumber(sourceBreakdown.driverAllowanceDays ?? 1, 1),
    parkingCharges,
    permitCharges,
    waitingCharges,
    waitingMinutes: toNumber(sourceBreakdown.waitingMinutes ?? 0, 0),
    freeWaitingMinutes: toNumber(sourceBreakdown.freeWaitingMinutes ?? 30, 30),
    nightCharges,
    nightChargePercent: toNumber(sourceBreakdown.nightChargePercent ?? taxPercent, taxPercent),
    extraTravelCharges,
    minimumFareAdjustment,
    gstPercent: taxPercent,
    gstAmount,
    subtotalAmount: subtotal
  });

  const billingBreakdown = {
    baseFare,
    packageLabel,
    tripType: sourceBreakdown.tripType || booking.tripType,
    distanceKm,
    tripDistanceKm: distanceKm,
    ratePerKm,
    includedKm: toNumber(sourceBreakdown.includedKm ?? 0, 0),
    includedHours: toNumber(sourceBreakdown.includedHours ?? 0, 0),
    extraKm: toNumber(sourceBreakdown.extraKm ?? 0, 0),
    extraHours,
    distanceCharge,
    extraKmCharge,
    extraKmCharge,
    extraHourCharge,
    extraHourRate: toNumber(sourceBreakdown.extraHourRate ?? 0, 0),
    driverAllowance,
    driverAllowancePerDay: toNumber(sourceBreakdown.driverAllowancePerDay ?? 0, 0),
    driverAllowanceDays: toNumber(sourceBreakdown.driverAllowanceDays ?? 1, 1),
    tollCharges,
    parkingCharges,
    permitCharges,
    waitingCharges,
    nightCharges,
    extraTravelCharges,
    minimumFareAdjustment,
    discountAmount,
    discountType,
    discountValue,
    subtotal,
    gstPercent: taxPercent,
    gstAmount,
    totalAmount: grandTotal,
    totalFare: grandTotal,
    paidAmount,
    balanceAmount,
    paymentStatus,
    paymentMethod,
    paymentDate,
    transactionId,
    currency: 'INR',
    lineItems
  };

  const validation = validateBillingBreakdown(billingBreakdown, lineItems);
  if (!validation.ok) {
    const error = new Error('Billing reconciliation failed');
    error.details = validation;
    throw error;
  }

  return {
    extraCharges: normalizeChargeItems(draft.extraCharges ?? booking.extraCharges ?? invoice.extraCharges),
    discountType,
    discountValue,
    discountAmount,
    minimumFareAdjustment,
    subtotal,
    subtotalBeforeDiscount: subtotal,
    gstAmount,
    grandTotal,
    totalFare: grandTotal,
    paidAmount,
    balanceAmount,
    paymentStatus,
    paymentMethod,
    paymentDate,
    transactionId,
    lineItems,
    paymentSummary: {
      amountPaid: paidAmount,
      balanceDue: balanceAmount,
      transactionId,
      paymentDate,
      paymentMethod,
      paymentStatus
    },
    billingBreakdown,
    fareBreakdown: billingBreakdown
  };
}

module.exports = {
  calculateBillingDraft,
  collectChargeItems,
  normalizeChargeItems,
  normalizePaymentMethod,
  normalizePaymentStatus,
  sumCharges
};