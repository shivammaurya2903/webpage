const PDFDocument = require('pdfkit');

function formatMoney(value, currency = 'INR') {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(amount);
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
  if (Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0) {
    return invoice.lineItems;
  }

  const fare = invoice.fareBreakdown || booking.finalBill || {};
  const baseFare = Number(fare.baseFare || fare.baseAmount || invoice.subtotalAmount || booking.estimatedFare || invoice.totalFare || 0);
  const distanceCharges = Number(fare.distanceFare || fare.distanceCharges || 0);
  const waitingCharges = Number(fare.waitingCharges || 0);
  const tollCharges = Number(fare.tollCharges || 0);
  const driverAllowance = Number(fare.driverAllowance || 0);
  const nightCharges = Number(fare.nightCharges || 0);
  const discountAmount = Number(fare.discountAmount || 0);
  const taxPercent = Number(fare.gstPercent || invoice.taxPercent || businessInfo.taxPercent || 5);
  const taxable = Math.max(0, baseFare + distanceCharges + waitingCharges + tollCharges + driverAllowance + nightCharges - discountAmount);
  const taxAmount = Number(fare.gstAmount || invoice.taxAmount || Math.round(taxable * (taxPercent / 100)));

  return [
    { description: 'Base Fare', quantity: 1, rate: baseFare, amount: baseFare },
    { description: 'Distance Charges', quantity: 1, rate: distanceCharges, amount: distanceCharges },
    { description: 'Waiting Charges', quantity: 1, rate: waitingCharges, amount: waitingCharges },
    { description: 'Toll Charges', quantity: 1, rate: tollCharges, amount: tollCharges },
    { description: 'Driver Allowance', quantity: 1, rate: driverAllowance, amount: driverAllowance },
    { description: 'Night Charges', quantity: 1, rate: nightCharges, amount: nightCharges },
    { description: 'Discount', quantity: 1, rate: -discountAmount, amount: -discountAmount },
    { description: `GST (${taxPercent}%)`, quantity: 1, rate: taxAmount, amount: taxAmount }
  ];
}

