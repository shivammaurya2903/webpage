const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { buildBillingLineItems, validateBillingBreakdown } = require('../services/billingService');
const { roundCurrency, toNumber } = require('./billingMath');

function findFontPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function registerInvoiceFonts(doc) {
  const fontCandidates = {
    regular: [
      'C:\\Windows\\Fonts\\Inter-Regular.ttf',
      'C:\\Windows\\Fonts\\Poppins-Regular.ttf',
      'C:\\Windows\\Fonts\\Montserrat-Regular.ttf',
      'C:\\Windows\\Fonts\\SourceSansPro-Regular.ttf',
      'C:\\Windows\\Fonts\\SourceSans3-Regular.ttf',
      'C:\\Windows\\Fonts\\segoeui.ttf'
    ],
    medium: [
      'C:\\Windows\\Fonts\\Inter-Medium.ttf',
      'C:\\Windows\\Fonts\\Poppins-Medium.ttf',
      'C:\\Windows\\Fonts\\Montserrat-Medium.ttf',
      'C:\\Windows\\Fonts\\SourceSansPro-Semibold.ttf',
      'C:\\Windows\\Fonts\\SourceSans3-Semibold.ttf',
      'C:\\Windows\\Fonts\\segoeui.ttf'
    ],
    semibold: [
      'C:\\Windows\\Fonts\\Inter-SemiBold.ttf',
      'C:\\Windows\\Fonts\\Poppins-SemiBold.ttf',
      'C:\\Windows\\Fonts\\Montserrat-SemiBold.ttf',
      'C:\\Windows\\Fonts\\SourceSansPro-Semibold.ttf',
      'C:\\Windows\\Fonts\\SourceSans3-Semibold.ttf',
      'C:\\Windows\\Fonts\\segoeuib.ttf',
      'C:\\Windows\\Fonts\\segoeui.ttf'
    ],
    bold: [
      'C:\\Windows\\Fonts\\Inter-Bold.ttf',
      'C:\\Windows\\Fonts\\Poppins-Bold.ttf',
      'C:\\Windows\\Fonts\\Montserrat-Bold.ttf',
      'C:\\Windows\\Fonts\\SourceSansPro-Bold.ttf',
      'C:\\Windows\\Fonts\\SourceSans3-Bold.ttf',
      'C:\\Windows\\Fonts\\segoeuib.ttf'
    ]
  };

  const fontPaths = {
    regular: findFontPath(fontCandidates.regular),
    medium: findFontPath(fontCandidates.medium),
    semibold: findFontPath(fontCandidates.semibold),
    bold: findFontPath(fontCandidates.bold)
  };

  if (fontPaths.regular) doc.registerFont('Invoice-Regular', fontPaths.regular);
  if (fontPaths.medium) doc.registerFont('Invoice-Medium', fontPaths.medium);
  if (fontPaths.semibold) doc.registerFont('Invoice-SemiBold', fontPaths.semibold);
  if (fontPaths.bold) doc.registerFont('Invoice-Bold', fontPaths.bold);

  return {
    regular: fontPaths.regular ? 'Invoice-Regular' : 'Helvetica',
    medium: fontPaths.medium ? 'Invoice-Medium' : (fontPaths.semibold ? 'Invoice-SemiBold' : 'Helvetica'),
    semibold: fontPaths.semibold ? 'Invoice-SemiBold' : (fontPaths.bold ? 'Invoice-Bold' : 'Helvetica-Bold'),
    bold: fontPaths.bold ? 'Invoice-Bold' : 'Helvetica-Bold'
  };
}


function formatMoney(value) {
  const amount = Number(value || 0);
  return `${String.fromCharCode(0x20B9)}${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)}`;
}

function formatMoneySigned(value) {
  const amount = Number(value || 0);
  if (amount < 0) return `-${formatMoney(Math.abs(amount))}`;
  return formatMoney(amount);
}

function formatDate(value, fallback = 'Unknown') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value, fallback = 'Unknown') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return `${formatDate(value)} ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatDuration(minutes) {
  const totalMinutes = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (!hours) return `${remainingMinutes} min`;
  return `${hours} hr ${remainingMinutes} min`;
}

function formatTripTypeLabel(value, fallback = 'Unknown') {
  const text = String(value || '').trim();
  if (!text) return fallback;

  const normalized = text.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized
    .split(' ')
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'vip') return 'VIP';
      if (lower === 'km') return 'KM';
      if (lower === 'gst') return 'GST';
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function formatKm(value, suffix = 'km') {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return `0 ${suffix}`;
  return `${amount.toFixed(amount % 1 === 0 ? 0 : 1)} ${suffix}`;
}

function formatRatePerKm(value) {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(value || 0))}/km`;
}

