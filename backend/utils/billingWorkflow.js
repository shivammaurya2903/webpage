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

  const taxPercent = Number(draft.taxPercent ?? invoice.taxPercent ?? booking.taxPercent ?? booking.fareBreakdown?.gstPercent ?? billingSettings.taxPercent ?? 5);
  const baseFare = Number(draft.baseFare ?? booking.baseFare ?? booking.fareBreakdown?.baseFare ?? invoice.subtotalAmount ?? 0);
  const distanceFare = Number(draft.distanceFare ?? booking.distanceFare ?? booking.fareBreakdown?.distanceFare ?? 0);
  const builtInCharges = collectChargeItems({
    tollCharges: draft.tollCharges ?? booking.tollCharges,
    parkingCharges: draft.parkingCharges ?? booking.parkingCharges,
    driverAllowance: draft.driverAllowance ?? booking.driverAllowance,
    waitingCharges: draft.waitingCharges ?? booking.waitingCharges,
    nightCharges: draft.nightCharges ?? booking.nightCharges,
    statePermitCharges: draft.statePermitCharges ?? booking.statePermitCharges,
    miscellaneousCharges: draft.miscellaneousCharges ?? booking.miscellaneousCharges,
    extraDistanceCharges: draft.extraDistanceCharges ?? booking.extraDistanceCharges,
    extraCharges: []
  });
  const extraCharges = normalizeChargeItems(draft.extraCharges ?? booking.extraCharges ?? invoice.extraCharges);
  const extraChargesTotal = sumCharges(extraCharges);
  const builtInChargesTotal = sumCharges(builtInCharges);

  const discountType = trimText(draft.discountType ?? booking.discountType ?? invoice.discountType ?? 'flat').toLowerCase() || 'flat';
  const discountValue = Number(draft.discountValue ?? booking.discountValue ?? invoice.discountValue ?? booking.discountAmount ?? invoice.discountAmount ?? 0);
  const subtotalBeforeDiscount = Math.max(0, baseFare + distanceFare + builtInChargesTotal + extraChargesTotal);
  let discountAmount = Number(draft.discountAmount ?? booking.discountAmount ?? invoice.discountAmount ?? 0);

  if (!Number.isFinite(discountAmount) || discountAmount < 0) discountAmount = 0;
  if (!discountAmount && discountValue > 0) {
    discountAmount = discountType === 'percentage' ? Math.round((subtotalBeforeDiscount * discountValue) / 100) : discountValue;
  }

  const subtotal = Math.max(0, subtotalBeforeDiscount - discountAmount);
  const gstAmount = Math.max(0, Number(draft.taxAmount ?? invoice.taxAmount ?? booking.gstAmount ?? Math.round(subtotal * (taxPercent / 100))));
  const grandTotal = Math.max(0, Number(draft.grandTotal ?? invoice.grandTotal ?? booking.grandTotal ?? subtotal + gstAmount));

  const paymentStatus = normalizePaymentStatus(draft.paymentStatus ?? invoice.paymentStatus ?? booking.paymentStatus ?? 'Pending');
  const paidAmount = Math.max(0, Number(draft.paidAmount ?? invoice.paidAmount ?? booking.paidAmount ?? (paymentStatus === 'Paid' ? grandTotal : 0)));
  const balanceAmount = Math.max(0, Number(draft.balanceAmount ?? invoice.balanceAmount ?? booking.balanceAmount ?? grandTotal - paidAmount));
  const paymentMethod = normalizePaymentMethod(draft.paymentMethod ?? invoice.paymentMethod ?? booking.paymentMethod ?? paymentSettings.defaultMethod ?? 'Cash');
  const paymentDate = draft.paymentDate || invoice.paymentDate || booking.paymentDate || (paymentStatus === 'Paid' ? new Date() : null);
  const transactionId = trimText(draft.transactionId ?? invoice.transactionId ?? booking.transactionId ?? '');
  const packageLabel = booking.fareBreakdown?.packageLabel || booking.finalBill?.packageLabel || (booking.tripType === 'local-package' ? 'Local Package' : booking.tripType === 'half-day-package' ? 'Half Day Package' : booking.tripType === 'airport-transfer' ? 'Airport Pickup / Drop' : booking.tripType === 'outstation-package' ? 'Outstation Package' : booking.tripType === 'wedding-vip-event' ? 'Wedding / VIP Events' : 'Base Fare');
  const distanceLabel = booking.fareBreakdown?.tripType === 'local-package' || booking.fareBreakdown?.tripType === 'half-day-package' ? 'Extra KM Charges' : booking.fareBreakdown?.tripType === 'airport-transfer' ? 'Airport Charges' : booking.fareBreakdown?.tripType === 'outstation-package' ? 'Extra KM Charges' : booking.fareBreakdown?.tripType === 'wedding-vip-event' ? 'Wedding / VIP Charges' : 'Distance Fare';

  const lineItems = [
    { description: packageLabel, quantity: 1, unitPrice: baseFare, amount: baseFare },
    { description: distanceLabel, quantity: 1, unitPrice: Math.max(1, Number(draft.distanceInKm ?? booking.distanceInKm ?? 1)), amount: distanceFare }
  ];

  builtInCharges.forEach((item) => {
    lineItems.push({ description: item.name, quantity: 1, unitPrice: item.amount, amount: item.amount });
  });

  extraCharges.forEach((item) => {
    lineItems.push({ description: item.name, quantity: 1, unitPrice: item.amount, amount: item.amount });
  });

  if (discountAmount > 0) {
    lineItems.push({ description: discountType === 'percentage' ? `Discount (${discountValue}%)` : 'Discount', quantity: 1, unitPrice: discountAmount, amount: -discountAmount, isDiscountRow: true });
  }

  lineItems.push({ description: `GST (${taxPercent}%)`, quantity: 1, unitPrice: subtotal, amount: gstAmount, isTaxRow: true });

  return {
    extraCharges,
    discountType,
    discountValue,
    discountAmount,
    subtotal,
    subtotalBeforeDiscount,
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
    fareBreakdown: {
      baseFare,
      packageLabel,
      distanceFare,
      extraDistanceCharges: Number(draft.extraDistanceCharges ?? booking.extraDistanceCharges ?? 0),
      tollCharges: Number(draft.tollCharges ?? booking.tollCharges ?? 0),
      parkingCharges: Number(draft.parkingCharges ?? booking.parkingCharges ?? 0),
      driverAllowance: Number(draft.driverAllowance ?? booking.driverAllowance ?? 0),
      waitingCharges: Number(draft.waitingCharges ?? booking.waitingCharges ?? 0),
      nightCharges: Number(draft.nightCharges ?? booking.nightCharges ?? 0),
      statePermitCharges: Number(draft.statePermitCharges ?? booking.statePermitCharges ?? 0),
      miscellaneousCharges: Number(draft.miscellaneousCharges ?? booking.miscellaneousCharges ?? 0),
      extraCharges,
      discountAmount,
      discountType,
      discountValue,
      subtotal,
      subtotalBeforeDiscount,
      gstPercent: taxPercent,
      gstAmount,
      totalAmount: grandTotal,
      paidAmount,
      balanceAmount,
      paymentStatus,
      paymentMethod,
      paymentDate,
      transactionId
    }
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