function buildInvoiceModel({ booking, invoice, driver, settings }) {
  const business = getBusinessInfo(settings);
  const lineItems = getLineItems(booking, invoice, business);
  const subtotal = lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const discountAmount = Math.abs(Number(invoice.discountAmount || booking.finalBill?.discountAmount || 0));
  const taxPercent = Number(invoice.taxPercent || booking.finalBill?.gstPercent || business.taxPercent || 5);
  const taxAmount = Number(invoice.taxAmount || booking.finalBill?.gstAmount || lineItems.find((item) => String(item.description).startsWith('GST'))?.amount || Math.round(Math.max(0, subtotal - discountAmount) * (taxPercent / 100)));
  const cgstAmount = Number(invoice.cgstAmount || Math.round(taxAmount / 2));
  const sgstAmount = Number(invoice.sgstAmount || Math.max(0, taxAmount - cgstAmount));
  const totalAmount = Number(invoice.totalFare || booking.totalFare || booking.finalBill?.totalAmount || Math.max(0, subtotal + taxAmount - discountAmount));
  const paymentStatus = invoice.paymentStatus || booking.paymentStatus || 'Pending';
  const amountPaid = Number(invoice.amountPaid || booking.finalBill?.paidAmount || (['Paid', 'Paid Offline', 'Paid Online', 'Fully Paid'].includes(paymentStatus) ? totalAmount : 0));
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

function drawSectionTitle(doc, title, subtitle) {
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor('#5b21b6').text(String(title).toUpperCase(), { characterSpacing: 1.1 });
  if (subtitle) {
    doc.moveDown(0.1);
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(subtitle);
  }
  doc.moveDown(0.35);
}

function drawInfoGrid(doc, items, columns = 2) {
  const gap = 14;
  const width = (doc.page.width - doc.page.margins.left - doc.page.margins.right - gap * (columns - 1)) / columns;
  const startX = doc.page.margins.left;
  let x = startX;
  let y = doc.y;
  let rowHeight = 0;

  items.forEach((item, index) => {
    if (index > 0 && index % columns === 0) {
      x = startX;
      y += rowHeight + 10;
      rowHeight = 0;
    }

    const itemHeight = Math.max(52, doc.heightOfString(item.value || '—', { width: width - 28 }) + 30);
    doc.roundedRect(x, y, width, itemHeight, 14).fillAndStroke('#fbf7ff', '#eadcf8');
    doc.fillColor('#6b21a8').font('Helvetica-Bold').fontSize(8.5).text(item.label, x + 14, y + 12, { width: width - 28 });
    doc.fillColor('#111827').font('Helvetica').fontSize(10.2).text(item.value || '—', x + 14, y + 26, { width: width - 28, lineGap: 2 });
    rowHeight = Math.max(rowHeight, itemHeight);
    x += width + gap;
  });

  doc.y = y + rowHeight + 10;
}

function drawTable(doc, rows) {
  const startX = doc.page.margins.left;
  const widths = [250, 70, 95, 105];
  const tableWidth = widths.reduce((sum, value) => sum + value, 0);
  const headerY = doc.y;
  const rowGap = 0;

  doc.roundedRect(startX, headerY, tableWidth, 26, 8).fillAndStroke('#5b21b6', '#5b21b6');
  ['Description', 'Qty', 'Rate', 'Amount'].forEach((label, index) => {
    const x = startX + widths.slice(0, index).reduce((sum, value) => sum + value, 0);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(label, x + 10, headerY + 8, {
      width: widths[index] - 20,
      align: index === 0 ? 'left' : 'right'
    });
  });

  doc.y = headerY + 30;
  rows.forEach((row, index) => {
    const rowHeight = Math.max(28, doc.heightOfString(String(row.description), { width: widths[0] - 20 }) + 16);
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 120) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }

    const fill = index % 2 === 0 ? '#ffffff' : '#faf7ff';
    doc.roundedRect(startX, doc.y, tableWidth, rowHeight, 8).fillAndStroke(fill, '#eadcf8');
    const values = [row.description, String(row.quantity ?? 1), formatMoney(row.rate ?? 0), formatMoney(row.amount ?? 0)];
    values.forEach((value, valueIndex) => {
      const x = startX + widths.slice(0, valueIndex).reduce((sum, amount) => sum + amount, 0);
      doc.fillColor('#111827').font(valueIndex === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.4).text(value, x + 10, doc.y + 8, {
        width: widths[valueIndex] - 20,
        align: valueIndex === 0 ? 'left' : 'right'
      });
    });
    doc.y += rowHeight + rowGap;
  });
}