function formatRatePerDay(value) {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(value || 0))}/day`;
}

function displayText(value, fallback = 'Unknown') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function singleLineText(doc, text, x, y, options = {}) {
  const width = options.width ?? 100;
  const minFontSize = options.minFontSize ?? 6;
  let fontSize = options.fontSize ?? 8;
  const height = options.height ?? Math.ceil(fontSize * 1.25);
  const align = options.align ?? 'left';
  const value = displayText(text, options.fallback ?? 'Unknown');
  const shouldFit = options.fitToWidth ?? false;

  if (shouldFit) {
    while (fontSize > minFontSize && doc.widthOfString(value, { width, align }) > width) {
      fontSize = Math.max(minFontSize, fontSize - 0.25);
      doc.fontSize(fontSize);
    }
  }

  doc.text(value, x, y, {
    width,
    height,
    align,
    lineBreak: false,
    ellipsis: false
  });
}

function resolveNumericValue(...values) {
  for (const value of values) {
    const parsed = toNumber(value, NaN);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function resolveTripDistance(breakdown = {}, booking = {}, invoice = {}) {
  return resolveNumericValue(
    breakdown.tripDistance,
    breakdown.distanceKm,
    breakdown.distanceInKm,
    booking.distanceInKm,
    invoice.distance,
    booking.routeDistance,
    booking.finalBill?.distance
  );
}

function formatDistanceDisplay(distanceValue) {
  const value = resolveNumericValue(distanceValue);
  if (value <= 0) return 'N/A';
  return formatKm(value, 'km');
}

function normalizeInvoiceText(value, fallback = 'N/A') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function validateInvoiceRenderModel(model, booking = {}, invoice = {}) {
  const issues = [];
  const invoiceId = normalizeInvoiceText(model?.invoice?.invoiceId, '');
  const bookingId = normalizeInvoiceText(model?.invoice?.bookingId, '');
  const driverName = normalizeInvoiceText(model?.ride?.driverName, '');
  const driverPhone = normalizeInvoiceText(model?.ride?.driverPhone, '');
  const tripDistanceKm = resolveNumericValue(model?.billingSummary?.tripDistanceKm);
  const tripDistance = normalizeInvoiceText(model?.billingSummary?.tripDistance, '');
  const distanceCharge = resolveNumericValue(model?.billingBreakdown?.distanceCharge, model?.billingBreakdown?.distanceFare);

  if (!invoiceId) issues.push('invoiceId');
  if (!bookingId) issues.push('bookingId');
  if (!driverName) issues.push('driverName');
  if (!driverPhone) issues.push('driverPhone');
  if (distanceCharge > 0 && tripDistanceKm <= 0) issues.push('tripDistanceKm');
  if (tripDistanceKm > 0 && (!tripDistance || /^(0\s?km|n\/a|unknown)$/i.test(tripDistance))) issues.push('tripDistanceDisplay');

  return {
    ok: issues.length === 0,
    issues
  };
}

function resolveDriverAllowancePerDay(breakdown = {}) {
  const explicitPerDay = resolveNumericValue(breakdown.driverAllowancePerDay);
  if (explicitPerDay > 0) return explicitPerDay;

  const allowanceAmount = resolveNumericValue(breakdown.driverAllowance);
  if (allowanceAmount > 0) {
    const allowanceDays = Math.max(1, resolveNumericValue(breakdown.driverAllowanceDays, 1));
    return roundCurrency(allowanceAmount / allowanceDays);
  }

  return 0;
}

function getInvoiceLayoutProfile(model) {
  const lineItemCount = Array.isArray(model.lineItems) ? model.lineItems.length : 0;
  const estimatedHeight = 46 + 22 + 18 + 42 + 106 + (lineItemCount * 22) + 122 + 38 + 10;
  const compact = estimatedHeight > 760 ? 0.86 : estimatedHeight > 700 ? 0.92 : 1;

  return { estimatedHeight, compact };
}

function drawShadowedCard(doc, x, y, width, height, radius, fillColor, borderColor, shadowColor = '#dbe2ef') {
  doc.roundedRect(x + 1, y + 1.5, width, height, radius).fillOpacity(0.08).fill(shadowColor).fillOpacity(1);
  doc.roundedRect(x, y, width, height, radius).fillAndStroke(fillColor, borderColor);
}

function safeText(value, fallback = 'Unknown') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function truncateText(value, maxLength = 42, fallback = 'Unknown') {
  const text = safeText(value, fallback);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function getBillingBreakdown(booking = {}, invoice = {}) {
  return invoice.billingBreakdown || invoice.fareBreakdown || booking.billingBreakdown || booking.fareBreakdown || booking.finalBill || {};
}

function getBusinessInfo(settings = {}) {
  const billing = settings.billing || {};
  const socialLinks = settings.socialLinks || {};

  return {
    businessName: settings.businessName || 'RAM KRISHNA TOUR & TRAVELS',
    tagline: settings.homepage?.seoTitle || 'Luxury chauffeur and tour billing',
    email: settings.contactEmail || 'support@example.com',
    website: socialLinks.website || 'www.ramkrishnatourtravels.com',
    logoText: settings.logoText || 'RK',
    taxPercent: Number(billing.taxPercent || process.env.INVOICE_TAX_PERCENT || 5),
    upiId: billing.upiId || process.env.UPI_ID || 'rktravel@upi',
    bankAccountName: billing.bankAccountName || settings.businessName || 'RAM KRISHNA TOUR & TRAVELS',
    bankAccountNumber: billing.bankAccountNumber || process.env.BANK_ACCOUNT_NUMBER || '000000000000',
    bankBranch: billing.bankBranch || 'Lucknow Main',
    footerNote: billing.footerNote || 'Thank you for choosing our premium chauffeur and travel services.'
  };
}

function getLineItems(booking, invoice, businessInfo) {
  const billingBreakdown = getBillingBreakdown(booking, invoice);
  return Array.isArray(billingBreakdown.lineItems) && billingBreakdown.lineItems.length
    ? billingBreakdown.lineItems
    : buildBillingLineItems(billingBreakdown);
}

function buildInvoiceModel({ booking, invoice, driver, settings }) {
  const business = getBusinessInfo(settings);
  const billingBreakdown = getBillingBreakdown(booking, invoice);
  const lineItems = Array.isArray(billingBreakdown.lineItems) && billingBreakdown.lineItems.length
    ? billingBreakdown.lineItems
    : buildBillingLineItems(billingBreakdown);
  const resolvedTripDistance = resolveTripDistance(billingBreakdown, booking, invoice);
  const resolvedDriverAllowancePerDay = resolveDriverAllowancePerDay(billingBreakdown);
  const validation = validateBillingBreakdown(billingBreakdown, lineItems);
  if (!validation.ok) {
    const error = new Error('Invoice reconciliation failed');
    error.details = validation;
    throw error;
  }

  const subtotal = roundCurrency(billingBreakdown.subtotal ?? validation.visibleSum);
  const taxPercent = Number(invoice.taxPercent || billingBreakdown.gstPercent || business.taxPercent || 5);
  const taxAmount = roundCurrency(billingBreakdown.gstAmount ?? invoice.taxAmount ?? subtotal * (taxPercent / 100));
  const discountAmount = roundCurrency(billingBreakdown.discountAmount ?? invoice.discountAmount ?? 0);
  const totalAmount = roundCurrency(billingBreakdown.totalAmount ?? invoice.totalFare ?? billingBreakdown.totalFare ?? subtotal + taxAmount - discountAmount);
  const paymentStatus = invoice.paymentStatus || booking.paymentStatus || 'Pending';
  const amountPaid = roundCurrency(invoice.amountPaid || billingBreakdown.paidAmount || (paymentStatus === 'Paid' ? totalAmount : 0));
  const balanceDue = Math.max(0, totalAmount - amountPaid);

  return {
    business,
    invoice: {
      invoiceId: invoice.invoiceId || booking.invoiceId || 'PENDING',
      bookingId: booking.bookingId || 'PENDING',
      invoiceDate: invoice.createdAt || booking.updatedAt || new Date(),
      dueDate: invoice.paidAt || booking.paidAt || invoice.createdAt || new Date(),
      status: paymentStatus
    },
    customer: {
      name: normalizeInvoiceText(booking.customerName, 'N/A'),
      email: normalizeInvoiceText(booking.email, 'N/A'),
      phone: normalizeInvoiceText(booking.phone, 'N/A'),
      address: normalizeInvoiceText(booking.billingAddress || booking.pickupLocation, 'N/A'),
      pickupLocation: normalizeInvoiceText(booking.pickupLocation, 'N/A'),
      dropLocation: normalizeInvoiceText(booking.dropLocation, 'N/A')
    },
    ride: {
      vehicle: normalizeInvoiceText(invoice.vehicle || booking.selectedCar, 'N/A'),
      vehicleType: normalizeInvoiceText(invoice.carType || billingBreakdown.tripType || booking.selectedPackage, 'N/A'),
      driverName: normalizeInvoiceText(invoice.driverName ?? driver?.driverName, 'Not assigned'),
      driverPhone: normalizeInvoiceText(invoice.driverPhone ?? driver?.phone, 'Not assigned'),
      pickupDate: booking.pickupDate,
      pickupTime: booking.pickupTime,
      rideDuration: formatDuration(billingBreakdown.estimatedDuration ?? booking.estimatedDuration ?? booking.duration ?? booking.rideDuration),
      distance: formatDistanceDisplay(resolvedTripDistance),
      rideStatus: booking.bookingStatus || paymentStatus
    },
    billingSummary: {
      tripDistanceKm: resolvedTripDistance,
      tripDistance: formatDistanceDisplay(resolvedTripDistance),
      tripDuration: normalizeInvoiceText(formatDuration(billingBreakdown.estimatedDuration ?? booking.estimatedDuration ?? booking.duration), 'N/A'),
      vehicle: normalizeInvoiceText(invoice.vehicle || booking.selectedCar, 'N/A'),
      tripType: formatTripTypeLabel(billingBreakdown.tripType || booking.tripType),
      ratePerKm: billingBreakdown.ratePerKm || billingBreakdown.pricePerKm || 0,
      includedKm: billingBreakdown.includedKm ?? 0,
      driverAllowancePerDay: resolvedDriverAllowancePerDay,
      gstRate: taxPercent
    },
    payment: {
      method: normalizeInvoiceText(invoice.paymentMethod || booking.paymentMethod, 'N/A'),
      status: paymentStatus,
      amountPaid,
      balanceDue,
      transactionId: normalizeInvoiceText(invoice.transactionId || booking.transactionId, 'N/A'),
      paymentDate: invoice.paidAt || booking.paidAt || null
    },
    tax: {
      subtotal,
      discountAmount,
      taxPercent,
      taxAmount,
      totalAmount,
      amountPaid,
      balanceDue,
      currency: 'INR'
    },
    terms: Array.isArray(invoice.terms) && invoice.terms.length ? invoice.terms : [
      'Payment is due after ride completion unless otherwise agreed in writing.',
      'Tolls, parking, and permit charges are billed as applicable based on route and usage.',
      'Cancellations after driver dispatch may attract a trip-specific cancellation fee.',
      'Any discrepancy should be reported within 48 hours of invoice generation.',
      'This is a tax invoice issued in compliance with applicable Indian GST requirements.'
    ],
    billingBreakdown: {
      ...billingBreakdown,
      subtotal,
      gstPercent: taxPercent,
      gstAmount: taxAmount,
      discountAmount,
      totalAmount,
      amountPaid,
      balanceDue,
      lineItems
    },
    lineItems
  };

  model.layout = getInvoiceLayoutProfile(model);

  return model;
}

function drawSectionTitle(doc, fonts, title, subtitle, accent = '#5b21b6') {
  doc.fillColor(accent).font(fonts.medium).fontSize(13);
  singleLineText(doc, String(title), doc.page.margins.left, doc.y, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, fontSize: 13, fallback: String(title) });
  if (subtitle) {
    doc.moveDown(0.06);
    doc.fillColor('#64748b').font(fonts.regular).fontSize(6.9);
    singleLineText(doc, subtitle, doc.page.margins.left, doc.y, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, fontSize: 6.9, fallback: subtitle });
  }
  doc.moveDown(0.08);
}

function drawMetaStrip(doc, fonts, items) {
  const gap = 8;
  const width = (doc.page.width - doc.page.margins.left - doc.page.margins.right - gap * (items.length - 1)) / items.length;
  const startX = doc.page.margins.left;
  const y = doc.y;
  const height = 20;

  items.forEach((item, index) => {
    const itemX = startX + index * (width + gap);
    doc.roundedRect(itemX, y, width, height, 6).fillAndStroke('#f8f7ff', '#e5def6');
    doc.fillColor('#6b7280').font(fonts.medium).fontSize(5.9);
    singleLineText(doc, item.label, itemX + 6, y + 2.5, { width: width - 12, align: 'center', fontSize: 5.9, fallback: item.label });
    doc.fillColor('#111827').font(fonts.medium).fontSize(7.3);
    singleLineText(doc, item.value || 'Unknown', itemX + 6, y + 9.6, { width: width - 12, align: 'center', fontSize: 7.3, fallback: 'Unknown' });
  });

  doc.y = y + height + 4;
}

function drawDetailCard(doc, fonts, title, items, options = {}) {
  const width = options.width || 258;
  const height = options.height || (28 + Math.ceil(items.length / 2) * 13);
  const x = options.x || doc.page.margins.left;
  const y = options.y || doc.y;
  const accent = options.accent || '#5b21b6';
  const background = options.background || '#ffffff';
  const border = options.border || '#e6d7f5';
  const headerFill = options.headerFill || '#f8f5ff';

  doc.roundedRect(x, y, width, height, 8).fillAndStroke(background, border);
  doc.roundedRect(x, y, width, 17, 8).fillAndStroke(headerFill, border);
  doc.fillColor(accent).font(fonts.semibold).fontSize(8.6).text(title.toUpperCase(), x + 8, y + 4.5, { width: width - 16, align: 'left' });

  const bodyTop = y + 19;
  const bodyWidth = width - 16;
  const colWidth = bodyWidth / 2;

  items.forEach((item, index) => {
    const row = Math.floor(index / 2);
    const col = index % 2;
    const itemX = x + 8 + col * colWidth;
    const itemY = bodyTop + row * 13;
    doc.fillColor('#64748b').font(fonts.medium).fontSize(5.9).text(item.label, itemX, itemY, { width: colWidth - 6 });
    doc.fillColor('#111827').font(fonts.medium).fontSize(7.0).text(truncateText(item.value || 'Unknown', item.maxLength || 26, 'Unknown'), itemX, itemY + 5.8, { width: colWidth - 6 });
  });

  return y + height;
}

function drawCardRow(doc, fonts, cards, options = {}) {
  const gap = options.gap ?? 10;
  const widths = options.widths || cards.map(() => (doc.page.width - doc.page.margins.left - doc.page.margins.right - gap * (cards.length - 1)) / cards.length);
  const x = options.x || doc.page.margins.left;
  const y = options.y || doc.y;

  let nextY = y;
  cards.forEach((card, index) => {
    const cardX = x + widths.slice(0, index).reduce((sum, amount) => sum + amount, 0) + gap * index;
    const cardHeight = drawDetailCard(doc, fonts, card.title, card.items, {
      x: cardX,
      y,
      width: widths[index],
      height: card.height,
      accent: card.accent,
      background: card.background,
      border: card.border,
      headerFill: card.headerFill
    });
    nextY = Math.max(nextY, cardHeight);
  });

  doc.y = nextY + (options.afterGap ?? 6);
}

function drawBillingSummaryCard(doc, fonts, model) {
  const cardWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x = doc.page.margins.left;
  const y = doc.y;
  const compact = model.layout?.compact ?? 1;
  const cardHeight = Math.round(96 * compact);
  const panelWidth = (cardWidth - 24) / 2;
  const panelGap = 10;
  const rowHeight = Math.round(10 * compact);
  const labelWidth = 72;
  const valueWidth = panelWidth - 18 - labelWidth;

  drawShadowedCard(doc, x, y, cardWidth, cardHeight, 12, '#ffffff', '#d7e3f4');
  doc.roundedRect(x, y, cardWidth, 20, 12).fillAndStroke('#eef5ff', '#d7e3f4');
  doc.fillColor('#102a43').font(fonts.medium).fontSize(13).text('Billing Summary', x + 12, y + 5.6, { width: cardWidth - 24 });

  const renderPanel = (panelX, title, rows) => {
    const panelY = y + 24;
    const panelHeight = cardHeight - 28;
    doc.roundedRect(panelX, panelY, panelWidth, panelHeight, 8).fillAndStroke('#fbfdff', '#e1ebf7');
    doc.fillColor('#0f172a').font(fonts.medium).fontSize(10.8);
    singleLineText(doc, title, panelX + 8, panelY + 5, { width: panelWidth - 16, fontSize: 10.8, fallback: title });
    doc.moveTo(panelX + 8, panelY + 15).lineTo(panelX + panelWidth - 8, panelY + 15).strokeColor('#dbe5f3').lineWidth(0.7).stroke();

    rows.forEach((row, index) => {
      const rowY = panelY + 18 + (index * rowHeight);
      doc.fillColor('#64748b').font(fonts.regular).fontSize(8.4);
      singleLineText(doc, row.label, panelX + 8, rowY, { width: labelWidth, fontSize: 8.4, fallback: row.label });
      doc.fillColor('#111827').font(fonts.medium).fontSize(8.4);
      singleLineText(doc, row.value, panelX + 8 + labelWidth, rowY, { width: valueWidth, align: 'right', fontSize: 8.4, fallback: row.value });
    });
  };

  const tripRows = [
    { label: 'Distance', value: displayText(model.billingSummary.tripDistance, 'N/A') },
    { label: 'Duration', value: displayText(model.billingSummary.tripDuration) },
    { label: 'Vehicle', value: displayText(model.billingSummary.vehicle) },
    { label: 'Trip Type', value: displayText(model.billingSummary.tripType) }
  ];
  const pricingRows = [
    { label: 'Rate Per KM', value: formatRatePerKm(model.billingSummary.ratePerKm) },
    { label: 'Driver Allowance', value: formatRatePerDay(model.billingSummary.driverAllowancePerDay) },
    { label: 'GST Rate', value: `${model.billingSummary.gstRate}%` }
  ];

  renderPanel(x + 14, 'Trip Information', tripRows);
  renderPanel(x + 14 + panelWidth + panelGap, 'Pricing Details', pricingRows);

  doc.y = y + cardHeight + 6;
}

function drawFinancialSummaryCard(doc, fonts, model) {
  const cardWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x = doc.page.margins.left;
  const y = doc.y;
  const labelWidth = 116;
  const valueWidth = cardWidth - 24 - labelWidth;
  const rowHeight = 11;
  const boxHeight = 106;

  drawShadowedCard(doc, x, y, cardWidth, boxHeight, 12, '#fffdf6', '#ead79f', '#efdca1');
  doc.roundedRect(x, y, cardWidth, 20, 12).fillAndStroke('#fef3c7', '#ead79f');
  doc.fillColor('#7c2d12').font(fonts.medium).fontSize(13).text('Financial Summary', x + 12, y + 5.6, { width: cardWidth - 24 });

  const rows = [
    ['Subtotal', formatMoney(model.tax.subtotal), '#111827', '#111827'],
    [`GST (${model.tax.taxPercent}%)`, formatMoney(model.tax.taxAmount), '#111827', '#111827'],
    ['Discount', formatMoneySigned(-model.tax.discountAmount), '#15803d', '#15803d']
  ];

  rows.forEach((row, index) => {
    const rowY = y + 26 + (index * rowHeight);
    doc.fillColor(row[2]).font(fonts.medium).fontSize(9.0);
    singleLineText(doc, row[0], x + 12, rowY, { width: labelWidth, fontSize: 9.0, fallback: row[0] });
    doc.fillColor(row[3]).font(fonts.medium).fontSize(9.0);
    singleLineText(doc, row[1], x + 12 + labelWidth, rowY, { width: valueWidth, align: 'right', fontSize: 9.0, fallback: row[1] });
  });

  const grandTop = y + 53;
  doc.moveTo(x + 12, grandTop).lineTo(x + cardWidth - 12, grandTop).strokeColor('#e3d5a1').lineWidth(0.8).stroke();
  doc.moveTo(x + 12, grandTop + 31).lineTo(x + cardWidth - 12, grandTop + 31).strokeColor('#e3d5a1').lineWidth(0.8).stroke();
  doc.fillColor('#4c1d95').font(fonts.semibold).fontSize(12.4);
  singleLineText(doc, 'Grand Total', x + 12, grandTop + 6, { width: labelWidth, fontSize: 12.4, fallback: 'Grand Total' });
  doc.fillColor('#4c1d95').font(fonts.semibold).fontSize(15.8);
  singleLineText(doc, formatMoney(model.tax.totalAmount), x + 12 + labelWidth, grandTop + 4, { width: valueWidth, align: 'right', fontSize: 15.8, fallback: formatMoney(model.tax.totalAmount) });

  doc.fillColor('#374151').font(fonts.medium).fontSize(9.0);
  singleLineText(doc, 'Amount Paid', x + 12, y + 83, { width: labelWidth, fontSize: 9.0, fallback: 'Amount Paid' });
  doc.fillColor('#111827').font(fonts.medium).fontSize(9.0);
  singleLineText(doc, formatMoney(model.tax.amountPaid), x + 12 + labelWidth, y + 83, { width: valueWidth, align: 'right', fontSize: 9.0, fallback: formatMoney(model.tax.amountPaid) });
  doc.fillColor('#374151').font(fonts.medium).fontSize(9.0);
  singleLineText(doc, 'Balance', x + 12, y + 95, { width: labelWidth, fontSize: 9.0, fallback: 'Balance' });
  doc.fillColor('#111827').font(fonts.medium).fontSize(9.0);
  singleLineText(doc, formatMoney(model.tax.balanceDue), x + 12 + labelWidth, y + 95, { width: valueWidth, align: 'right', fontSize: 9.0, fallback: formatMoney(model.tax.balanceDue) });

  doc.y = y + boxHeight + 6;
}

function drawTable(doc, fonts, rows, model) {
  const startX = doc.page.margins.left;
  const compact = model.layout?.compact ?? 1;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = [Math.round(tableWidth * 0.35), Math.round(tableWidth * 0.45), tableWidth - Math.round(tableWidth * 0.35) - Math.round(tableWidth * 0.45)];
  const headerY = doc.y;
  const headerHeight = Math.round(19 * compact);
  const rowPaddingY = Math.round(3.5 * compact);

  doc.roundedRect(startX, headerY, tableWidth, headerHeight, 7).fillAndStroke('#1f2a44', '#1f2a44');
  ['Charge', 'Details', 'Amount'].forEach((label, index) => {
    const x = startX + widths.slice(0, index).reduce((sum, value) => sum + value, 0);
    doc.fillColor('#ffffff').font(fonts.bold).fontSize(11.4);
    singleLineText(doc, label, x + 7, headerY + 4.4, {
      width: widths[index] - 14,
      align: index === 2 ? 'right' : 'left',
      fontSize: 11.4,
      fallback: label
    });
  });

  doc.y = headerY + headerHeight;
  rows.forEach((row, index) => {
    const fill = index % 2 === 0 ? '#ffffff' : '#fbfcff';
    const rowY = doc.y;
    const detailsText = displayText(row.details || row.description, row.description || 'Charge details');
    const detailsHeight = Math.max(10, doc.heightOfString(detailsText, { width: widths[1] - 14, lineGap: 0.05 }) + 2);
    const rowHeight = Math.max(20, detailsHeight + 4);
    doc.roundedRect(startX, rowY, tableWidth, rowHeight, 7).fillAndStroke(fill, '#e1e8f5');

    doc.fillColor('#111827').font(fonts.medium).fontSize(8.8);
    singleLineText(doc, truncateText(row.description, 34, row.description), startX + 7, rowY + 4.5, {
      width: widths[0] - 14,
      align: 'left',
      fontSize: 8.8,
      fallback: row.description
    });

    doc.fillColor('#475569').font(fonts.regular).fontSize(8.5);
    singleLineText(doc, detailsText, startX + widths[0] + 7, rowY + 4.5, {
      width: widths[1] - 14,
      align: 'left',
      fontSize: 8.5,
      fallback: detailsText
    });

    doc.fillColor(row.isDiscountRow ? '#15803d' : '#111827').font(fonts.medium).fontSize(8.8);
    singleLineText(doc, formatMoneySigned(row.amount ?? 0), startX + widths[0] + widths[1] + 7, rowY + rowPaddingY, {
      width: widths[2] - 14,
      align: 'right',
      fontSize: 8.8,
      fallback: formatMoneySigned(row.amount ?? 0)
    });

    doc.y += rowHeight;
  });
  doc.y += 4;
}

function drawFooter(doc, fonts, model) {
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const boxHeight = 38;
  const x = doc.page.margins.left;
  const y = doc.y;

  doc.roundedRect(x, y, contentWidth, boxHeight, 7).fillAndStroke('#f8fbff', '#dbeafe');
  doc.fillColor('#374151').font(fonts.regular).fontSize(7.0);
  singleLineText(doc, `Support: ${model.business.phone} | ${model.business.email} | ${model.business.website}`, x + 10, y + 10, { width: contentWidth - 20, fontSize: 7.0, fallback: 'Support' });
  doc.fillColor('#111827').font(fonts.medium).fontSize(7.0);
  singleLineText(doc, 'Authorized Signature', x + 10, y + 23, { width: contentWidth - 20, fontSize: 7.0, align: 'right', fallback: 'Authorized Signature' });
  doc.y = y + boxHeight + 2;
}

function buildInvoicePdf({ booking, invoice, driver, settings }) {
  const model = buildInvoiceModel({ booking, invoice, driver, settings });
  const renderValidation = validateInvoiceRenderModel(model, booking, invoice);
  if (!renderValidation.ok) {
    const error = new Error(`Invoice rendering validation failed: ${renderValidation.issues.join(', ')}`);
    error.details = renderValidation;
    throw error;
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 10, bufferPages: true });
    const fonts = registerInvoiceFonts(doc);
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.info.Title = `Invoice ${model.invoice.invoiceId}`;
    doc.info.Author = model.business.businessName;
    doc.info.Subject = `${model.business.businessName} Commercial Invoice`;

    const headerY = doc.y;
    const layout = model.layout || getInvoiceLayoutProfile(model);
    const headerHeight = 82;
    const headerPadding = 16;
    const logoSize = 56;
    const leftWidth = Math.round(contentWidth * 0.12);
    const centerWidth = Math.round(contentWidth * 0.58);
    const rightWidth = contentWidth - leftWidth - centerWidth;
    const leftX = doc.page.margins.left;
    const centerX = leftX + leftWidth;
    const rightX = centerX + centerWidth;

    doc.roundedRect(leftX, headerY, contentWidth, headerHeight, 12).fill('#5b21b6');

    const logoX = leftX + Math.max(0, Math.floor((leftWidth - logoSize) / 2));
    const logoY = headerY + Math.floor((headerHeight - logoSize) / 2);
    doc.roundedRect(logoX, logoY, logoSize, logoSize, 10).fill('#d4af37');
    doc.fillColor('#1f103b').font(fonts.semibold).fontSize(10.5);
    singleLineText(doc, model.business.logoText, logoX, logoY + 22, { width: logoSize, fontSize: 10.5, align: 'center', fitToWidth: true, fallback: model.business.logoText });

    const centerTextX = centerX + headerPadding;
    const centerTextWidth = centerWidth - headerPadding - 8;
    const companyTop = headerY + 15;
    doc.fillColor('#ffffff').font(fonts.semibold).fontSize(18);
    singleLineText(doc, model.business.businessName, centerTextX, companyTop, { width: centerTextWidth, fontSize: 18, fitToWidth: true, fallback: model.business.businessName });
    doc.font(fonts.regular).fontSize(10).fillColor('#f4e8ff');
    singleLineText(doc, model.business.tagline, centerTextX, companyTop + 20, { width: centerTextWidth, fontSize: 10, fitToWidth: true, fallback: model.business.tagline });
    doc.font(fonts.medium).fontSize(10).fillColor('#ffffff');
    singleLineText(doc, `${displayText(model.business.address, 'Lucknow, Uttar Pradesh')} | ${model.business.phone}`, centerTextX, companyTop + 35, { width: centerTextWidth, fontSize: 10, fitToWidth: true, fallback: `${model.business.address} | ${model.business.phone}` });

    const infoCardX = rightX + Math.max(10, headerPadding - 2);
    const infoCardWidth = rightWidth - Math.max(20, headerPadding * 2 - 2);
    const infoCardY = headerY + 16;
    const infoCardHeight = 50;
    doc.roundedRect(infoCardX, infoCardY, infoCardWidth, infoCardHeight, 10).fill('#fefce8');
    doc.fillColor('#5b21b6').font(fonts.semibold).fontSize(16);
    singleLineText(doc, 'TAX INVOICE', infoCardX + 10, infoCardY + 8, { width: infoCardWidth - 20, fontSize: 16, align: 'right', fitToWidth: true, fallback: 'TAX INVOICE' });
    doc.fillColor('#6b7280').font(fonts.medium).fontSize(10);
    singleLineText(doc, `Invoice #: ${model.invoice.invoiceId}`, infoCardX + 10, infoCardY + 26, { width: infoCardWidth - 20, fontSize: 10, align: 'right', fitToWidth: true, fallback: model.invoice.invoiceId });
    singleLineText(doc, `Booking #: ${model.invoice.bookingId}`, infoCardX + 10, infoCardY + 38, { width: infoCardWidth - 20, fontSize: 10, align: 'right', fitToWidth: true, fallback: model.invoice.bookingId });

    doc.y = headerY + headerHeight + 4;
    drawMetaStrip(doc, fonts, [
      { label: 'Invoice Date', value: formatDateTime(model.invoice.invoiceDate), maxLength: 18 },
      { label: 'Due Date', value: formatDateTime(model.invoice.dueDate), maxLength: 18 },
      { label: 'GSTIN', value: model.business.gstin, maxLength: 18 },
      { label: 'Status', value: model.payment.status, maxLength: 16 }
    ]);

    drawCardRow(doc, fonts, [
      {
        title: 'Customer & Booking',
        accent: '#5b21b6',
        background: '#ffffff',
        border: '#e6d7f5',
        headerFill: '#f8f5ff',
        items: [
          { label: 'Customer', value: model.customer.name, maxLength: 22 },
          { label: 'Booking ID', value: model.invoice.bookingId, maxLength: 18 },
          { label: 'Phone', value: model.customer.phone, maxLength: 16 },
          { label: 'Email', value: model.customer.email, maxLength: 24 },
          { label: 'Pickup', value: model.customer.pickupLocation, maxLength: 24 },
          { label: 'Drop', value: model.customer.dropLocation, maxLength: 24 }
        ]
      },
      {
        title: 'Trip Details',
        accent: '#92400e',
        background: '#fffdf7',
        border: '#ead79f',
        headerFill: '#fff8e1',
        items: [
          { label: 'Vehicle', value: model.ride.vehicle, maxLength: 18 },
          { label: 'Trip Type', value: model.ride.vehicleType, maxLength: 18 },
          { label: 'Pickup Date', value: formatDate(model.ride.pickupDate), maxLength: 16 },
          { label: 'Pickup Time', value: safeText(model.ride.pickupTime, 'Unknown'), maxLength: 12 },
          { label: 'Driver', value: model.ride.driverName, maxLength: 18 },
          { label: 'Driver Phone', value: model.ride.driverPhone, maxLength: 16 }
        ]
      }
    ], { afterGap: 4 });

    drawBillingSummaryCard(doc, fonts, model);

    drawSectionTitle(doc, fonts, 'Fare Breakdown', 'Charges are reconciled against subtotal, GST, discount, and grand total');
    drawTable(doc, fonts, model.lineItems, model);

    drawFinancialSummaryCard(doc, fonts, model);

    drawFooter(doc, fonts, model);

    doc.end();
  });
}

module.exports = { buildInvoicePdf, buildInvoiceModel };