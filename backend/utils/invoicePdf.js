const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function findFontPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function registerInvoiceFonts(doc) {
  const fontPaths = {
    regular: findFontPath([
      'C:\\Windows\\Fonts\\segoeui.ttf',
      'C:\\Windows\\Fonts\\segoeui.woff',
      'C:\\Windows\\Fonts\\arial.ttf',
      'C:\\Windows\\Fonts\\calibri.ttf'
    ]),
    bold: findFontPath([
      'C:\\Windows\\Fonts\\segoeuib.ttf',
      'C:\\Windows\\Fonts\\arialbd.ttf',
      'C:\\Windows\\Fonts\\calibrib.ttf',
      'C:\\Windows\\Fonts\\segoeuiz.ttf'
    ]),
    fallback: findFontPath([
      'C:\\Windows\\Fonts\\seguisb.ttf',
      'C:\\Windows\\Fonts\\segoesb.ttf'
    ])
  };

  if (fontPaths.regular) doc.registerFont('Invoice-Regular', fontPaths.regular);
  if (fontPaths.bold) doc.registerFont('Invoice-Bold', fontPaths.bold);
  if (!fontPaths.regular && fontPaths.fallback) doc.registerFont('Invoice-Fallback', fontPaths.fallback);

  // Ensure rupee glyph availability: most Windows UI fonts include INR glyphs.
  const regularFont = fontPaths.regular ? 'Invoice-Regular' : (fontPaths.fallback ? 'Invoice-Fallback' : 'Helvetica');

  return {
    regular: regularFont,
    bold: fontPaths.bold ? 'Invoice-Bold' : (fontPaths.fallback ? 'Invoice-Fallback' : 'Helvetica-Bold')
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

function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return `${formatDate(value)} ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

function safeText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function truncateText(value, maxLength = 42, fallback = '—') {
  const text = safeText(value, fallback);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function getSubtotalFromFare(fare = {}, booking = {}, invoice = {}) {
  const subtotal = Number(fare.subtotalAmount || fare.subtotal || invoice.subtotalAmount || booking.subtotal || 0);
  if (subtotal > 0) return subtotal;

  const baseFare = Number(fare.packageBaseFare || fare.baseFare || fare.baseAmount || booking.baseFare || booking.estimatedFare || 0);
  const distanceFare = Number(fare.distanceFare || fare.distanceCharges || 0);
  const driverAllowance = Number(fare.driverAllowance || 0);
  const tollCharges = Number(fare.tollCharges || 0);
  const waitingCharges = Number(fare.waitingCharges || 0);
  const nightCharges = Number(fare.nightCharges || 0);
  const extraTravelCharges = Number(fare.extraTravelCharges || booking.extraCharges || 0);
  const discountAmount = Math.max(0, Number(invoice.discountAmount || booking.finalBill?.discountAmount || fare.discountAmount || 0));

  return Math.max(0, baseFare + distanceFare + driverAllowance + tollCharges + waitingCharges + nightCharges + extraTravelCharges - discountAmount);
}

function buildFinancialRows(model) {
  if (Array.isArray(model.lineItems) && model.lineItems.length) return model.lineItems;

  const rows = [];
  if (model.fare.packageBaseFare || model.fare.baseFare) {
    rows.push({
      description: model.fare.packageBaseFare ? 'Package / Base Fare' : 'Base Fare',
      quantity: 1,
      unitPrice: model.fare.packageBaseFare || model.fare.baseFare,
      amount: model.fare.packageBaseFare || model.fare.baseFare
    });
  }

  rows.push({
    description: model.fare.tripType === 'local-package' ? 'Extra Distance Charge' : 'Distance Fare',
    quantity: 1,
    unitPrice: model.fare.billableDistance || model.fare.tripDistance || 0,
    amount: model.fare.distanceFare || 0
  });

  if (model.fare.extraHourCharge) rows.push({ description: 'Extra Hour Charge', quantity: 1, unitPrice: model.fare.extraHourCharge, amount: model.fare.extraHourCharge });
  if (model.fare.tollCharges) rows.push({ description: 'Toll Charges', quantity: 1, unitPrice: model.fare.tollCharges, amount: model.fare.tollCharges });
  if (model.fare.driverAllowance) rows.push({ description: 'Driver Allowance', quantity: Math.max(1, Number(model.fare.driverAllowanceDays || 1)), unitPrice: model.fare.driverAllowance, amount: model.fare.driverAllowance });
  if (model.fare.waitingCharges) rows.push({ description: 'Waiting Charges', quantity: 1, unitPrice: model.fare.waitingCharges, amount: model.fare.waitingCharges });
  if (model.fare.nightCharges) rows.push({ description: 'Night Charges', quantity: 1, unitPrice: model.fare.nightCharges, amount: model.fare.nightCharges });
  if (model.fare.extraTravelCharges) rows.push({ description: 'Extra Travel Charges', quantity: 1, unitPrice: model.fare.extraTravelCharges, amount: model.fare.extraTravelCharges });

  rows.push({
    description: `GST (${model.tax.taxPercent}%)`,
    quantity: 1,
    unitPrice: model.tax.subtotal,
    amount: model.tax.taxAmount,
    isTaxRow: true
  });

  if (model.tax.discountAmount > 0) {
    rows.push({ description: 'Discounts', quantity: 1, unitPrice: model.tax.discountAmount, amount: -model.tax.discountAmount, isDiscountRow: true });
  }

  return rows;
}

function getBusinessInfo(settings = {}) {
  const billing = settings.billing || {};
  const socialLinks = settings.socialLinks || {};

  return {
    businessName: settings.businessName || 'RAM KRISHNA TOUR & TRAVELS',
    tagline: settings.homepage?.seoTitle || 'Luxury chauffeur and tour billing',
    address: settings.address || 'Lucknow, Uttar Pradesh',
    phone: settings.contactPhone || '8081181368',
    email: settings.contactEmail || 'support@example.com',
    website: socialLinks.website || 'www.ramkrishnatourtravels.com',
    logoText: settings.logoText || 'RK',
    gstin: billing.gstin || process.env.GSTIN || '09ABCDE1234F1Z5',
    taxPercent: Number(billing.taxPercent || process.env.INVOICE_TAX_PERCENT || 5),
    upiId: billing.upiId || process.env.UPI_ID || 'rktravel@upi',
    bankAccountName: billing.bankAccountName || settings.businessName || 'RAM KRISHNA TOUR & TRAVELS',
    bankAccountNumber: billing.bankAccountNumber || process.env.BANK_ACCOUNT_NUMBER || '000000000000',
    bankIfsc: billing.bankIfsc || process.env.BANK_IFSC || 'BANK0000000',
    bankBranch: billing.bankBranch || 'Lucknow Main',
    paymentLink: billing.paymentLink || process.env.PAYMENT_LINK || '',
    footerNote: billing.footerNote || 'Thank you for choosing our premium chauffeur and travel services.'
  };
}

function getLineItems(booking, invoice, businessInfo) {
  const fare = invoice.fareBreakdown || booking.fareBreakdown || booking.finalBill || {};
  const taxPercent = Number(fare.gstPercent || invoice.taxPercent || businessInfo.taxPercent || 5);
  const subtotal = getSubtotalFromFare(fare, booking, invoice);
  const discountAmount = Math.max(0, Number(invoice.discountAmount || booking.finalBill?.discountAmount || fare.discountAmount || 0));
  const taxAmount = Number(fare.gstAmount || invoice.taxAmount || Math.round(subtotal * (taxPercent / 100)));

  return buildFinancialRows({
    fare: {
      packageBaseFare: Number(fare.packageBaseFare || 0),
      baseFare: Number(fare.baseFare || fare.baseAmount || booking.baseFare || invoice.subtotalAmount || booking.estimatedFare || 0),
      distanceFare: Number(fare.distanceFare || fare.distanceCharges || 0),
      tripType: fare.tripType || booking.tripType || '',
      tripDistance: Number(fare.tripDistance || booking.distanceInKm || 0),
      billableDistance: Number(fare.billableDistance || booking.distanceInKm || 0),
      extraHourCharge: Number(fare.extraHourCharge || 0),
      driverAllowance: Number(fare.driverAllowance || 0),
      driverAllowanceDays: Number(fare.driverAllowanceDays || 1),
      tollCharges: Number(fare.tollCharges || 0),
      waitingCharges: Number(fare.waitingCharges || 0),
      nightCharges: Number(fare.nightCharges || 0),
      extraTravelCharges: Number(fare.extraTravelCharges || booking.extraCharges || 0)
    },
    tax: {
      subtotal,
      discountAmount,
      taxPercent,
      taxAmount
    }
  });
}

function buildInvoiceModel({ booking, invoice, driver, settings }) {
  const business = getBusinessInfo(settings);
  const fare = invoice.fareBreakdown || booking.fareBreakdown || booking.finalBill || {};
  const discountAmount = Math.max(0, Number(invoice.discountAmount || booking.finalBill?.discountAmount || fare.discountAmount || 0));
  const taxPercent = Number(invoice.taxPercent || booking.finalBill?.gstPercent || fare.gstPercent || business.taxPercent || 5);
  const baseAmount = Number(fare.packageBaseFare || fare.baseFare || fare.baseAmount || booking.baseFare || invoice.subtotalAmount || booking.estimatedFare || 0);
  const distanceAmount = Number(fare.distanceFare || fare.distanceCharges || 0);
  const waitingAmount = Number(fare.waitingCharges || 0);
  const tollAmount = Number(fare.tollCharges || 0);
  const driverAllowance = Number(fare.driverAllowance || 0);
  const nightAmount = Number(fare.nightCharges || 0);
  const extraAmount = Number(fare.extraTravelCharges || booking.extraCharges || 0);
  const subtotal = Math.max(0, Number(fare.subtotalAmount || fare.subtotal || baseAmount + distanceAmount + waitingAmount + tollAmount + driverAllowance + nightAmount + extraAmount - discountAmount));
  const taxAmount = Number(invoice.taxAmount || booking.finalBill?.gstAmount || fare.gstAmount || Math.round(subtotal * (taxPercent / 100)));
  const cgstAmount = Number(invoice.cgstAmount || fare.cgstAmount || Math.round(taxAmount / 2));
  const sgstAmount = Number(invoice.sgstAmount || fare.sgstAmount || Math.max(0, taxAmount - cgstAmount));
  const totalAmount = Number(invoice.totalFare || booking.totalFare || fare.totalAmount || booking.finalBill?.totalAmount || Math.max(0, subtotal + taxAmount));
  const paymentStatus = invoice.paymentStatus || booking.paymentStatus || 'Pending';
  const amountPaid = Number(invoice.amountPaid || booking.finalBill?.paidAmount || (paymentStatus === 'Paid' ? totalAmount : 0));
  const balanceDue = Math.max(0, totalAmount - amountPaid);
  const lineItems = buildFinancialRows({
    fare: {
      baseFare: baseAmount,
      packageBaseFare: fare.packageBaseFare || 0,
      distanceFare: distanceAmount,
      tripType: fare.tripType || booking.tripType,
      tripDistance: fare.tripDistance || booking.distanceInKm || 0,
      billableDistance: fare.billableDistance || booking.distanceInKm || 0,
      extraHourCharge: fare.extraHourCharge || 0,
      driverAllowance,
      driverAllowanceDays: fare.driverAllowanceDays || 1,
      tollCharges: tollAmount,
      waitingCharges: waitingAmount,
      nightCharges: nightAmount,
      extraTravelCharges: extraAmount
    },
    tax: {
      subtotal,
      discountAmount,
      taxPercent,
      taxAmount
    }
  });

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
      name: booking.customerName,
      email: booking.email,
      phone: booking.phone,
      address: booking.billingAddress || booking.pickupLocation,
      pickupLocation: booking.pickupLocation,
      dropLocation: booking.dropLocation
    },
    ride: {
      vehicle: invoice.vehicle || booking.selectedCar,
      vehicleType: invoice.carType || booking.selectedPackage || 'Luxury ride',
      driverName: invoice.driverName || driver?.driverName || 'Not assigned',
      driverPhone: invoice.driverPhone || driver?.phone || '—',
      pickupDate: booking.pickupDate,
      pickupTime: booking.pickupTime,
      rideDuration: booking.estimatedDuration ? `${Math.round(Number(booking.estimatedDuration || 0))} min` : booking.finalBill?.rideDuration || booking.rideDuration || 'As scheduled',
      distance: booking.distanceInKm ? `${Number(booking.distanceInKm).toFixed(1)} KM` : invoice.distance || booking.finalBill?.distance || booking.routeDistance || '—',
      rideStatus: booking.bookingStatus || paymentStatus
    },
    payment: {
      method: invoice.paymentMethod || booking.paymentMethod || 'Pending',
      status: paymentStatus,
      amountPaid,
      balanceDue,
      transactionId: invoice.transactionId || booking.transactionId || '—',
      paymentDate: invoice.paidAt || booking.paidAt || null
    },
    tax: {
      subtotal,
      discountAmount,
      taxPercent,
      taxAmount,
      cgstAmount,
      sgstAmount,
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
    lineItems
  };
}

function drawSectionTitle(doc, fonts, title, subtitle, accent = '#5b21b6') {
  doc.fillColor(accent).font(fonts.bold).fontSize(9.2).text(String(title).toUpperCase(), { characterSpacing: 0.55 });
  if (subtitle) {
    doc.moveDown(0.01);
    doc.fillColor('#6b7280').font(fonts.regular).fontSize(6.9).text(subtitle);
  }
  doc.moveDown(0.05);
}

function drawMetaStrip(doc, fonts, items) {
  const gap = 8;
  const width = (doc.page.width - doc.page.margins.left - doc.page.margins.right - gap * (items.length - 1)) / items.length;
  const startX = doc.page.margins.left;
  const y = doc.y;
  const height = 24;

  items.forEach((item, index) => {
    const itemX = startX + index * (width + gap);
    doc.roundedRect(itemX, y, width, height, 7).fillAndStroke('#f8f5ff', '#e5d9f6');
    doc.fillColor('#6b21a8').font(fonts.bold).fontSize(6.5).text(item.label, itemX + 8, y + 4, { width: width - 16, align: 'center' });
    doc.fillColor('#111827').font(fonts.regular).fontSize(7.6).text(truncateText(item.value || '—', item.maxLength || 20), itemX + 8, y + 12, { width: width - 16, align: 'center' });
  });

  doc.y = y + height + 6;
}

function drawDetailCard(doc, fonts, title, items, options = {}) {
  const width = options.width || 258;
  const height = options.height || (36 + Math.ceil(items.length / 2) * 16);
  const x = options.x || doc.page.margins.left;
  const y = options.y || doc.y;
  const accent = options.accent || '#5b21b6';
  const background = options.background || '#ffffff';
  const border = options.border || '#e6d7f5';
  const headerFill = options.headerFill || '#f8f5ff';

  doc.roundedRect(x, y, width, height, 8).fillAndStroke(background, border);
  doc.roundedRect(x, y, width, 18, 8).fillAndStroke(headerFill, border);
  doc.fillColor(accent).font(fonts.bold).fontSize(8.2).text(title.toUpperCase(), x + 8, y + 5, { width: width - 16, align: 'left' });

  const bodyTop = y + 22;
  const bodyWidth = width - 16;
  const colWidth = bodyWidth / 2;

  items.forEach((item, index) => {
    const row = Math.floor(index / 2);
    const col = index % 2;
    const itemX = x + 8 + col * colWidth;
    const itemY = bodyTop + row * 16;
    doc.fillColor('#6b7280').font(fonts.bold).fontSize(6.2).text(item.label, itemX, itemY, { width: colWidth - 4 });
    doc.fillColor('#111827').font(fonts.regular).fontSize(7.5).text(truncateText(item.value || '—', item.maxLength || 26), itemX, itemY + 7, { width: colWidth - 4 });
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

function drawTable(doc, fonts, rows) {
  const startX = doc.page.margins.left;
  const widths = [250, 46, 104, 114];
  const tableWidth = widths.reduce((sum, value) => sum + value, 0);
  const headerY = doc.y;
  const rowHeight = 15;
  const headerHeight = 19;

  doc.roundedRect(startX, headerY, tableWidth, headerHeight, 7).fillAndStroke('#5b21b6', '#5b21b6');
  ['Description', 'Qty', 'Rate', 'Amount'].forEach((label, index) => {
    const x = startX + widths.slice(0, index).reduce((sum, value) => sum + value, 0);
    doc.fillColor('#ffffff').font(fonts.bold).fontSize(7.1).text(label, x + 7, headerY + 5.5, {
      width: widths[index] - 14,
      align: index === 0 ? 'left' : 'right'
    });
  });

  doc.y = headerY + headerHeight;
  rows.forEach((row, index) => {
    const fill = index % 2 === 0 ? '#ffffff' : '#faf7ff';
    const rowY = doc.y;
    doc.roundedRect(startX, rowY, tableWidth, rowHeight, 7).fillAndStroke(fill, '#e8dff7');

    const values = [
      truncateText(row.description, 34),
      String(row.quantity ?? 1),
      formatMoney(row.unitPrice ?? row.rate ?? 0),
      formatMoneySigned(row.amount ?? 0)
    ];

    values.forEach((value, valueIndex) => {
      const x = startX + widths.slice(0, valueIndex).reduce((sum, amount) => sum + amount, 0);
      const isDescription = valueIndex === 0;
      const color = row.isDiscountRow ? '#b45309' : '#111827';
      doc.fillColor(color).font(isDescription ? fonts.bold : fonts.regular).fontSize(isDescription ? 7.5 : 7.3).text(value, x + 7, rowY + 4, {
        width: widths[valueIndex] - 14,
        align: isDescription ? 'left' : 'right'
      });
    });

    doc.y += rowHeight;
  });
  doc.y += 4;
}

function drawSummaryBox(doc, fonts, model) {
  const boxWidth = 220;
  const boxHeight = 98;
  const x = doc.page.width - doc.page.margins.right - boxWidth;
  const y = doc.y + 2;

  doc.roundedRect(x, y, boxWidth, boxHeight, 8).fillAndStroke('#fffdf7', '#ead79f');
  doc.fillColor('#7c2d12').font(fonts.bold).fontSize(8.5).text('Financial Summary', x + 10, y + 7);

  const rows = [
    ['Subtotal', formatMoney(model.tax.subtotal), false],
    ['CGST', formatMoney(model.tax.cgstAmount), false],
    ['SGST', formatMoney(model.tax.sgstAmount), false],
    ['GST', formatMoney(model.tax.taxAmount), false],
    ['Grand Total', formatMoney(model.tax.totalAmount), true],
    ['Amount Paid', formatMoney(model.tax.amountPaid), false],
    ['Remaining Balance', formatMoney(model.tax.balanceDue), false]
  ];

  let rowY = y + 20;
  rows.forEach((row) => {
    const isTotal = row[2];
    doc.fillColor(isTotal ? '#111827' : '#374151').font(isTotal ? fonts.bold : fonts.regular).fontSize(isTotal ? 8.8 : 7.3).text(row[0], x + 10, rowY, { width: 116 });
    doc.fillColor(isTotal ? '#5b21b6' : '#111827').font(isTotal ? fonts.bold : fonts.regular).fontSize(isTotal ? 9.4 : 7.3).text(row[1], x + 96, rowY, { width: 108, align: 'right' });
    rowY += isTotal ? 13 : 11;
  });

  doc.y = y + boxHeight + 4;
}

function drawFooter(doc, fonts, model) {
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const termsText = model.terms.slice(0, 2).join(' ');
  const termsHeight = Math.max(24, Math.min(34, doc.heightOfString(termsText, { width: contentWidth - 16, lineGap: 0.5 }) + 10));

  doc.roundedRect(doc.page.margins.left, doc.y, contentWidth, termsHeight, 8).fillAndStroke('#fcfbff', '#eadcf8');
  doc.fillColor('#374151').font(fonts.regular).fontSize(6.8).text(termsText, doc.page.margins.left + 8, doc.y + 5, { width: contentWidth - 16, lineGap: 0.5 });
  doc.y += termsHeight + 4;

  doc.fillColor('#5b21b6').font(fonts.bold).fontSize(7.7).text(model.business.footerNote, { align: 'center' });
  doc.fillColor('#6b7280').font(fonts.regular).fontSize(6.8).text(`Support: ${model.business.phone} | ${model.business.email} | ${model.business.website}`, { align: 'center' });
  doc.moveDown(0.08);

  const signatureY = doc.y + 2;
  const sigWidth = 112;
  const sigX = doc.page.width - doc.page.margins.right - sigWidth;
  doc.fillColor('#92400e').font(fonts.bold).fontSize(7.2).text('Authorized Signature', sigX, signatureY, { width: sigWidth, align: 'right' });
  doc.moveTo(sigX + 8, signatureY + 10).lineTo(sigX + sigWidth, signatureY + 10).strokeColor('#d4af37').lineWidth(0.8).stroke();
}

function buildInvoicePdf({ booking, invoice, driver, settings }) {
  const model = buildInvoiceModel({ booking, invoice, driver, settings });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 16, bufferPages: true });
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
    doc.roundedRect(doc.page.margins.left, headerY, contentWidth, 58, 10).fill('#5b21b6');
    doc.roundedRect(doc.page.margins.left + 10, headerY + 11, 34, 34, 9).fill('#d4af37');
    doc.fillColor('#1f103b').font(fonts.bold).fontSize(12.2).text(model.business.logoText, doc.page.margins.left + 10, headerY + 21, { width: 34, align: 'center' });

    const leftX = doc.page.margins.left + 50;
    doc.fillColor('#ffffff').font(fonts.bold).fontSize(14.4).text(model.business.businessName, leftX, headerY + 9, { width: 240 });
    doc.font(fonts.regular).fontSize(7.0).fillColor('#f4e8ff').text(model.business.tagline, leftX, headerY + 23, { width: 240 });
    doc.font(fonts.regular).fontSize(6.8).fillColor('#f4e8ff').text(`${truncateText(model.business.address, 30)} | ${model.business.phone}`, leftX, headerY + 34, { width: 240 });

    const badgeX = doc.page.width - doc.page.margins.right - 152;
    doc.roundedRect(badgeX, headerY + 9, 144, 40, 9).fill('#fefce8');
    doc.fillColor('#5b21b6').font(fonts.bold).fontSize(10.2).text('TAX INVOICE', badgeX + 8, headerY + 14, { width: 128, align: 'right' });
    doc.font(fonts.regular).fontSize(6.9).fillColor('#6b7280').text(`Invoice #: ${model.invoice.invoiceId}`, badgeX + 8, headerY + 25, { width: 128, align: 'right' });
    doc.text(`Booking: ${model.invoice.bookingId}`, badgeX + 8, headerY + 34, { width: 128, align: 'right' });

    doc.y = headerY + 66;
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
          { label: 'Pickup Time', value: safeText(model.ride.pickupTime, '—'), maxLength: 12 },
          { label: 'Driver', value: model.ride.driverName, maxLength: 18 },
          { label: 'Driver Phone', value: model.ride.driverPhone, maxLength: 16 }
        ]
      }
    ], { afterGap: 6 });

    drawCardRow(doc, fonts, [
      {
        title: 'Ride Summary',
        accent: '#1d4ed8',
        background: '#f8fbff',
        border: '#cfe0ff',
        headerFill: '#edf4ff',
        items: [
          { label: 'Distance', value: model.ride.distance, maxLength: 16 },
          { label: 'Duration', value: model.ride.rideDuration, maxLength: 16 },
          { label: 'Ride Status', value: model.ride.rideStatus, maxLength: 16 },
          { label: 'Payment Status', value: model.payment.status, maxLength: 16 }
        ]
      },
      {
        title: 'Payment Info',
        accent: '#0f766e',
        background: '#f7fffd',
        border: '#cdeee7',
        headerFill: '#ecfdf8',
        items: [
          { label: 'Method', value: model.payment.method, maxLength: 20 },
          { label: 'Status', value: model.payment.status, maxLength: 16 },
          { label: 'Transaction ID', value: model.payment.transactionId, maxLength: 20 },
          { label: 'Due Date', value: formatDateTime(model.invoice.dueDate), maxLength: 18 }
        ]
      }
    ], { afterGap: 4 });

    drawSectionTitle(doc, fonts, 'Fare Breakdown', 'Compact financial table with right-aligned currency values');
    drawTable(doc, fonts, model.lineItems);

    drawSummaryBox(doc, fonts, model);

    drawFooter(doc, fonts, model);

    doc.end();
  });
}

module.exports = { buildInvoicePdf, buildInvoiceModel };