function buildInvoicePdf({ booking, invoice, driver, settings }) {
  const model = buildInvoiceModel({ booking, invoice, driver, settings });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 38, bufferPages: true });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const headerHeight = 112;

    doc.info.Title = `Invoice ${model.invoice.invoiceId}`;
    doc.info.Author = model.business.businessName;
    doc.info.Subject = `${model.business.businessName} Commercial Invoice`;

    const headerY = doc.y;
    doc.roundedRect(doc.page.margins.left, headerY, contentWidth, headerHeight, 18).fill('#5b21b6');
    doc.roundedRect(doc.page.margins.left + 16, headerY + 16, 54, 54, 16).fill('#d4af37');
    doc.fillColor('#1f103b').font('Helvetica-Bold').fontSize(22).text(model.business.logoText, doc.page.margins.left + 16, headerY + 31, { width: 54, align: 'center' });

    const leftX = doc.page.margins.left + 82;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17).text(model.business.businessName, leftX, headerY + 18, { width: 300 });
    doc.font('Helvetica').fontSize(9.5).fillColor('#f4e8ff').text(model.business.tagline, leftX, headerY + 41, { width: 320 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#f4e8ff').text(`${model.business.address}\n${model.business.phone} • ${model.business.email}\n${model.business.website}`, leftX, headerY + 58, { width: 320, lineGap: 2 });

    const badgeX = doc.page.width - doc.page.margins.right - 232;
    doc.roundedRect(badgeX, headerY + 16, 216, 80, 14).fill('#fefce8');
    doc.fillColor('#5b21b6').font('Helvetica-Bold').fontSize(16).text('TAX INVOICE', badgeX + 12, headerY + 25, { width: 192, align: 'right' });
    doc.font('Helvetica').fontSize(8.7).fillColor('#6b7280').text(`Invoice #: ${model.invoice.invoiceId}`, badgeX + 12, headerY + 46, { width: 192, align: 'right' });
    doc.text(`Booking ID: ${model.invoice.bookingId}`, badgeX + 12, headerY + 58, { width: 192, align: 'right' });
    doc.text(`Date: ${formatDate(model.invoice.invoiceDate)}`, badgeX + 12, headerY + 70, { width: 192, align: 'right' });
    doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(9).text(model.invoice.status || 'Pending', badgeX + 12, headerY + 82, { width: 192, align: 'right' });

    doc.y = headerY + headerHeight + 16;

    drawSectionTitle(doc, 'Invoice Snapshot', 'Commercial summary and payment status');
    drawInfoGrid(doc, [
      { label: 'Invoice Date', value: formatDateTime(model.invoice.invoiceDate) },
      { label: 'Due Date', value: formatDateTime(model.invoice.dueDate) },
      { label: 'GSTIN', value: model.business.gstin },
      { label: 'Payment Status', value: safeText(model.payment.status) }
    ], 2);

    drawSectionTitle(doc, 'Customer Details', 'Billing and contact information');
    drawInfoGrid(doc, [
      { label: 'Customer', value: model.customer.name },
      { label: 'Email', value: model.customer.email },
      { label: 'Phone', value: model.customer.phone },
      { label: 'Billing Address', value: model.customer.address },
      { label: 'Pickup Location', value: model.customer.pickupLocation },
      { label: 'Drop Location', value: model.customer.dropLocation }
    ], 2);

    drawSectionTitle(doc, 'Ride Summary', 'Vehicle allocation and trip timeline');
    drawInfoGrid(doc, [
      { label: 'Vehicle', value: model.ride.vehicle },
      { label: 'Vehicle Type', value: model.ride.vehicleType },
      { label: 'Driver', value: model.ride.driverName },
      { label: 'Driver Phone', value: model.ride.driverPhone },
      { label: 'Pickup Time', value: `${formatDate(model.ride.pickupDate)} ${safeText(model.ride.pickupTime, '')}`.trim() },
      { label: 'Ride Status', value: model.ride.rideStatus },
      { label: 'Distance', value: model.ride.distance },
      { label: 'Ride Duration', value: model.ride.rideDuration }
    ], 2);

    drawSectionTitle(doc, 'Fare Breakdown', 'Line-item commercial invoice with GST split');
    drawTable(doc, model.lineItems);

    doc.moveDown(0.5);
    const paymentY = doc.y + 12;
    const boxWidth = (contentWidth - 16) / 2;
    doc.roundedRect(doc.page.margins.left, paymentY, boxWidth, 140, 16).fillAndStroke('#ffffff', '#eadcf8');
    doc.roundedRect(doc.page.margins.left + boxWidth + 16, paymentY, boxWidth, 140, 16).fillAndStroke('#fffaf0', '#f3d98b');

    doc.fillColor('#5b21b6').font('Helvetica-Bold').fontSize(10).text('Payment Summary', doc.page.margins.left + 14, paymentY + 12);
    doc.font('Helvetica').fontSize(9).fillColor('#374151').text(`Method: ${safeText(model.payment.method)}`, doc.page.margins.left + 14, paymentY + 30);
    doc.text(`Status: ${safeText(model.payment.status)}`, doc.page.margins.left + 14, paymentY + 44);
    doc.text(`Amount Paid: ${formatMoney(model.payment.amountPaid)}`, doc.page.margins.left + 14, paymentY + 58);
    doc.text(`Remaining Amount: ${formatMoney(model.payment.balanceDue)}`, doc.page.margins.left + 14, paymentY + 72);
    doc.text(`Transaction ID: ${safeText(model.payment.transactionId)}`, doc.page.margins.left + 14, paymentY + 86, { width: boxWidth - 28 });
    doc.text(`Payment Date: ${formatDateTime(model.payment.paymentDate)}`, doc.page.margins.left + 14, paymentY + 100);

    doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(10).text('Tax Summary', doc.page.margins.left + boxWidth + 30, paymentY + 12);
    doc.font('Helvetica').fontSize(9).fillColor('#374151').text(`Subtotal: ${formatMoney(model.tax.subtotal)}`, doc.page.margins.left + boxWidth + 30, paymentY + 30);
    doc.text(`Discount: ${formatMoney(model.tax.discountAmount)}`, doc.page.margins.left + boxWidth + 30, paymentY + 44);
    doc.text(`CGST (${model.tax.taxPercent / 2}%): ${formatMoney(model.tax.cgstAmount)}`, doc.page.margins.left + boxWidth + 30, paymentY + 58);
    doc.text(`SGST (${model.tax.taxPercent / 2}%): ${formatMoney(model.tax.sgstAmount)}`, doc.page.margins.left + boxWidth + 30, paymentY + 72);
    doc.text(`GST Total (${model.tax.taxPercent}%): ${formatMoney(model.tax.taxAmount)}`, doc.page.margins.left + boxWidth + 30, paymentY + 86);
    doc.font('Helvetica-Bold').fontSize(11).text(`Grand Total: ${formatMoney(model.tax.totalAmount)}`, doc.page.margins.left + boxWidth + 30, paymentY + 106);

    doc.y = paymentY + 158;

    drawSectionTitle(doc, 'Bank & Online Payment', 'Optional payment details for transfer and UPI');
    drawInfoGrid(doc, [
      { label: 'UPI ID', value: model.business.upiId },
      { label: 'Account Name', value: model.business.bankAccountName },
      { label: 'Account Number', value: model.business.bankAccountNumber },
      { label: 'IFSC Code', value: model.business.bankIfsc },
      { label: 'Branch', value: model.business.bankBranch },
      { label: 'Payment Link', value: model.business.paymentLink || 'Available on request' }
    ], 2);

    drawSectionTitle(doc, 'Terms & Conditions', 'Commercial terms and billing compliance');
    const termsText = model.terms.map((term) => `• ${term}`).join('\n');
    const termsHeight = Math.max(88, doc.heightOfString(termsText, { width: contentWidth - 28, lineGap: 2 }) + 26);
    doc.roundedRect(doc.page.margins.left, doc.y, contentWidth, termsHeight, 16).fillAndStroke('#fcfbff', '#eadcf8');
    doc.fillColor('#374151').font('Helvetica').fontSize(8.7).text(termsText, doc.page.margins.left + 14, doc.y + 12, { width: contentWidth - 28, lineGap: 2 });

    doc.moveDown(1.8);
    doc.fillColor('#5b21b6').font('Helvetica-Bold').fontSize(10).text(model.business.footerNote, { align: 'center' });
    doc.font('Helvetica').fontSize(8.5).fillColor('#6b7280').text(`Support: ${model.business.phone} | ${model.business.email} | ${model.business.website}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(9).text('Authorized Signature', { align: 'right' });
    doc.moveTo(doc.page.width - doc.page.margins.right - 140, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).strokeColor('#d4af37').lineWidth(1.1).stroke();

    doc.end();
  });
}

module.exports = { buildInvoicePdf, buildInvoiceModel };