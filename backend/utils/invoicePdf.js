const PDFDocument = require('pdfkit');

function formatMoney(value) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function addLabelValue(doc, label, value, options = {}) {
  const labelWidth = options.labelWidth || 150;
  const valueWidth = options.valueWidth || 300;
  const x = doc.x;
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#374151').text(label, x, y, { width: labelWidth });
  doc.font('Helvetica').fontSize(10).fillColor('#111827').text(value || '—', x + labelWidth, y, { width: valueWidth });
  doc.moveDown(0.6);
}

function buildInvoicePdf({ booking, invoice, driver }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(24).fillColor('#111827').text('Invoice', { align: 'right' });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text('Luxury Tour & Travels', { align: 'right' });
    doc.moveDown(1.2);

    doc.roundedRect(44, doc.y, 508, 72, 12).fillAndStroke('#f9fafb', '#e5e7eb');
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(16).text(invoice.invoiceId, 60, doc.y + 14);
    doc.font('Helvetica').fontSize(10).fillColor('#374151').text(`Booking: ${booking.bookingId}`, 60, doc.y + 34);
    doc.text(`Generated: ${new Date(invoice.createdAt || Date.now()).toLocaleString()}`, 60, doc.y + 50);

    doc.y += 86;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text('Customer Details');
    doc.moveDown(0.5);
    addLabelValue(doc, 'Customer', booking.customerName);
    addLabelValue(doc, 'Email', booking.email);
    addLabelValue(doc, 'Phone', booking.phone);
    addLabelValue(doc, 'Pickup', booking.pickupLocation);
    addLabelValue(doc, 'Drop', booking.dropLocation);
    addLabelValue(doc, 'Pickup Time', `${new Date(booking.pickupDate).toLocaleDateString()} ${booking.pickupTime || ''}`.trim());

    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text('Ride Details');
    doc.moveDown(0.5);
    addLabelValue(doc, 'Vehicle', invoice.vehicle || booking.selectedCar);
    addLabelValue(doc, 'Driver', invoice.driverName || driver?.driverName || 'Not assigned');
    addLabelValue(doc, 'Distance', invoice.distance || booking.finalBill?.distance || '—');
    addLabelValue(doc, 'Status', booking.bookingStatus);

    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text('Fare Breakdown');
    doc.moveDown(0.5);
    addLabelValue(doc, 'Base fare', formatMoney(invoice.fareBreakdown?.baseAmount ?? booking.estimatedFare));
    addLabelValue(doc, 'Taxes', formatMoney(invoice.taxAmount || invoice.fareBreakdown?.taxAmount || 0));
    addLabelValue(doc, 'Discount', formatMoney(invoice.discountAmount || invoice.fareBreakdown?.discountAmount || 0));
    addLabelValue(doc, 'Final amount', formatMoney(invoice.totalFare));
    addLabelValue(doc, 'Payment method', invoice.paymentMethod || booking.paymentMethod || 'Pending');
    addLabelValue(doc, 'Payment status', invoice.paymentStatus || booking.paymentStatus || 'Pending');

    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text('Final Bill');
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(10).fillColor('#374151').text(JSON.stringify(invoice.finalBill || booking.finalBill || {}, null, 2), {
      width: 500,
      lineGap: 2
    });

    doc.end();
  });
}

module.exports = { buildInvoicePdf };